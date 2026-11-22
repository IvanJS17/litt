// Starting, running and stopping a SYNCHRONOUS tabular generation without a
// socket (design §4.5). POST /:reviewId/generate used to do all of this inline
// around `res`; it now calls these, and the MCP tools call the same functions.
//
// A generation is a SERVER-OWNED RUN (lib/streamRuns.ts): the frames go into
// the run's buffer, anyone attached (the HTTP stream, a reload) is fed from it,
// and nobody attached is fine — the work carries on and its progress is in the
// database. Only a stop cuts it short.
//
//   startTabularGeneration   claim the review's lease, open the run, snapshot the
//                            rows and cells, stamp the cells this run will fill
//   runTabularGeneration     extract the cells, record the audit event, always
//                            release the lease and end the run
//   stopTabularGeneration    the one way to cut a running generation short
//
// The async (queue) path keeps its own handler in tabular.routes.ts: its work
// belongs to the queue workers, not to a run in this process.

import { randomUUID } from "node:crypto";
import { readAuthorizationStamp, type AuthorizationStamp } from "../../lib/authorizationEpoch";
import { type UserApiKeys } from "../../lib/llm";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure } from "../../lib/serviceResult";
import { isReported, reportError } from "../../lib/observability/report";
import { BACKEND_REPORTING_OWNER } from "../../lib/reportedUpstreamCodes";
import {
    getActiveStreamRun,
    startStreamRun,
    stopOutcomeFrame,
    type StreamRun,
} from "../../lib/streamRuns";
import { ASSISTANT_ERROR_MESSAGE } from "../chat/chat.service";
import { getUserModelSettings } from "../user/user.service";
import {
    claimTabularGeneration,
    ensureReviewGenerateStopAccess,
    loadTabularGenerateWork,
    preparedGenerateFailure,
} from "./tabular.generate";
import { claimCellsForGeneration, streamTabularGenerateSync } from "./tabular.generateStream";
import type { ReviewRow } from "./tabular.rows";
import {
    finishGeneration,
    startGenerationHeartbeat,
    type Column,
    type Db,
    type TabularResult,
} from "./tabular.shared";

/**
 * A review may have one synchronous generation at a time, so its run is keyed
 * by review id — the same slot the generation lease guards in the database,
 * held here for the frames the lease knows nothing about.
 */
export const reviewRunKey = (reviewId: string) => `review:${reviewId}`;

export type StartedTabularGeneration = {
    db: Db;
    reviewId: string;
    userId: string;
    userEmail: string | undefined;
    generationId: string;
    run: StreamRun<Record<string, unknown>>;
    columns: Column[];
    rows: ReviewRow[];
    cellMap: Map<string, Record<string, unknown>>;
    model: string;
    apiKeys: UserApiKeys;
    /** The review's organization (null: personal) and the epoch the run was authorized under. */
    orgId: string | null;
    authorization: AuthorizationStamp | null;
    /** The run was stopped before it began: nothing to extract, only to release. */
    aborted: boolean;
    /** Stop the lease heartbeat, give the lease back and end the run. Safe to call twice. */
    release: () => Promise<void>;
};

/**
 * Claim the lease and set the run up. The caller has already passed the
 * pre-lease guards (`prepareTabularGenerate`) and validated `expectedUpdatedAt`.
 * Any failure after the claim gives the lease back before it is returned.
 */
export async function startTabularGeneration(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        expectedUpdatedAt: string;
        columns: Column[];
        model: string;
        apiKeys: UserApiKeys;
    },
): Promise<TabularResult<StartedTabularGeneration>> {
    const { reviewId, userId, userEmail } = args;
    const generationId = randomUUID();
    const claim = await claimTabularGeneration(db, {
        reviewId,
        expectedUpdatedAt: args.expectedUpdatedAt,
        generationId,
    });
    if (!claim.ok) return claim;

    const run = startStreamRun({
        id: generationId,
        key: reviewRunKey(reviewId),
        userId,
        forcedStopFrames: [
            `data: ${JSON.stringify({ type: "cancelled" })}\n\n`,
            "data: [DONE]\n\n",
        ],
    });
    if (!run) {
        // The lease was free but the previous run for this review has not let
        // go of its frame buffer yet (it releases the lease just before it
        // finishes). Hand the lease straight back and answer like any other
        // concurrent run.
        await finishGeneration(db, reviewId, generationId, console, "[tabular/generate]");
        return failure("conflict", "This tabular review is already running elsewhere.", "review_running");
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let released = false;
    const release = async () => {
        if (released) return;
        released = true;
        if (heartbeat) clearInterval(heartbeat);
        await finishGeneration(db, reviewId, generationId, console, "[tabular/generate]");
        // Ending the run ends every response attached to it and starts its
        // retention window, so a client reconnecting a moment later still gets
        // the last frames.
        run.finish();
    };

    // Losing the lease means a successor now owns these cells, so the only
    // safe response is to stop writing.
    heartbeat = startGenerationHeartbeat({
        db,
        reviewId,
        generationId,
        skip: () => run.signal.aborted,
        onLost: () => run.stop(),
    });

    // The run outlives this request, so it carries the authorization epoch it
    // starts under (as a queued row job does). Read BEFORE the readability
    // filter below: a change after the filter has then moved past this stamp.
    let orgId: string | null = null;
    let authorization: AuthorizationStamp | null = null;
    try {
        const { data: reviewOrg, error: reviewOrgError } = await db
            .from("tabular_reviews")
            .select("org_id")
            .eq("id", reviewId)
            .single();
        if (reviewOrgError) throw reviewOrgError;
        orgId = (reviewOrg as { org_id?: string | null } | null)?.org_id ?? null;
        authorization = await readAuthorizationStamp(db, orgId);
    } catch (stampError) {
        await release();
        return internalFailure(stampError);
    }

    // Everything used to decide which cells need work is loaded only after the
    // atomic lease claim; otherwise a request can snapshot pending cells while
    // another run is finishing and regenerate results completed after its
    // stale snapshot.
    const work = await loadTabularGenerateWork(db, { reviewId, userId, userEmail });
    if (!work.ok) {
        await release();
        return internalFailure(work.error);
    }
    const { rows, cellMap } = work.data;
    const started: StartedTabularGeneration = {
        db,
        reviewId,
        userId,
        userEmail,
        generationId,
        run: run as StreamRun<Record<string, unknown>>,
        columns: args.columns,
        rows,
        cellMap,
        model: args.model,
        apiKeys: args.apiKeys,
        orgId,
        authorization,
        aborted: run.signal.aborted,
        release,
    };
    if (started.aborted) return { ok: true, data: started };

    // Claim the cells this run intends to fill by stamping them with the
    // generation id. Every write extraction then performs is guarded on that
    // stamp, so a run that loses the lease mid-flight can no longer blank or
    // overwrite what its successor has filled.
    try {
        await claimCellsForGeneration({ db, reviewId, generationId, columns: args.columns, rows, cellMap });
    } catch (claimError) {
        await release();
        return internalFailure(claimError);
    }
    return { ok: true, data: started };
}

/**
 * Extract the started generation's cells. Never throws: a failure is reported
 * and sent to whoever is attached as an error frame. Always gives the lease
 * back and ends the run when it is done.
 */
export async function runTabularGeneration(started: StartedTabularGeneration): Promise<void> {
    const { db, reviewId, userId, userEmail, run, generationId } = started;
    const write = (line: string) => run.write(line);
    try {
        const completed = await streamTabularGenerateSync({
            onActivity: run.touch,
            write,
            db,
            reviewId,
            columns: started.columns,
            rows: started.rows,
            cellMap: started.cellMap,
            model: started.model,
            apiKeys: started.apiKeys,
            generationId,
            userId,
            abortSignal: run.signal,
            orgId: started.orgId,
            authorization: started.authorization,
            stop: () => run.stop(),
        });
        if (completed) {
            void recordAudit(db, {
                userId,
                userEmail,
                action: "tabular.generated",
                surface: "tabular",
                reviewId,
                model: started.model,
            });
            write("data: [DONE]\n\n");
        } else {
            // Stopped. The cells are already back to "pending"; tell every
            // attached reader how the run ended, the way a chat turn does, so
            // a second tab does not sit on a spinner.
            write(stopOutcomeFrame(run));
            write("data: [DONE]\n\n");
        }
    } catch (error) {
        if (!run.signal.aborted) {
            if (!isReported(error))
                reportError(error, { tags: { operation: "tabular.generate", stage: "generation-stream" } });
            console.error("[tabular/generate] stream error", error);
            try {
                write(
                    `data: ${JSON.stringify({ type: "error", message: ASSISTANT_ERROR_MESSAGE, reporting_owner: BACKEND_REPORTING_OWNER })}\n\ndata: [DONE]\n\n`,
                );
            } catch {
                /* ignore */
            }
        }
    } finally {
        await started.release();
    }
}

/**
 * Cut a running synchronous generation short. Stopping is a write on the
 * review, so it needs exactly what starting needed (edit standing), but not a
 * model or keys: the run may have been started by another editor. A
 * deployment on the async path registers no run, so it answers
 * `generation_not_found`; so does a run owned by another replica.
 */
export async function stopTabularGeneration(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<TabularResult<{ stopped: boolean; finished: boolean }>> {
    const gate = await ensureReviewGenerateStopAccess(db, args);
    if (!gate.ok) return preparedGenerateFailure(gate);
    const run = getActiveStreamRun(reviewRunKey(args.reviewId));
    if (!run) return failure("not_found", "No generation is running for this review.", "generation_not_found");
    if (run.finished) return { ok: true, data: { stopped: false, finished: true } };
    run.stop();
    return { ok: true, data: { stopped: true, finished: false } };
}

/**
 * The model new reviews start on for this person (their saved tabular model),
 * or null: a tool that has no model of its own asks the person to choose one
 * rather than picking a model for them.
 */
export async function savedTabularModel(db: Db, userId: string, orgId: string | null): Promise<string | null> {
    const settings = await getUserModelSettings(userId, db, { orgId });
    return settings.tabular_model || null;
}
