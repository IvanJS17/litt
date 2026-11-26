import type { Response } from "express";
import { streamRunDeadlines } from "./runtimeConfig";

/**
 * Server-owned streaming runs.
 *
 * A *run* is a unit of generation the server owns rather than the HTTP
 * response that asked for it. Before this module existed, generation lived
 * inside its request: the SSE socket closing (a refresh, a closed tab, a
 * dropped connection) aborted the work. Now the route registers a run, writes
 * frames into the run's buffer instead of the socket, and any number of
 * responses attach to it: the original request, a reload, a second tab. A
 * response attaching late gets the buffered frames replayed from the sequence
 * number it last saw, then tails the live ones. Closing a response detaches it
 * and nothing else; only `stop()` (an explicit Stop endpoint) aborts the work.
 *
 * Frames keep their wire form (`data: <json>\n\n`) and gain an SSE `id:` line
 * carrying the sequence number, which is what a client sends back as `from`
 * when it reconnects.
 *
 * A run is identified two ways: by `id` (what a client resumes) and by `key`
 * (what may only have one run at a time — `chat:<chatId>` for an assistant
 * turn, `review:<reviewId>` for a tabular generation). The surface that owns
 * the run keeps its own state in the opaque `meta` object.
 *
 * Scope: one process. A run lives in this process's memory, so a resume has to
 * reach the replica that is generating (single replica, or sticky routing). A
 * finished run is kept for a short grace period so a client that reconnects
 * just after the end still receives the terminal frames.
 */

export const FINISHED_RUN_RETENTION_MS = 60_000;
/**
 * Defaults for the two run deadlines (see `streamRunDeadlines` in
 * runtimeConfig.ts for the env overrides). The idle deadline catches a hung
 * provider or tool: useful model progress and data frames re-arm it, while
 * transport keep-alives do not. The lifetime is a backstop for a
 * run that emits forever.
 *
 * Ceiling: with keep-alives (SSE comments, `event: ping`) a provider step is
 * governed by STREAM_CHUNK_TIMEOUT_MS (compose: 180000), but those frames do
 * not re-arm this idle deadline. A run that shows no useful progress for
 * IDLE_RUN_TIMEOUT_MS (5 min; STREAM_IDLE_TIMEOUT_MS, 30 s-1 h) is aborted
 * without a retry, so a reasoning model that thinks silently longer than that
 * needs STREAM_IDLE_TIMEOUT_MS raised, not only the chunk timeout.
 */
export const MAX_RUN_LIFETIME_MS = 4 * 60 * 60_000;
export const IDLE_RUN_TIMEOUT_MS = 5 * 60_000;
/**
 * Most bytes one run may hold for replay, and the most one model call may
 * produce (see `streamAiSdk`). A run is held in the memory of the process
 * every user shares; past this it is stopped with an error.
 *
 * Sized against the largest legitimate shapes: an answer streamed as many
 * one-token frames counts `FRAME_OVERHEAD_BYTES` for each of them, and an
 * answer with many citations holds one snapshot, because each snapshot
 * replaces the one before it. 32 MiB leaves a margin over both.
 */
export const MAX_RUN_BUFFERED_BYTES = 32 * 1024 * 1024;
/**
 * What one buffered frame costs beyond its text: the frame object, the string
 * header and the array slot, rounded up so that the byte count follows the
 * memory held and not only the text.
 */
export const FRAME_OVERHEAD_BYTES = 128;
/** Unfinished runs one person may hold at once, across every surface. */
export const MAX_LIVE_RUNS_PER_USER = 8;

/**
 * Refusal to start a run: the person already has the most unfinished ones.
 * The code is the throttling code the clients already turn into a "try again
 * shortly" notice.
 */
export class StreamRunLimitError extends Error {
    readonly status = 429;
    readonly code = "rate_limited";
    constructor() {
        super("Too many responses are being generated for your account at once. Wait for one to finish and try again.");
        this.name = "StreamRunLimitError";
    }
}
const liveRunsByUser = new Map<string, number>();
let runByteLimitForTests: number | null = null;
/** The ceiling in force: the constant, or the small one a test injected. */
export function runByteLimit(): number {
    return runByteLimitForTests ?? MAX_RUN_BUFFERED_BYTES;
}
/** Test hook: use a small ceiling (null restores the real one). */
export function setRunByteLimitForTests(limit: number | null) {
    runByteLimitForTests = limit;
}

/** Why a run was stopped. Only "user" is an explicit cancel. */
export type StreamStopReason = "user" | "idle" | "max_lifetime" | "output_limit";

/** The terminal SSE records for a run that hit one of its deadlines. */
export function deadlineMessage(reason: Exclude<StreamStopReason, "user">): string {
    if (reason === "output_limit") {
        return "The response grew larger than the maximum allowed size and was stopped.";
    }
    return reason === "idle"
        ? "The request timed out because it stopped responding. Please try again."
        : "The request ran longer than the maximum allowed time and was stopped.";
}

export function deadlineFrames(reason: Exclude<StreamStopReason, "user">): string[] {
    return [
        `data: ${JSON.stringify({
            type: "error",
            message: deadlineMessage(reason),
            safe_to_display: true,
        })}\n\n`,
        "data: [DONE]\n\n",
    ];
}

/**
 * The outcome record a route writes after it unwinds from an abort: `cancelled`
 * for an explicit Stop, an error for a deadline. (A route writes `[DONE]`
 * itself.)
 */
export function stopOutcomeFrame(
    run: { readonly stopReason: StreamStopReason | null } | null | undefined,
): string {
    return !run || run.stopReason === null || run.stopReason === "user"
        ? `data: ${JSON.stringify({ type: "cancelled" })}\n\n`
        : deadlineFrames(run.stopReason)[0];
}
/**
 * How long a STOPPED run may take to finish on its own before the registry
 * finishes it. `stop()` only aborts the signal; the route is expected to unwind,
 * persist its partial and call `finish()`. A route that never does (a provider
 * or tool call that ignores the abort, a throw before the route's try/finally)
 * would otherwise hold the key forever, and every later send into that chat or
 * review would answer 409 until the process restarted.
 */
export const STOPPED_RUN_GRACE_MS = 30_000;

/**
 * Whether a buffered frame is still worth replaying to a client that attaches
 * later. Always true unless the writer said otherwise.
 */
type ReplayPredicate = () => boolean;

type Frame = { seq: number; line: string; replay: ReplayPredicate };

export type StreamRunSubscriber = {
    write: (chunk: string) => void;
    end: () => void;
};

export type StreamRunWriteOptions = {
    /**
     * Replay this frame to a late subscriber only while the predicate holds.
     * The frame still fans out LIVE to everyone attached when it is written —
     * this only governs the replay a later `subscribe` performs. Transient
     * state (a spinner, a "generating" cell that has since gone terminal) is
     * worth announcing as it happens and misleading to replay afterwards.
     */
    replay?: ReplayPredicate;
    /**
     * Frames written under one slot supersede each other: the new frame
     * replaces the previous one in the buffer (and its bytes are released), so
     * a reader that attaches late gets only the latest. Live readers still
     * receive every one as it is written.
     */
    slot?: string;
};

export type StreamRun<Meta = Record<string, unknown>> = {
    readonly id: string;
    /** What may only have one run at a time, e.g. `chat:<id>`, `review:<id>`. */
    readonly key: string;
    readonly userId: string;
    /** Surface-owned state. Opaque here. */
    readonly meta: Meta;
    readonly startedAt: number;
    /** Aborted by `stop()` only. Hand this to the model call. */
    readonly signal: AbortSignal;
    readonly seq: number;
    readonly finished: boolean;
    readonly stopped: boolean;
    /** Why `stop()` was called; null while the run has not been stopped. */
    readonly stopReason: StreamStopReason | null;
    /**
     * Append one SSE record (`data: ...\n\n`) and fan it out. A COMMENT line
     * (one starting with `:`) is fanned out live but neither buffered nor
     * numbered — it is a keep-alive, not content.
     */
    write: (line: string, opts?: StreamRunWriteOptions) => boolean;
    /** Mark useful progress which does not need a client-facing frame. */
    touch: () => void;
    /** The work is over: end every attached response and start the retention clock. */
    finish: () => void;
    /**
     * Abort the work. The route decides what to persist. `reason` defaults to
     * an explicit user cancel; the registry's own deadlines pass theirs.
     */
    stop: (reason?: StreamStopReason) => void;
    /**
     * Replay frames with `seq >= from` (skipping any whose replay predicate no
     * longer holds), then tail. The subscriber is ended when the run finishes.
     * Returns the detach function.
     */
    subscribe: (from: number, subscriber: StreamRunSubscriber) => () => void;
};

type RunRecord<Meta> = StreamRun<Meta> & {
    frames: Frame[];
    subscribers: Set<StreamRunSubscriber>;
    controller: AbortController;
    retention: ReturnType<typeof setTimeout> | null;
    lifetime: ReturnType<typeof setTimeout> | null;
    idle: ReturnType<typeof setTimeout> | null;
    grace: ReturnType<typeof setTimeout> | null;
};

/** The registry is meta-agnostic; each caller casts back to its own shape. */
type StoredRun = RunRecord<unknown>;

const runs = new Map<string, StoredRun>();
const runsByKey = new Map<string, StoredRun>();

const alwaysReplay: ReplayPredicate = () => true;

function frameChunk(frame: Frame): string {
    return `id: ${frame.seq}\n${frame.line}`;
}

function remove(run: StoredRun) {
    if (run.retention) clearTimeout(run.retention);
    if (run.lifetime) clearTimeout(run.lifetime);
    if (run.grace) clearTimeout(run.grace);
    if (run.idle) clearTimeout(run.idle);
    runs.delete(run.id);
    if (runsByKey.get(run.key) === run) runsByKey.delete(run.key);
}

/**
 * Register a run under `key`. Returns null when a run is still generating
 * under that key: two concurrent writers on one chat thread interleave their
 * rows, and two concurrent generations on one review fight over its cells, so
 * the server refuses the one that did not know.
 *
 * A FINISHED run keeps its key entry until the retention window closes (that
 * is how a client reconnecting just after the end still finds the terminal
 * frames), but it never blocks a successor.
 */
export function startStreamRun<Meta = Record<string, unknown>>(args: {
    id: string;
    key: string;
    userId: string;
    meta?: Meta;
    /**
     * Terminal SSE records to emit when a stopped route does not unwind during
     * the grace period. The owning surface supplies its own wire contract; the
     * registry only guarantees that readers see those records before EOF.
     */
    forcedStopFrames: readonly string[];
}): StreamRun<Meta> | null {
    const current = runsByKey.get(args.key);
    if (current && !current.finished) return null;
    if ((liveRunsByUser.get(args.userId) ?? 0) >= MAX_LIVE_RUNS_PER_USER) {
        throw new StreamRunLimitError();
    }
    liveRunsByUser.set(args.userId, (liveRunsByUser.get(args.userId) ?? 0) + 1);
    const controller = new AbortController();
    let seq = 0;
    let finished = false;
    let stopped = false;
    let stopReason: StreamStopReason | null = null;
    let bufferedBytes = 0;
    let capped = false;
    let terminating = false;
    const slotFrames = new Map<string, Frame>();
    const deadlines = streamRunDeadlines();
    const armIdle = () => {
        if (run.idle) clearTimeout(run.idle);
        run.idle = setTimeout(() => run.stop("idle"), deadlines.idleMs);
        run.idle.unref?.();
    };
    const run: RunRecord<Meta> = {
        id: args.id,
        key: args.key,
        userId: args.userId,
        meta: (args.meta ?? ({} as Meta)) as Meta,
        startedAt: Date.now(),
        signal: controller.signal,
        get seq() {
            return seq;
        },
        get finished() {
            return finished;
        },
        get stopped() {
            return stopped;
        },
        get stopReason() {
            return stopReason;
        },
        frames: [],
        subscribers: new Set(),
        controller,
        retention: null,
        lifetime: null,
        idle: null,
        grace: null,
        touch() {
            if (!finished && !stopped) armIdle();
        },
        write(line: string, opts?: StreamRunWriteOptions) {
            if (finished || capped) return false;
            // Transport keep-alives do not prove useful work is progressing.
            if (!line.startsWith(":")) run.touch();
            // SSE COMMENT lines (`: tool-wait`) are not records: they carry
            // no payload, exist only to stop an intermediary idling the
            // connection out, and mean nothing to a client that arrives
            // later. Fan them out live, but never buffer or number them —
            // otherwise a Word turn waiting on a client tool call would
            // replay hundreds of comments to a reattaching pane and push
            // every real frame's sequence number along with them.
            if (line.startsWith(":")) {
                for (const subscriber of [...run.subscribers]) {
                    try {
                        subscriber.write(line);
                    } catch {
                        run.subscribers.delete(subscriber);
                    }
                }
                return true;
            }
            const size = Buffer.byteLength(line) + FRAME_OVERHEAD_BYTES;
            const superseded = opts?.slot ? slotFrames.get(opts.slot) : undefined;
            if (superseded) {
                run.frames.splice(run.frames.lastIndexOf(superseded), 1);
                bufferedBytes -= Buffer.byteLength(superseded.line) + FRAME_OVERHEAD_BYTES;
            }
            bufferedBytes += size;
            if (!terminating && bufferedBytes > runByteLimit()) {
                // Release what was buffered, tell readers why, and abort the
                // work; whatever the route still writes while it unwinds is dropped.
                run.frames.length = 0;
                slotFrames.clear();
                bufferedBytes = 0;
                terminating = true;
                for (const record of deadlineFrames("output_limit")) run.write(record);
                capped = true;
                run.stop("output_limit");
                return false;
            }
            seq += 1;
            const frame = { seq, line, replay: opts?.replay ?? alwaysReplay };
            run.frames.push(frame);
            if (opts?.slot) slotFrames.set(opts.slot, frame);
            const chunk = frameChunk(frame);
            for (const subscriber of [...run.subscribers]) {
                try {
                    subscriber.write(chunk);
                } catch {
                    run.subscribers.delete(subscriber);
                }
            }
            return true;
        },
        finish() {
            if (finished) return;
            finished = true;
            const live = (liveRunsByUser.get(args.userId) ?? 1) - 1;
            if (live > 0) liveRunsByUser.set(args.userId, live);
            else liveRunsByUser.delete(args.userId);
            for (const subscriber of [...run.subscribers]) {
                try {
                    subscriber.end();
                } catch {
                    /* the response is gone either way */
                }
            }
            run.subscribers.clear();
            if (run.lifetime) clearTimeout(run.lifetime);
            run.lifetime = null;
            if (run.idle) clearTimeout(run.idle);
            run.idle = null;
            if (run.grace) clearTimeout(run.grace);
            run.grace = null;
            run.retention = setTimeout(() => remove(run), FINISHED_RUN_RETENTION_MS);
            run.retention.unref?.();
        },
        stop(reason: StreamStopReason = "user") {
            if (finished || stopped) return;
            stopped = true;
            stopReason = reason;
            if (run.lifetime) clearTimeout(run.lifetime);
            run.lifetime = null;
            if (run.idle) clearTimeout(run.idle);
            run.idle = null;
            controller.abort();
            if (finished) return;
            // The route owns the orderly ending; this is the disorderly one.
            // Whatever it is still awaiting, the key is free again after the
            // grace period and attached readers get their terminal frame.
            run.grace = setTimeout(() => {
                const frames =
                    reason === "user"
                        ? args.forcedStopFrames
                        : deadlineFrames(reason);
                for (const frame of frames) run.write(frame);
                run.finish();
            }, STOPPED_RUN_GRACE_MS);
            run.grace.unref?.();
        },
        subscribe(from: number, subscriber: StreamRunSubscriber) {
            for (const frame of run.frames) {
                if (frame.seq >= from && frame.replay())
                    subscriber.write(frameChunk(frame));
            }
            if (finished) {
                subscriber.end();
                return () => {};
            }
            run.subscribers.add(subscriber);
            return () => {
                run.subscribers.delete(subscriber);
            };
        },
    };
    run.lifetime = setTimeout(() => run.stop("max_lifetime"), deadlines.maxMs);
    run.lifetime.unref?.();
    armIdle();
    runs.set(run.id, run as StoredRun);
    runsByKey.set(run.key, run as StoredRun);
    return run;
}

/** The run with this id, generating or retained. */
export function getStreamRun<Meta = Record<string, unknown>>(
    id: string,
): StreamRun<Meta> | undefined {
    return runs.get(id) as StreamRun<Meta> | undefined;
}

/**
 * The run registered under this key: the one generating, or — within the
 * retention window — the one that just ended. Callers that must distinguish
 * the two (a "is something running right now" report) check `finished`.
 */
export function getActiveStreamRun<Meta = Record<string, unknown>>(
    key: string,
): StreamRun<Meta> | null {
    return (runsByKey.get(key) as StreamRun<Meta> | undefined) ?? null;
}

/**
 * Stop every run of one person that is still generating (their account is
 * being erased). Returns how many were stopped.
 */
export function stopRunsOfUser(userId: string): number {
    let stopped = 0;
    for (const run of [...runs.values()]) {
        if (run.userId !== userId || run.finished || run.stopped) continue;
        run.stop();
        stopped += 1;
    }
    return stopped;
}

/**
 * Stream a run into an Express response as SSE, from `from` onwards, and end
 * the response when the run finishes. Closing the response only detaches.
 *
 * Returns the same `{ signal, write, finish }` shape `openAssistantSse` gives
 * the streaming routes, so a route that starts a run drives the generation
 * through the run without changing anything else: `write` buffers and fans
 * out, `signal` is the run's (Stop, not socket close), `finish` ends the run.
 */
export function attachStreamRunSse(
    res: Response,
    run: StreamRun<unknown>,
    from = 1,
): {
    signal: AbortSignal;
    write: (line: string, opts?: StreamRunWriteOptions) => boolean;
    finish: () => void;
} {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let ended = false;
    const detach = run.subscribe(from, {
        write: (chunk) => {
            if (ended || res.writableEnded) return;
            res.write(chunk);
        },
        end: () => {
            if (ended) return;
            ended = true;
            res.end();
        },
    });
    res.on("close", () => {
        ended = true;
        detach();
    });

    return {
        signal: run.signal,
        write: run.write,
        finish: run.finish,
    };
}

/** Test hook: forget every run. */
export function resetStreamRunsForTests() {
    runByteLimitForTests = null;
    liveRunsByUser.clear();
    for (const run of [...runs.values()]) remove(run);
    runsByKey.clear();
}
