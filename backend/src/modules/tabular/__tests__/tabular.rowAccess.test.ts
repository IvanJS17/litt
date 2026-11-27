// A table generation that is already running asks, for every row, whether the
// person it works for can open every source document of that row NOW: when the
// row's text is about to be loaded and again before each result is saved or
// streamed. A row that fails the question is left out and the run goes on.
// The organization's authorization epoch never changes in these tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/observability/report")>()),
    reportError,
}));

import * as epoch from "../../../lib/authorizationEpoch";
import { streamTabularGenerateSync } from "../tabular.generateStream";
import type { ReviewRow } from "../tabular.rows";
import {
    ROW_ACCESS_EMAIL,
    ROW_ACCESS_ORG,
    documentQuestions,
    rowAccessWorld,
    type ReadLoss,
} from "../../../__tests__/helpers/rowAccessWorld";

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

type Frame = { type: string; status: string; row_id: string; content: unknown };

/** What the run's start leaves behind: every cell of every row claimed by the run. */
function claimed(w: ReturnType<typeof rowAccessWorld>, rows: ReviewRow[], generationId: string) {
    const cellMap = new Map<string, Record<string, unknown>>();
    for (const row of rows)
        for (const col of COLUMNS) {
            const cell = { id: `cell-${row.id}-${col.index}`, review_id: "rev-1", row_id: row.id, column_index: col.index, status: "pending", content: null, generation_id: generationId };
            w.tables.tabular_cells.push(cell);
            cellMap.set(`${row.id}:${col.index}`, cell);
        }
    return cellMap;
}

async function run(w: ReturnType<typeof rowAccessWorld>, rows: ReviewRow[], personal = false) {
    const stamp = personal ? null : await epoch.readAuthorizationStamp(w.db, ROW_ACCESS_ORG);
    const frames: Frame[] = [];
    const controller = new AbortController();
    const stop = vi.fn(() => controller.abort());
    const completed = await streamTabularGenerateSync({
        write: (line) => (frames.push(JSON.parse(line.slice(6))), true),
        db: w.db, reviewId: "rev-1", userId: "user-1", userEmail: ROW_ACCESS_EMAIL, columns: COLUMNS, rows,
        cellMap: claimed(w, rows, "gen-1"), model: "m", apiKeys: {}, generationId: "gen-1",
        abortSignal: controller.signal, orgId: personal ? null : ROW_ACCESS_ORG, authorization: stamp, stop,
    });
    return { completed, frames, stop };
}

const cellsOf = (w: ReturnType<typeof rowAccessWorld>, rowId: string) => w.tables.tabular_cells.filter((cell) => cell.row_id === rowId);
const framesOf = (frames: Frame[], rowId: string) => frames.filter((frame) => frame.row_id === rowId);
const modelAnswer = async (cols: { index: number }[], onResult: (index: number, result: unknown) => Promise<void>) => {
    for (const col of cols) await onResult(col.index, { summary: `v${col.index}`, flag: "green", reasoning: "" });
};
const loadedRows = () => loadRowDocumentText.mock.calls.map((call) => (call[1] as ReviewRow).id);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    queryTabularAllColumns.mockReset();
    loadRowDocumentText.mockReset();
    reportError.mockReset();
    loadRowDocumentText.mockResolvedValue("## Source document\ntext");
    queryTabularAllColumns.mockImplementation(async (_m, _label, _text, cols, onResult) => modelAnswer(cols, onResult));
});
afterEach(() => vi.useRealTimers());

const LOSSES: ReadLoss[] = ["override", "private", "moved", "deleted"];

describe("a running table generation and the person's access to a row's documents", () => {
    it.each(LOSSES)("leaves out the row whose document the person can no longer open (%s) and finishes the others", async (loss) => {
        const w = rowAccessWorld({ documents: 5 });
        // The access goes while the first rows are being worked, before the last one is reached.
        queryTabularAllColumns.mockImplementationOnce(async (_m, _label, _text, cols, onResult) => {
            w.lose(loss, 5);
            await modelAnswer(cols, onResult);
        });
        const { completed, frames } = await run(w, makeRows(5));

        expect(completed).toBe(true);
        expect(loadedRows()).not.toContain("row-5");
        expect(queryTabularAllColumns.mock.calls.map((call) => call[1])).not.toContain("Doc 5.pdf");
        // No content frame for the left-out row; its cells are neither generating nor stamped.
        expect(framesOf(frames, "row-5").filter((frame) => frame.status === "done" || frame.status === "generating")).toEqual([]);
        expect(framesOf(frames, "row-5").every((frame) => frame.content === null)).toBe(true);
        expect(cellsOf(w, "row-5").map((cell) => [cell.status, cell.content ?? null, cell.generation_id ?? null]))
            .toEqual([["pending", null, null], ["pending", null, null]]);
        // The other rows are complete.
        for (const id of ["row-1", "row-2", "row-3", "row-4"])
            expect(cellsOf(w, id).map((cell) => cell.status)).toEqual(["done", "done"]);
        expect(frames.filter((frame) => frame.status === "done")).toHaveLength(8);
    });

    it.each(LOSSES)("saves and streams nothing of a row whose document is lost between its load and its save (%s)", async (loss) => {
        const w = rowAccessWorld({ documents: 4 });
        loadRowDocumentText.mockImplementation(async (_db, row: ReviewRow) => {
            if (row.id === "row-3") {
                w.lose(loss, 3);
                // The model takes a while: the earlier answer is older than the cache allows.
                vi.setSystemTime(Date.now() + 6_000);
            }
            return "## Source document\ntext";
        });
        const { completed, frames } = await run(w, makeRows(4));

        expect(completed).toBe(true);
        expect(framesOf(frames, "row-3").filter((frame) => frame.status === "done")).toEqual([]);
        expect(cellsOf(w, "row-3").map((cell) => [cell.status, cell.content ?? null, cell.generation_id ?? null]))
            .toEqual([["pending", null, null], ["pending", null, null]]);
        for (const id of ["row-1", "row-2", "row-4"])
            expect(cellsOf(w, id).map((cell) => cell.status)).toEqual(["done", "done"]);
    });

    it("leaves out a row of a personal review whose shared document is un-shared during the run", async () => {
        const w = rowAccessWorld({ documents: 5, personal: true });
        queryTabularAllColumns.mockImplementationOnce(async (_m, _label, _text, cols, onResult) => {
            w.lose("unshared", 5);
            await modelAnswer(cols, onResult);
        });
        const { completed, frames } = await run(w, makeRows(5), true);

        expect(completed).toBe(true);
        expect(loadedRows()).not.toContain("row-5");
        expect(cellsOf(w, "row-5").map((cell) => [cell.status, cell.generation_id ?? null])).toEqual([["pending", null], ["pending", null]]);
        expect(frames.filter((frame) => frame.status === "done")).toHaveLength(8);
    });

    it("runs exactly as before while access is kept, with one question per row", async () => {
        const w = rowAccessWorld({ documents: 4 });
        const { completed, frames } = await run(w, makeRows(4));

        expect(completed).toBe(true);
        expect(frames.filter((frame) => frame.status === "done")).toHaveLength(8);
        expect(w.tables.tabular_cells.every((cell) => cell.status === "done" && cell.generation_id === null)).toBe(true);
        expect(loadedRows().sort()).toEqual(["row-1", "row-2", "row-3", "row-4"]);
        // Two columns per row, answered within the minute: asked once before the load, remembered for the saves.
        expect(documentQuestions(w.calls)).toBe(4);
    });

    it("asks again only after the answer is older than five seconds", async () => {
        const w = rowAccessWorld({ documents: 1 });
        const columns = [0, 1, 2, 3].map((index) => ({ index, name: `C${index}`, prompt: "p" }));
        queryTabularAllColumns.mockImplementation(async (_m, _label, _text, cols, onResult) => {
            for (const col of cols) {
                await onResult(col.index, { summary: "v", flag: "green", reasoning: "" });
                // Only the first answer is followed by a long wait.
                if (col.index === 1) vi.setSystemTime(Date.now() + 6_000);
            }
        });
        const rows = makeRows(1);
        const cellMap = new Map<string, Record<string, unknown>>();
        const frames: Frame[] = [];
        await streamTabularGenerateSync({
            write: (line) => (frames.push(JSON.parse(line.slice(6))), true),
            db: w.db, reviewId: "rev-1", userId: "user-1", userEmail: ROW_ACCESS_EMAIL, columns, rows, cellMap,
            model: "m", apiKeys: {}, generationId: "gen-1", abortSignal: new AbortController().signal,
            orgId: null, authorization: null, stop: vi.fn(),
        });

        expect(frames.filter((frame) => frame.status === "done")).toHaveLength(4);
        // Before the load, then once more when the answer had grown old (before the third column).
        expect(documentQuestions(w.calls)).toBe(2);
    });

    it("leaves a row out, and warns once without naming a document, when the question cannot be answered", async () => {
        const w = rowAccessWorld({ documents: 5 });
        queryTabularAllColumns.mockImplementationOnce(async (_m, _label, _text, cols, onResult) => {
            w.failSelects.push("documents");
            await modelAnswer(cols, onResult);
        });
        const { completed } = await run(w, makeRows(5));

        expect(completed).toBe(true);
        expect(loadedRows()).not.toContain("row-5");
        expect(cellsOf(w, "row-5").map((cell) => [cell.status, cell.generation_id ?? null])).toEqual([["pending", null], ["pending", null]]);
        const warnings = reportError.mock.calls.filter((call) => (call[1] as { level?: string } | undefined)?.level === "warning");
        expect(warnings).toHaveLength(1);
        expect(JSON.stringify(warnings[0])).not.toMatch(/doc-\d/);
    });
});
