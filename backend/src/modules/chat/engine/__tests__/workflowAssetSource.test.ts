import { expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ content: vi.fn(async () => "Asset text") }));
vi.mock("../../../../lib/workflowWorkspace", async (original) => ({
  ...(await original<typeof import("../../../../lib/workflowWorkspace")>()),
  canUseWorkflowInWorkspace: async () => true,
}));
vi.mock("../tools/documentOps", async (original) => ({
  ...(await original<typeof import("../tools/documentOps")>()),
  readDocumentContent: reads.content,
}));
import { runToolCalls } from "../tools/toolDispatcher";
import type { DocStore, WorkflowStore } from "../types";

// A workflow's own file is a stored document filed under that workflow. What
// the assistant reads from it is recorded with that document's id, so the
// source of an answer can be checked against the workflow's current access.
const ASSET = "00000000-0000-4000-8000-0000000000c1";
const WF = "00000000-0000-4000-8000-0000000000c2";
const call = (id: string, name: string, args: object) => ({ id, function: { name, arguments: JSON.stringify(args) } });

it("records the document id of a workflow file the assistant reads", async () => {
  const workflows: WorkflowStore = new Map([
    [WF, { title: "Guide", skill_md: "Steps", assets: [{ asset_id: ASSET, filename: "plantilla.docx", file_type: "docx", storage_path: "p/plantilla.docx" }] }],
  ]);
  const store: DocStore = new Map();
  const db = { from: () => { throw new Error("no query expected"); } } as never;
  await runToolCalls([call("a", "read_workflow", { workflow_id: WF })], store, "u", db, vi.fn(), workflows);
  const handle = `workflow-asset-${WF}-1`;
  expect(store.has(handle)).toBe(true);

  const read = await runToolCalls([call("b", "read_document", { doc_id: handle })], store, "u", db, vi.fn(), workflows);
  expect(read.docsRead).toEqual([expect.objectContaining({ filename: "plantilla.docx", document_id: ASSET })]);

  const fetched = await runToolCalls([call("c", "fetch_documents", { doc_ids: [handle] })], store, "u", db, vi.fn(), workflows);
  expect(fetched.docsRead).toEqual([expect.objectContaining({ filename: "plantilla.docx", document_id: ASSET })]);
});
