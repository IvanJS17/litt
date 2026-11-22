// A synchronous generation outlives the request that started it, so it carries
// the organization's authorization epoch the way a queued row job does: read
// once at the start, checked before each row, before its cells are marked and
// before each result is written or streamed. When the epoch has moved the run
// stops and does not touch another cell.

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryTabularAllColumns = vi.fn();
vi.mock("../tabular.extract", () => ({
    queryTabularAllColumns: (...args: unknown[]) => queryTabularAllColumns(...args),
}));

const loadRowDocumentText = vi.fn();
vi.mock("../tabular.rows", () => ({
    loadRowDocumentText: (...args: unknown[]) => loadRowDocumentText(...args),
}));

vi.mock("../tabular.citationSupport", () => ({
    createTabularCellCheck: () => vi.fn(),
}));

const order: string[] = [];
vi.mock("../tabular.generate", () => ({
    claimTabularGeneration: vi.fn(async () => ({ ok: true, data: null })),
    ensureReviewGenerateStopAccess: vi.fn(),
    preparedGenerateFailure: vi.fn(),
    loadTabularGenerateWork: vi.fn(async (_db: unknown, _args: unknown) => {
        order.push("work");
        return {
            ok: true,
            data: { rows: ROWS_FOR_START, cellMap: new Map() },
        };
    }),
}));
vi.mock("../tabular.generateStream", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.generateStream")>()),
    claimCellsForGeneration: vi.fn(async () => undefined),
}));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("../../user/user.service", () => ({ getUserModelSettings: vi.fn() }));
vi.mock("../../chat/chat.service", () => ({ ASSISTANT_ERROR_MESSAGE: "error" }));

import { tableDb } from "../../../__tests__/helpers/tableDb";
import * as epoch from "../../../lib/authorizationEpoch";
import { startTabularGeneration, runTabularGeneration } from "../tabular.generation";
import { streamTabularGenerateSync } from "../tabular.generateStream";
import type { ReviewRow } from "../tabular.rows";

const ORG = "00000000-0000-4000-8000-000000000001";
const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const makeRows = (count: number): ReviewRow[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `row-${index + 1}`,
        review_id: "rev-1",
        label: `Doc ${index + 1}.pdf`,
        row_type: "document",
        folder_id: null,
        library_folder_id: null,
        document_id: `doc-${index + 1}`,
        sort_index: index,
        source_document_ids: [`doc-${index + 1}`],
    })) as ReviewRow[];
const ROWS_FOR_START = makeRows(4);

function world(reviewOrg: string | null = ORG) {
    const tables = {
        organizations: [{ id: ORG, authorization_epoch: 7 }],
        tabular_reviews: [{ id: "rev-1", org_id: reviewOrg }],
        tabular_cells: [] as Record<string, unknown>[],
    };
    const { db, calls } = tableDb(tables);
    const rpc = async () => ({ data: true, error: null });
    return {
        tables,
        calls,
        db: { from: db.from, rpc } as never,
        bumpEpoch: () => {
            tables.organizations[0].authorization_epoch = 8;
        },
    };
}

/** The model call: the first one is when the organization's authorization changes. */
function modelAnswers(onFirstCall: () => void) {
    let first = true;
    queryTabularAllColumns.mockImplementation(async (_m, _f, _t, cols, onResult) => {
        if (first) {
            first = false;
            onFirstCall();
        }
        for (const col of cols)
            await onResult(col.index, { summary: `v${col.index}`, flag: "green", reasoning: "" });
    });
}

beforeEach(() => {
    order.length = 0;
    queryTabularAllColumns.mockReset();
    loadRowDocumentText.mockReset();
    loadRowDocumentText.mockResolvedValue("## Source document\ntext");
});

describe("synchronous tabular generation and the authorization epoch", () => {
    it("stops when the organization's authorization changes mid-run, before the next row's text and any further cell", async () => {
        const w = world();
        const stamp = await epoch.readAuthorizationStamp(w.db, ORG);
        modelAnswers(w.bumpEpoch);
        const frames: Array<{ type: string; status: string; row_id: string }> = [];
        const controller = new AbortController();
        const stop = vi.fn(() => controller.abort());

        const completed = await streamTabularGenerateSync({
            write: (line) => (frames.push(JSON.parse(line.slice(6))), true),
            db: w.db, reviewId: "rev-1", userId: "user-1", columns: COLUMNS, rows: makeRows(4),
            cellMap: new Map(), model: "m", apiKeys: {}, generationId: "gen-1",
            abortSignal: controller.signal, orgId: ORG, authorization: stamp, stop,
        });

        expect(completed).toBe(false);
        expect(stop).toHaveBeenCalled();
        // Nothing was written or streamed as a result after the change.
        expect(frames.filter((frame) => frame.status === "done")).toEqual([]);
        expect(w.tables.tabular_cells.filter((cell) => cell.status === "done")).toEqual([]);
        // The fourth row never loaded its source text.
        expect(loadRowDocumentText.mock.calls.length).toBeLessThanOrEqual(3);
        expect(queryTabularAllColumns.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it("calls no model and marks no cell when the authorization changes while the row's text loads", async () => {
        const w = world();
        const stamp = await epoch.readAuthorizationStamp(w.db, ORG);
        modelAnswers(() => undefined);
        // The change lands after the run's per-row check, while the source text is read.
        loadRowDocumentText.mockImplementation(async () => {
            w.bumpEpoch();
            return "## Source document\ntext";
        });
        const frames: Array<{ status: string }> = [];
        const controller = new AbortController();

        const completed = await streamTabularGenerateSync({
            write: (line) => (frames.push(JSON.parse(line.slice(6))), true),
            db: w.db, reviewId: "rev-1", userId: "user-1", columns: COLUMNS, rows: makeRows(1),
            cellMap: new Map(), model: "m", apiKeys: {}, generationId: "gen-1",
            abortSignal: controller.signal, orgId: ORG, authorization: stamp, stop: () => controller.abort(),
        });

        expect(completed).toBe(false);
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(w.tables.tabular_cells).toEqual([]);
        expect(frames.filter((frame) => frame.status === "generating")).toEqual([]);
    });

    it("runs to the end while the epoch holds, and a personal review needs no stamp", async () => {
        for (const [orgId, makeStamp] of [
            [ORG, true],
            [null, false],
        ] as const) {
            queryTabularAllColumns.mockReset();
            loadRowDocumentText.mockClear();
            const w = world(orgId);
            const stamp = makeStamp ? await epoch.readAuthorizationStamp(w.db, ORG) : null;
            modelAnswers(() => undefined);
            const frames: Array<{ status: string }> = [];
            const stop = vi.fn();

            const completed = await streamTabularGenerateSync({
                write: (line) => (frames.push(JSON.parse(line.slice(6))), true),
                db: w.db, reviewId: "rev-1", userId: "user-1", columns: COLUMNS, rows: makeRows(4),
                cellMap: new Map(), model: "m", apiKeys: {}, generationId: "gen-1",
                abortSignal: new AbortController().signal, orgId, authorization: stamp, stop,
            });

            expect(completed).toBe(true);
            expect(stop).not.toHaveBeenCalled();
            expect(frames.filter((frame) => frame.status === "done")).toHaveLength(8);
        }
    });

    it("reads the stamp before it decides which rows the person may read, and refuses to extract once it is stale", async () => {
        const w = world();
        const original = epoch.readAuthorizationStamp;
        const read = vi.spyOn(epoch, "readAuthorizationStamp");
        read.mockImplementation(async (...args) => {
            order.push("stamp");
            return await original(...args);
        });
        modelAnswers(() => undefined);

        const started = await startTabularGeneration(w.db, {
            reviewId: "rev-1", userId: "user-1", userEmail: "u@example.test",
            expectedUpdatedAt: "2026-01-01T00:00:00.000Z", columns: COLUMNS, model: "m", apiKeys: {},
        });
        if (!started.ok) throw new Error("expected the run to start");
        expect(order).toEqual(["stamp", "work"]);
        expect(started.data.authorization).toEqual({ orgId: ORG, epoch: 7 });

        // The organization's authorization changes after the run was started.
        w.bumpEpoch();
        await runTabularGeneration(started.data);

        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(started.data.run.signal.aborted).toBe(true);
        expect(w.tables.tabular_cells.filter((cell) => cell.status === "done")).toEqual([]);
        read.mockRestore();
    });
});
