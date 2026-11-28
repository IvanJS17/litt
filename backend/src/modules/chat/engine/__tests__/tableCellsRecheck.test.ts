import { beforeEach, describe, expect, it, vi } from "vitest";

// A table-review chat asks again, at each read of the table, whether the person
// may still open the review and which of the requested rows they may still
// read. The copy of the rows taken when the turn started decides nothing.

const mocks = vi.hoisted(() => ({
  reviewAccess: vi.fn(),
  accessible: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("../../../../lib/observability/report", async (load) => ({
  ...await load<object>(), reportError: mocks.reportError,
}));
vi.mock("../../../../lib/access", async (load) => ({
  ...await load<object>(),
  ensureReviewAccess: mocks.reviewAccess,
  filterAccessibleDocumentIds: mocks.accessible,
}));

import { runToolCalls } from "../tools/toolDispatcher";
import type { TabularCellStore } from "../types";

const ME = "11111111-1111-4111-8111-111111111111";
const EMAIL = "me@example.test";
const REVIEW = { id: "review-1", user_id: "someone-else", project_id: "proj", org_id: "firm" };
const UNREADABLE = "Table could not be read.";

const row = (id: string, label: string, sources: string[]) => ({
  id, review_id: REVIEW.id, label, row_type: "document" as const, folder_id: null,
  library_folder_id: null, document_id: sources[0] ?? null, sort_index: 0, source_document_ids: sources,
});
const rows = [row("row-a", "alpha.docx", ["doc-a"]), row("row-b", "bravo.docx", ["doc-b"]), row("row-c", "charlie.docx", ["doc-c"])];

function tableStore(withRecheck = true): TabularCellStore {
  return {
    columns: [{ index: 0, name: "Term" }],
    documents: rows.map((r) => ({ id: r.id, filename: r.label })),
    cells: new Map([
      ["0:row-a", { summary: "alpha twelve months" }],
      ["0:row-b", { summary: "bravo twenty-four months" }],
      ["0:row-c", { summary: "charlie six months" }],
    ]),
    ...(withRecheck ? { recheck: { loadReview: async () => REVIEW, rows } } : {}),
  };
}

const call = (args: Record<string, unknown> = {}) => ({
  id: "call", function: { name: "read_table_cells", arguments: JSON.stringify(args) },
});
const read = (store: TabularCellStore, args: Record<string, unknown> = {}) =>
  runToolCalls([call(args)], new Map(), ME, {} as never, () => {}, undefined, store, undefined, undefined, new Map(), "proj", "nonce",
    { userEmail: EMAIL });
const text = (r: { toolResults: unknown[] }) => (r.toolResults[0] as { content: string }).content;

let readable: Set<string>;
beforeEach(() => {
  vi.clearAllMocks();
  readable = new Set(["doc-a", "doc-b", "doc-c"]);
  mocks.reviewAccess.mockResolvedValue({ ok: true });
  mocks.accessible.mockImplementation(async (ids: string[]) => ids.filter((id) => readable.has(id)));
});

describe("read_table_cells in a running review chat", () => {
  it("serves the same cells while access is unchanged", async () => {
    const r = await read(tableStore());
    expect(text(r)).toContain("alpha twelve months");
    expect(text(r)).toContain("bravo twenty-four months");
    expect(text(r)).toContain("charlie six months");
    expect(mocks.reviewAccess).toHaveBeenCalledWith(REVIEW, ME, EMAIL, expect.anything());
    // Positions stay those of the full table, which the model passes back.
    const only = await read(tableStore(), { row_indices: [1] });
    expect(text(only)).toContain('ROW:1 "bravo.docx"');
    expect(text(only)).not.toContain("alpha");
  });

  it("gives no cells once the person has lost the review", async () => {
    mocks.reviewAccess.mockResolvedValue({ ok: false });
    const r = await read(tableStore());
    expect(text(r)).toContain(UNREADABLE);
    for (const word of ["alpha", "bravo", "charlie", "twelve"]) expect(text(r)).not.toContain(word);
    expect(r.docsRead).toHaveLength(0);
  });

  it("leaves out only the rows whose documents the person can no longer read, keeping positions", async () => {
    readable.delete("doc-a");
    const r = await read(tableStore());
    expect(text(r)).not.toContain("alpha");
    expect(text(r)).toContain('ROW:1 "bravo.docx"');
    expect(text(r)).toContain('ROW:2 "charlie.docx"');
    expect(r.docsRead[0].filename).toBe("1 column × 2 rows");
  });

  it("asks the document question once for the whole table, not per row", async () => {
    await read(tableStore());
    expect(mocks.accessible).toHaveBeenCalledTimes(1);
  });

  it("gives no cells when the review check fails", async () => {
    mocks.reviewAccess.mockRejectedValue(new Error("database down"));
    const r = await read(tableStore());
    expect(text(r)).toContain(UNREADABLE);
    expect(text(r)).not.toContain("alpha");
    expect(text(r)).not.toContain("database down");
  });

  it("gives no cells once the review no longer exists", async () => {
    const store = tableStore();
    store.recheck!.loadReview = async () => null;
    const r = await read(store);
    expect(text(r)).toContain(UNREADABLE);
    expect(text(r)).not.toContain("alpha");
    expect(mocks.reviewAccess).not.toHaveBeenCalled();
  });

  it("gives no cells when the review cannot be read", async () => {
    const store = tableStore();
    store.recheck!.loadReview = async () => { throw new Error("database down"); };
    const r = await read(store);
    expect(text(r)).toContain(UNREADABLE);
    expect(text(r)).not.toContain("alpha");
    expect(text(r)).not.toContain("database down");
  });

  it("gives no cells when the row check fails", async () => {
    mocks.accessible.mockRejectedValue(new Error("database down"));
    const r = await read(tableStore());
    expect(text(r)).toContain(UNREADABLE);
    expect(text(r)).not.toContain("alpha");
    expect(text(r)).not.toContain("database down");
  });

  it("gives no cells from a table that carries nothing to check against", async () => {
    const r = await read(tableStore(false));
    expect(text(r)).toContain(UNREADABLE);
    expect(text(r)).not.toContain("alpha");
  });
});
