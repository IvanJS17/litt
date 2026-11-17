// The sink a connected app's chat turn writes to.
//
// `runChatTurn` writes SSE frames to a sink and saves the answer to the
// conversation itself. For a connected app nobody holds a socket: the turn
// runs on its server-owned run and the app polls (start + poll, design §9).
// This sink passes everything to the run, and remembers the one thing the
// stored message does not keep: the reason a turn ended in an error before
// anything was saved (an empty answer, a provider failure), so a poll can
// say why. Nothing else is buffered here; the answer is read from the stored
// message, as the web reads it on reload.

import type { ChatTurnSink } from "../chat/chat.service";

const KEEP_MS = 30 * 60_000;
const KEEP_MAX = 500;
const outcomes = new Map<string, { errorMessage: string; at: number }>();

function remember(turnId: string, errorMessage: string): void {
    const now = Date.now();
    for (const [id, entry] of outcomes) if (now - entry.at > KEEP_MS) outcomes.delete(id);
    while (outcomes.size >= KEEP_MAX) outcomes.delete(outcomes.keys().next().value as string);
    outcomes.set(turnId, { errorMessage, at: now });
}

/** The error text frame `line` carries, if it is an error frame. */
export function errorFrameMessage(line: string): string | null {
    if (!line.startsWith("data: {")) return null;
    try {
        const frame = JSON.parse(line.slice("data: ".length).split("\n")[0]) as { type?: unknown; message?: unknown };
        return frame.type === "error" && typeof frame.message === "string" ? frame.message.slice(0, 500) : null;
    } catch {
        return null;
    }
}

export function createMcpChatSink(run: ChatTurnSink): ChatTurnSink {
    return {
        get id() {
            return run.id;
        },
        get signal() {
            return run.signal;
        },
        get stopReason() {
            return run.stopReason;
        },
        write: (line, options) => {
            const message = errorFrameMessage(line);
            if (message) remember(run.id, message);
            return run.write(line, options);
        },
        touch: () => run.touch(),
        finish: () => run.finish(),
    };
}

/** Why the turn `turnId` ended in an error, when the sink saw it. */
export const turnErrorMessage = (turnId: string): string | null => outcomes.get(turnId)?.errorMessage ?? null;

export function resetMcpChatOutcomesForTests(): void {
    outcomes.clear();
}
