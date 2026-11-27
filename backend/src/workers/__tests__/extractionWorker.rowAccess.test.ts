// A queued row job (and a single-cell job) works for the person who asked for
// the run. For its row it asks whether that person can open every source
// document NOW: when it is about to load the text and again before it saves
// or announces a result. A row that fails the question is left out, nothing
// stays "generating", and the job ends without an error. The organization's
// authorization epoch never changes in these tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));

const loadReviewRow = vi.fn();
const loadRowDocumentText = vi.fn();
vi.mock("../../modules/tabular/tabular.rows", () => ({
    loadReviewRow: (...a: unknown[]) => loadReviewRow(...a),
    loadRowDocumentText: (...a: unknown[]) => loadRowDocumentText(...a),
}));

const validateSelectedModel = vi.fn();
vi.mock("../../modules/tabular/tabular.shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/tabular/tabular.shared")>()),
    validateSelectedModel: (...a: unknown[]) => validateSelectedModel(...a),
}));

const queryTabularAllColumns = vi.fn();
vi.mock("../../modules/tabular/tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
}));

vi.mock("../../modules/tabular/tabular.citationSupport", () => ({
    createTabularCellCheck: () => vi.fn(),
}));

const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError,
}));

import { runExtractionJob } from "../extractionWorker";
import type { ExtractionJobData } from "../../lib/queue/extractionQueue";
import {
    ROW_ACCESS_ORG,
    ROW_ACCESS_USER,
    documentQuestions,
    rowAccessWorld,
    type ReadLoss,
} from "../../__tests__/helpers/rowAccessWorld";

const COLUMNS = [
    { index: 0, name: "Parties", prompt: "Who?" },
    { index: 1, name: "Term", prompt: "How long?" },
];
const ROW = {
    id: "row-1", review_id: "rev-1", label: "Contract.pdf", row_type: "document", folder_id: null,
    library_folder_id: null, document_id: "doc-1", sort_index: 0, source_document_ids: ["doc-1"],
};
const DATA: ExtractionJobData = {
    reviewId: "rev-1", userId: ROW_ACCESS_USER, rowId: "row-1", generationId: "gen-1",
    authorization: { orgId: ROW_ACCESS_ORG, epoch: 7 },
};

/** A world whose single row was claimed by generation "gen-1" before the job ran. */
function world(options: { personal?: boolean } = {}) {
    const w = rowAccessWorld({ documents: 2, personal: options.personal });
    Object.assign(w.tables.tabular_reviews[0], { columns_config: COLUMNS, model: "claude-test" });
    for (const col of COLUMNS)
        w.tables.tabular_cells.push({ id: `cell-${col.index}`, review_id: "rev-1", row_id: "row-1", column_index: col.index, status: "pending", content: null, generation_id: "gen-1" });
    return w;
}
const cellStates = (w: ReturnType<typeof world>) => w.tables.tabular_cells.map((cell) => [cell.status, cell.generation_id ?? null]);
const published = (publish: ReturnType<typeof vi.fn>) => publish.mock.calls.map((call) => call[1] as { type: string; status?: string; content?: unknown });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    for (const fn of [loadReviewRow, loadRowDocumentText, queryTabularAllColumns, validateSelectedModel, reportError]) fn.mockReset();
    loadReviewRow.mockResolvedValue(ROW);
    loadRowDocumentText.mockResolvedValue("extracted text");
    validateSelectedModel.mockResolvedValue({ ok: true, model: "claude-test", apiKeys: {} });
    queryTabularAllColumns.mockImplementation(async (_m, _f, _t, cols, onResult) => {
        for (const col of cols) await onResult(col.index, { summary: `v${col.index}`, flag: "green", reasoning: "" });
    });
});
afterEach(() => vi.useRealTimers());

const LOSSES: ReadLoss[] = ["override", "private", "moved", "deleted"];

describe("a queued row job and the person's access to the row's documents", () => {
    it.each(LOSSES)("loads no text, calls no model and writes nothing for a row whose document is no longer openable (%s)", async (loss) => {
        const w = world();
        w.lose(loss, 1);
        const publish = vi.fn(async () => {});

        await expect(runExtractionJob(DATA, { db: w.db as never, publish })).resolves.toBeUndefined();

        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(cellStates(w)).toEqual([["pending", null], ["pending", null]]);
        expect(published(publish).filter((frame) => frame.status === "done" || frame.status === "generating")).toEqual([]);
    });

    it("loads no text for a row that has lost all of its sources (the document was deleted)", async () => {
        const w = world();
        w.lose("deleted", 1);
        loadReviewRow.mockResolvedValue({ ...ROW, document_id: null, source_document_ids: [] });

        await runExtractionJob(DATA, { db: w.db as never, publish: vi.fn(async () => {}) });

        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(cellStates(w)).toEqual([["pending", null], ["pending", null]]);
    });

    it.each(LOSSES)("saves and announces no result when the document is lost between the load and the save (%s)", async (loss) => {
        const w = world();
        const publish = vi.fn(async () => {});
        loadRowDocumentText.mockImplementation(async () => {
            w.lose(loss, 1);
            vi.setSystemTime(Date.now() + 6_000);
            return "extracted text";
        });

        await expect(runExtractionJob(DATA, { db: w.db as never, publish })).resolves.toBeUndefined();

        expect(w.tables.tabular_cells.filter((cell) => cell.status === "done" || cell.content)).toEqual([]);
        expect(cellStates(w)).toEqual([["pending", null], ["pending", null]]);
        expect(published(publish).filter((frame) => frame.status === "done")).toEqual([]);
    });

    it("leaves the other column alone when a single-cell job loses its row", async () => {
        const w = world();
        w.tables.tabular_cells[0] = { ...w.tables.tabular_cells[0], status: "done", content: "{}", generation_id: null };
        w.lose("override", 1);

        await runExtractionJob({ ...DATA, columnIndex: 1 }, { db: w.db as never, publish: vi.fn(async () => {}) });

        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(cellStates(w)).toEqual([["done", null], ["pending", null]]);
    });

    it("runs as before while access is kept: one question, every column done and announced", async () => {
        const w = world();
        const publish = vi.fn(async () => {});

        await runExtractionJob(DATA, { db: w.db as never, publish });

        expect(cellStates(w)).toEqual([["done", null], ["done", null]]);
        expect(published(publish).filter((frame) => frame.status === "done")).toHaveLength(2);
        expect(documentQuestions(w.calls)).toBe(1);
    });

    it("answers for a person whose access is a grant to their address, read from their account", async () => {
        const kept = world({ personal: true });
        await runExtractionJob({ ...DATA, authorization: null }, { db: kept.db as never, publish: vi.fn(async () => {}) });
        expect(cellStates(kept)).toEqual([["done", null], ["done", null]]);

        // The same job once the share is withdrawn.
        const lost = world({ personal: true });
        lost.lose("unshared", 1);
        await runExtractionJob({ ...DATA, authorization: null }, { db: lost.db as never, publish: vi.fn(async () => {}) });
        expect(cellStates(lost)).toEqual([["pending", null], ["pending", null]]);
    });

    it("leaves the row out, with one warning that names no document, when the question cannot be answered", async () => {
        const w = world();
        w.failSelects.push("documents");

        await expect(runExtractionJob(DATA, { db: w.db as never, publish: vi.fn(async () => {}) })).resolves.toBeUndefined();

        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(cellStates(w)).toEqual([["pending", null], ["pending", null]]);
        const warnings = reportError.mock.calls.filter((call) => (call[1] as { level?: string } | undefined)?.level === "warning");
        expect(warnings).toHaveLength(1);
        expect(JSON.stringify(warnings[0])).not.toMatch(/doc-\d/);
    });

    it("leaves the row out when the person's account cannot be read", async () => {
        const w = world({ personal: true });
        (w.db as unknown as { auth: { admin: { getUserById: () => Promise<unknown> } } }).auth.admin.getUserById =
            async () => ({ data: null, error: { message: "unavailable" } });

        await expect(runExtractionJob({ ...DATA, authorization: null }, { db: w.db as never, publish: vi.fn(async () => {}) })).resolves.toBeUndefined();

        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(cellStates(w)).toEqual([["pending", null], ["pending", null]]);
    });
});
