import { beforeEach, describe, expect, it, vi } from "vitest";

// A turn a connected application started asks, before each tool call, whether
// that connection is still good. When it is not (or the question cannot be
// answered) the call does not run and the dispatcher raises the connection-ended
// error, which the stream ends as a stopped turn (pinned in
// connectionEndedStop.test.ts). A turn
// the web started asks nothing.

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

import { isConnectionEnded } from "../tools/connectionEnded";
import { emptyToolCallBatchResult } from "../tools/toolBatchResult";
import { runToolCalls } from "../tools/toolDispatcher";
import type { TabularCellStore } from "../types";

const ME = "11111111-1111-4111-8111-111111111111";
const row = { id: "row-a", review_id: "r", label: "alpha.docx", row_type: "document" as const, folder_id: null,
  library_folder_id: null, document_id: "doc-a", sort_index: 0, source_document_ids: ["doc-a"] };
const store: TabularCellStore = {
  columns: [{ index: 0, name: "Term" }],
  documents: [{ id: "row-a", filename: "alpha.docx" }],
  cells: new Map([["0:row-a", { summary: "alpha twelve months" }]]),
  recheck: { loadReview: async () => ({ id: "r", user_id: "x", project_id: null }), rows: [row] },
};
const call = (id: string) => ({ id, function: { name: "read_table_cells", arguments: "{}" } });
const run = (calls: ReturnType<typeof call>[], connectionCheck?: () => Promise<boolean>) =>
  runToolCalls(calls, new Map(), ME, {} as never, () => {}, undefined, store, undefined, undefined, new Map(), null, "nonce",
    { userEmail: "me@example.test", allowedCapabilities: ["read"], ...(connectionCheck ? { connectionCheck } : {}) });
const served = () => mocks.reviewAccess.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reviewAccess.mockResolvedValue({ ok: true });
  mocks.accessible.mockImplementation(async (ids: string[]) => ids);
});

describe("a connected application's turn asks whether its connection is still good", () => {
  it("runs every call while the connection is good, asking once per call", async () => {
    const check = vi.fn(async () => true);
    const r = await run([call("a"), call("b")], check);
    expect(check).toHaveBeenCalledTimes(2);
    expect(served()).toBe(2);
    expect(r.toolResults).toHaveLength(2);
  });

  it("does not run the call after the connection ended, and raises the connection-ended error", async () => {
    let good = true;
    const check = vi.fn(async () => good);
    const first = await run([call("a")], check);
    expect(JSON.stringify(first.toolResults)).toContain("alpha twelve months");
    good = false;
    await expect(run([call("b"), call("c")], check)).rejects.toSatisfy(isConnectionEnded);
    expect(served()).toBe(1);
  });

  it("stops in the middle of a batch: the call before the end ran, the one after did not", async () => {
    let asked = 0;
    const check = async () => ++asked < 2;
    const batch = emptyToolCallBatchResult();
    await expect(
      runToolCalls([call("a"), call("b")], new Map(), ME, {} as never, () => {}, undefined, store, undefined, undefined, new Map(), null, "nonce",
        { userEmail: "me@example.test", allowedCapabilities: ["read"], connectionCheck: check, results: batch }),
    ).rejects.toSatisfy(isConnectionEnded);
    expect(served()).toBe(1);
    expect(batch.toolResults).toHaveLength(1);
  });

  it("does not run the call when the check cannot be answered, and names nothing of the failure", async () => {
    const check = vi.fn(async () => { throw new Error("private database detail"); });
    const error = await run([call("a")], check).then(() => null, (e: unknown) => e);
    expect(isConnectionEnded(error)).toBe(true);
    expect(String((error as Error).message)).not.toContain("private database detail");
    expect(served()).toBe(0);
  });

  it("asks nothing in a turn the web started", async () => {
    const r = await run([call("a"), call("b")]);
    expect(r.toolResults).toHaveLength(2);
    expect(served()).toBe(2);
  });
});
