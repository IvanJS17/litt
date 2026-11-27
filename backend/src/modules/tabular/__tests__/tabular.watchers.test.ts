// Someone watching a run's live cells stops receiving them when they can no
// longer open the documents the run reads. The question is asked again before
// a frame is written when the last answer is older than five seconds; "no" and
// "cannot tell" both end that watcher's stream.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

vi.mock("ioredis", () => ({ default: vi.fn() }));
vi.mock("../tabular.extract", () => ({ queryTabularAllColumns: vi.fn() }));
vi.mock("../tabular.rows", () => ({ loadRowDocumentText: vi.fn() }));

import { attachStreamRunSse, resetStreamRunsForTests, startStreamRun } from "../../../lib/streamRuns";
import { mayWatchRun } from "../../../lib/tabularReadAccess";
import { streamTabularRunView } from "../tabular.generateStream";
import { ROW_ACCESS_EMAIL, ROW_ACCESS_USER, rowAccessWorld } from "../../../__tests__/helpers/rowAccessWorld";

const reader = { userId: ROW_ACCESS_USER, userEmail: ROW_ACCESS_EMAIL };

function fakeResponse() {
    const emitter = new EventEmitter();
    const chunks: string[] = [];
    const res = {
        setHeader: () => {},
        flushHeaders: vi.fn(),
        writableEnded: false,
        write(chunk: string) {
            chunks.push(chunk);
            return true;
        },
        end() {
            res.writableEnded = true;
        },
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter),
        off: emitter.off.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter),
        emit: emitter.emit.bind(emitter),
        chunks,
    };
    return res;
}

const cellFrame = (rowId: string) =>
    `data: ${JSON.stringify({ type: "cell_update", row_id: rowId, column_index: 0, content: { summary: `content of ${rowId}` }, status: "done" })}\n\n`;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
});
afterEach(() => {
    resetStreamRunsForTests();
    vi.useRealTimers();
});

describe("a watcher attached to a running table generation", () => {
    function attached(options: { askAgain?: () => Promise<boolean> } = {}) {
        const w = rowAccessWorld({ documents: 2 });
        const run = startStreamRun({ id: "run-1", key: "review:rev-1", userId: "starter", meta: { sourceDocumentIds: ["doc-1", "doc-2"] }, forcedStopFrames: [] })!;
        const res = fakeResponse();
        const ask = vi.fn(options.askAgain ?? (() => mayWatchRun(w.db, run, reader)));
        attachStreamRunSse(res as unknown as Response, run, 1, ask);
        return { w, run, res, ask };
    }
    const content = (res: { chunks: string[] }, rowId: string) => res.chunks.filter((chunk) => chunk.includes(`content of ${rowId}`));

    it("receives everything while it keeps access, asking at most once every five seconds", async () => {
        const { run, res, ask } = attached();

        run.write(cellFrame("row-1"));
        vi.setSystemTime(Date.now() + 2_000);
        run.write(cellFrame("row-2"));
        await vi.advanceTimersByTimeAsync(0);
        expect(content(res, "row-1")).toHaveLength(1);
        expect(content(res, "row-2")).toHaveLength(1);
        expect(ask).not.toHaveBeenCalled();

        vi.setSystemTime(Date.now() + 6_000);
        run.write(cellFrame("row-1"));
        run.write(cellFrame("row-2"));
        await vi.advanceTimersByTimeAsync(0);
        expect(res.chunks.filter((chunk) => chunk.includes("content of"))).toHaveLength(4);
        expect(ask).toHaveBeenCalledTimes(1);
        expect(res.writableEnded).toBe(false);
    });

    it("receives no cell content written more than five seconds after it lost access, and its stream ends", async () => {
        const { w, run, res } = attached();
        run.write(cellFrame("row-1"));

        w.lose("override", 2);
        vi.setSystemTime(Date.now() + 6_000);
        run.write(cellFrame("row-2"));
        run.write(cellFrame("row-1"));
        await vi.advanceTimersByTimeAsync(0);

        expect(content(res, "row-2")).toEqual([]);
        expect(content(res, "row-1")).toHaveLength(1);
        expect(res.writableEnded).toBe(true);
    });

    it("loses the stream as well when the question cannot be answered", async () => {
        const { run, res } = attached({ askAgain: async () => { throw new Error("lookup failed"); } });

        vi.setSystemTime(Date.now() + 6_000);
        run.write(cellFrame("row-1"));
        await vi.advanceTimersByTimeAsync(0);

        expect(content(res, "row-1")).toEqual([]);
        expect(res.writableEnded).toBe(true);
    });

    it("is not asked at all by a stream that was attached without a question", async () => {
        const run = startStreamRun({ id: "run-2", key: "review:rev-2", userId: "starter", meta: {}, forcedStopFrames: [] })!;
        const res = fakeResponse();
        attachStreamRunSse(res as unknown as Response, run);

        vi.setSystemTime(Date.now() + 60_000);
        run.write(cellFrame("row-1"));

        expect(content(res, "row-1")).toHaveLength(1);
    });
});

describe("the view that tails a run through the database", () => {
    const rows = [
        { id: "row-1", source_document_ids: ["doc-1"] },
        { id: "row-2", source_document_ids: ["doc-2"] },
    ];
    const done = (rowId: string) => ({ id: `cell-${rowId}`, review_id: "rev-1", row_id: rowId, column_index: 0, status: "done", content: JSON.stringify({ summary: `content of ${rowId}` }) });

    async function startView(loseRow2: boolean) {
        const w = rowAccessWorld({ documents: 2 });
        w.tables.tabular_cells.push(done("row-1"));
        const res = fakeResponse();
        await streamTabularRunView({
            res: res as never, db: w.db, reviewId: "rev-1", columns: [{ index: 0, name: "A", prompt: "a" }],
            rows: rows as never, cellMap: new Map(), log: { error: vi.fn() } as never,
            userId: ROW_ACCESS_USER, userEmail: ROW_ACCESS_EMAIL,
        } as never);
        await vi.advanceTimersByTimeAsync(3_000);
        // The second row's cell lands while the watcher's access to its document is (or is not) withdrawn.
        if (loseRow2) w.lose("override", 2);
        w.tables.tabular_cells.push(done("row-2"));
        await vi.advanceTimersByTimeAsync(3_000);
        return { res, w };
    }

    it("stops writing cell content to a watcher who lost access, and ends their stream", async () => {
        const { res } = await startView(true);

        expect(res.chunks.some((chunk) => chunk.includes("content of row-1"))).toBe(true);
        expect(res.chunks.some((chunk) => chunk.includes("content of row-2"))).toBe(false);
        expect(res.writableEnded).toBe(true);
    });

    it("gives a watcher who keeps access everything, to the end", async () => {
        const { res } = await startView(false);

        expect(res.chunks.some((chunk) => chunk.includes("content of row-1"))).toBe(true);
        expect(res.chunks.some((chunk) => chunk.includes("content of row-2"))).toBe(true);
        expect(res.chunks.at(-1)).toBe("data: [DONE]\n\n");
    });
});
