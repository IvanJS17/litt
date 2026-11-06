import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  workflowAccess: vi.fn(),
  docAccess: vi.fn(),
  copyFile: vi.fn(),
}));
vi.mock("../workflows.access", async (original) => ({
  ...(await original<typeof import("../workflows.access")>()),
  resolveWorkflowAccess: mocks.workflowAccess,
}));
vi.mock("../../../lib/access", async (original) => ({
  ...(await original<typeof import("../../../lib/access")>()),
  ensureDocAccess: mocks.docAccess,
}));
vi.mock("../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../lib/documentVersions")>()),
  attachActiveVersionPaths: vi.fn(),
  attachLatestVersionNumbers: vi.fn(),
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  copyFile: mocks.copyFile,
}));
import { copyDocumentsToWorkflowAssets } from "../workflows.service";

const source = {
  id: "doc",
  user_id: "actor",
  project_id: null,
  org_id: null,
  workflow_id: null,
  current_version_id: "source-version",
};
const sourceVersion = {
  id: "source-version",
  document_id: "doc",
  storage_path: "src/key.docx",
  pdf_storage_path: null,
  filename: "Source.docx",
  file_type: "docx",
  size_bytes: 4,
  page_count: null,
  textless_page_count: null,
  content_sha256: "hash",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflowAccess.mockResolvedValue({ allowEdit: true, workflow: { org_id: null, type: "assistant" } });
  mocks.docAccess.mockResolvedValue({ ok: true });
  mocks.copyFile.mockResolvedValue(undefined);
});

describe("copying documents into workflow assets", () => {
  it.each([
    ["a pasante's source keeps its author, not the copying actor", [{ training_author_user_id: "pasante-1", training_stage: "pasante" }], true],
    ["an unsealed source stays unsealed", [], false],
  ])("%s", async (_name, sourceSeal, sealed) => {
    const fake = scriptedDb([
      { table: "documents", data: [source] },
      { table: "documents", data: [source] },
      { table: "document_versions", data: [sourceVersion] },
      { table: "documents", op: "insert" },
      { table: "document_versions", data: sourceSeal },
      { rpc: "create_document_version" },
      { table: "documents", data: [{ id: "created" }] },
    ]);
    const result = await copyDocumentsToWorkflowAssets(fake.db, {
      workflowId: "workflow", userId: "actor", userEmail: undefined, documentIds: ["doc"],
    });
    expect(result).toMatchObject({ ok: true });
    const seal = fake.calls.filter((c) => c.table === "document_versions" && c.op === "select")[1];
    expect(seal.filters).toEqual([["eq", "id", "source-version"]]);
    const version = (fake.calls.find((c) => c.op === "rpc")?.args as { p_version: Record<string, unknown> }).p_version;
    expect(version).not.toHaveProperty("authorship");
    if (sealed) expect(version).toMatchObject({ training_author_user_id: "pasante-1", training_stage: "pasante" });
    else {
      expect(version).not.toHaveProperty("training_author_user_id");
      expect(version).not.toHaveProperty("training_stage");
    }
    fake.done();
  });
});
