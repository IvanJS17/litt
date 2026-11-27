// Regenerating one cell on the request itself (no queue) loads the row's text
// and waits for the model for a while. It asks whether the person can open
// every source document of the row when it is about to load the text, and
// again before the result is saved. The organization's epoch never changes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureReviewAccess } = vi.hoisted(() => ({ ensureReviewAccess: vi.fn() }));
// Only the verdict on the review itself is driven by the test; the answer about
// the row's documents is the real one, over the in-memory world.
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    ensureReviewAccess,
}));

vi.mock("../../../lib/queue/extractionQueue", () => ({
    enqueueExtraction: vi.fn(),
    removeQueuedExtractionJobs: vi.fn(),
}));

const queryTabularCell = vi.hoisted(() => vi.fn());
vi.mock("../tabular.extract", () => ({ queryTabularCell }));
vi.mock("../tabular.generateStream", () => ({ awaitCellTerminal: vi.fn() }));
vi.mock("../tabular.citationSupport", () => ({ createTabularCellCheck: () => vi.fn() }));

const { loadReviewRow, loadRowDocumentText } = vi.hoisted(() => ({ loadReviewRow: vi.fn(), loadRowDocumentText: vi.fn() }));
vi.mock("../tabular.rows", () => ({ loadReviewRow, loadRowDocumentText }));

const validateSelectedModel = vi.hoisted(() => vi.fn());
vi.mock("../tabular.shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.shared")>()),
    validateSelectedModel,
}));

import { regenerateTabularCell } from "../tabular.cells";
import { ROW_ACCESS_EMAIL, rowAccessWorld, type ReadLoss } from "../../../__tests__/helpers/rowAccessWorld";

const ROW = {
    id: "row-1", review_id: "rev-1", label: "Contract.pdf", row_type: "document", folder_id: null,
    library_folder_id: null, document_id: "doc-1", sort_index: 0, source_document_ids: ["doc-1"],
};
const RESULT = { summary: "new", flag: "green", reasoning: "" };

/** `onStart` runs when the request takes the review's lease: after its first checks, before the text is loaded. */
function world(onStart: () => void = () => undefined) {
    const w = rowAccessWorld({ documents: 1 });
    Object.assign(w.tables.tabular_reviews[0], {
        user_id: "user-1", updated_at: "2026-01-01T00:00:00.000Z", model: "claude-sonnet-5",
        columns_config: [{ index: 0, name: "A", prompt: "a" }], active_generation_id: null, generation_lease_expires_at: null,
    });
    w.tables.tabular_cells.push({ id: "cell-0", review_id: "rev-1", row_id: "row-1", column_index: 0, status: "done", content: "old", generation_id: null });
    const rpc = w.db.rpc.bind(w.db);
    (w.db as unknown as { rpc: unknown }).rpc = async (name: string, args: Record<string, unknown>) => {
        if (name === "begin_tabular_review_generation") {
            onStart();
            return { data: "started", error: null };
        }
        return rpc(name, args);
    };
    return w;
}
const regenerate = (w: ReturnType<typeof world>) =>
    regenerateTabularCell(w.db, { reviewId: "rev-1", userId: "user-1", userEmail: ROW_ACCESS_EMAIL, rowId: "row-1", columnIndex: 0, log: { error: vi.fn() } as never });
const cell = (w: ReturnType<typeof world>) => w.tables.tabular_cells[0];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    delete process.env.ASYNC_TABULAR_EXTRACTION;
    for (const fn of [ensureReviewAccess, queryTabularCell, loadReviewRow, loadRowDocumentText, validateSelectedModel]) fn.mockReset();
    ensureReviewAccess.mockResolvedValue({ ok: true, isCreator: true, orgRole: null, projectRole: "owner" });
    loadReviewRow.mockResolvedValue(ROW);
    loadRowDocumentText.mockResolvedValue("markdown");
    queryTabularCell.mockResolvedValue(RESULT);
    validateSelectedModel.mockResolvedValue({ ok: true, model: "claude-sonnet-5", apiKeys: {} });
});
afterEach(() => vi.useRealTimers());

const LOSSES: ReadLoss[] = ["override", "private", "moved", "deleted"];

describe("regenerating one cell on the request and the person's access to the row's documents", () => {
    it.each(LOSSES)("loads no text, calls no model and writes no result when the document is lost before the load (%s)", async (loss) => {
        const w: ReturnType<typeof world> = world(() => w.lose(loss, 1));

        const result = await regenerate(w);

        expect(result).toMatchObject({ ok: false });
        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(queryTabularCell).not.toHaveBeenCalled();
        expect([cell(w).status, cell(w).content ?? null, cell(w).generation_id ?? null]).toEqual(["pending", null, null]);
    });

    it.each(LOSSES)("saves nothing when the document is lost between the load and the save (%s)", async (loss) => {
        const w = world();
        loadRowDocumentText.mockImplementation(async () => {
            w.lose(loss, 1);
            vi.setSystemTime(Date.now() + 6_000);
            return "markdown";
        });

        const result = await regenerate(w);

        expect(result).toMatchObject({ ok: false });
        expect([cell(w).status, cell(w).content ?? null, cell(w).generation_id ?? null]).toEqual(["pending", null, null]);
    });

    it("regenerates as before while access is kept", async () => {
        const w = world();

        const result = await regenerate(w);

        expect(result).toEqual({ ok: true, data: { status: 200, body: RESULT } });
        expect([cell(w).status, cell(w).generation_id ?? null]).toEqual(["done", null]);
        expect(JSON.parse(String(cell(w).content))).toEqual(RESULT);
    });

    it("leaves the cell as a left-out row's when the question cannot be answered", async () => {
        const w = world(() => w.failSelects.push("documents"));

        const result = await regenerate(w);

        expect(result).toMatchObject({ ok: false });
        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect([cell(w).status, cell(w).generation_id ?? null]).toEqual(["pending", null]);
    });
});
