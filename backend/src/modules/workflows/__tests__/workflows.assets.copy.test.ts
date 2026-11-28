import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  workflowAccess: vi.fn(),
  docAccess: vi.fn(),
  copyFile: vi.fn(),
  headFile: vi.fn(),
  space: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("../../../lib/storageQuota", async (original) => ({
  ...(await original<typeof import("../../../lib/storageQuota")>()),
  resolveUploadSpace: mocks.space,
  storageSpaceUsage: mocks.usage,
}));
vi.mock("../workflows.access", async (original) => ({
  ...(await original<typeof import("../workflows.access")>()),
  resolveWorkflowAccess: mocks.workflowAccess,
}));
vi.mock("../../../lib/access", async (original) => ({
  ...(await original<typeof import("../../../lib/access")>()),
  ensureDocAccess: mocks.docAccess,
  // Asset copies check each source through the batch checker (upstream #749).
  createDocumentAccessChecker: () => mocks.docAccess,
}));
vi.mock("../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../lib/documentVersions")>()),
  attachActiveVersionPaths: vi.fn(),
  attachLatestVersionNumbers: vi.fn(),
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  copyFile: mocks.copyFile,
  headFile: mocks.headFile,
}));
import { copyDocumentsToWorkflowAssets } from "../workflows.service";

const source = {
  id: "doc",
  user_id: "actor",
  project_id: null,
  org_id: "org",
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
  mocks.workflowAccess.mockResolvedValue({ allowEdit: true, workflow: { org_id: "org", type: "assistant" } });
  mocks.docAccess.mockResolvedValue({ ok: true });
  mocks.copyFile.mockResolvedValue(undefined);
  mocks.headFile.mockResolvedValue({ size: 0, etag: null, contentType: null });
  mocks.space.mockResolvedValue({ ok: true, space: { orgId: "org", userId: null } });
  mocks.usage.mockResolvedValue({ usedBytes: 0, limitBytes: 1000 });
});

describe("copying documents into workflow assets", () => {
  it.each([
    ["a pasante's source keeps its author, not the copying actor", [{ training_author_user_id: "pasante-1", training_stage: "pasante" }], true],
    ["an unsealed source stays unsealed", [{ training_author_user_id: null, training_stage: null }], false],
  ])("%s", async (_name, sourceSeal, sealed) => {
    const fake = scriptedDb([
      { table: "documents", data: [source] },
      { table: "documents", data: [source] },
      { table: "organizations", data: [{ id: "org", kind: "team" }] },
      { table: "document_versions", data: [sourceVersion] },
      { table: "documents", op: "insert" },
      { table: "document_versions", data: sourceSeal },
      ...(sealed ? [{ table: "documents", data: { org_id: "org" } }] : []),
      { rpc: "create_document_version" },
      { table: "documents", data: [{ id: "created" }] },
    ]);
    const result = await copyDocumentsToWorkflowAssets(fake.db, {
      workflowId: "workflow", userId: "actor", userEmail: undefined, documentIds: ["doc"],
    });
    expect(result).toMatchObject({ ok: true });
    // A8: the asset belongs to the workflow's organization, where it is approved.
    expect(fake.calls.find((c) => c.op === "insert")?.payload).toEqual([
      expect.objectContaining({ project_id: null, org_id: "org", workflow_id: "workflow" }),
    ]);
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

describe("a pasante's copy where nobody could approve it", () => {
  it("is not made in a workflow without an organization, and the copy is rolled back", async () => {
    mocks.workflowAccess.mockResolvedValue({ allowEdit: true, workflow: { org_id: null, type: "assistant" } });
    const personal = { ...source, org_id: null };
    const fake = scriptedDb([
      { table: "documents", data: [personal] },
      { table: "documents", data: [personal] },
      { table: "document_versions", data: [sourceVersion] },
      { table: "documents", op: "insert" },
      { table: "document_versions", data: [{ training_author_user_id: "pasante-1", training_stage: "pasante" }] },
      { table: "documents", data: { org_id: null } },
      { table: "documents", op: "delete" },
      { table: "db_jobs", op: "insert" },
    ]);
    const result = await copyDocumentsToWorkflowAssets(fake.db, {
      workflowId: "workflow", userId: "actor", userEmail: undefined, documentIds: ["doc"],
    });
    // R1: a refusal the caller can explain, not a generic database error.
    expect(result).toEqual({ ok: false, kind: "training_copy_needs_organization" });
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(fake.calls.some((c) => c.op === "delete")).toBe(true);
  });
});

describe("copying documents into workflow assets asks the storage space", () => {
  const params = { workflowId: "workflow", userId: "actor", userEmail: undefined, documentIds: ["doc"] };
  const reads = () => [
    { table: "documents", data: [source] },
    { table: "documents", data: [source] },
    { table: "organizations", data: [{ id: "org", kind: "team" }] },
    { table: "document_versions", data: [sourceVersion] },
  ];
  it("copies in the store when the bytes fit exactly", async () => {
    mocks.usage.mockResolvedValue({ usedBytes: 996, limitBytes: 1000 });
    const fake = scriptedDb([
      ...reads(),
      { table: "documents", op: "insert" },
      { table: "document_versions", data: [{ training_author_user_id: null, training_stage: null }] },
      { rpc: "create_document_version" },
      { table: "documents", data: [{ id: "created" }] },
    ]);
    expect(await copyDocumentsToWorkflowAssets(fake.db, params)).toMatchObject({ ok: true });
    expect(mocks.space).toHaveBeenCalledWith(fake.db, expect.objectContaining({
      purpose: "document_create", destination: { scope: "workflow", workflow_id: "workflow" },
    }));
    expect(mocks.copyFile).toHaveBeenCalledOnce();
  });
  it.each([
    ["does not fit", () => mocks.usage.mockResolvedValue({ usedBytes: 997, limitBytes: 1000 }), "storage_quota_exceeded"],
    ["cannot be read", () => mocks.usage.mockRejectedValue(new Error("unreadable")), "db_error"],
  ])("refuses when the space %s: no object copied, no row written", async (_name, arrange, kind) => {
    arrange();
    const fake = scriptedDb([...reads(), { table: "documents", op: "delete" }]);
    expect(await copyDocumentsToWorkflowAssets(fake.db, params)).toMatchObject({ ok: false, kind });
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(fake.calls.some((c) => c.op === "insert" || c.op === "rpc")).toBe(false);
  });
  it("asks for the whole batch before the first object is copied", async () => {
    const second = { ...source, id: "doc2", current_version_id: "v2" };
    const versions = [sourceVersion, { ...sourceVersion, id: "v2", document_id: "doc2", size_bytes: 600 }];
    mocks.usage.mockResolvedValue({ usedBytes: 0, limitBytes: 500 });
    const fake = scriptedDb([
      { table: "documents", data: [source, second] },
      { table: "documents", data: [source, second] },
      { table: "organizations", data: [{ id: "org", kind: "team" }] },
      { table: "document_versions", data: versions },
      { table: "documents", op: "delete" },
    ]);
    expect(await copyDocumentsToWorkflowAssets(fake.db, { ...params, documentIds: ["doc", "doc2"] }))
      .toMatchObject({ ok: false, kind: "storage_quota_exceeded" });
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });
  const batch = (n: number, sizes: (number | null)[]) => {
    const docs = Array.from({ length: n }, (_, i) => ({ ...source, id: `doc${i}`, current_version_id: `v${i}` }));
    const versions = docs.map((d, i) => ({ ...sourceVersion, id: `v${i}`, document_id: d.id, size_bytes: sizes[i] }));
    return {
      ids: docs.map((d) => d.id),
      reads: [
        { table: "documents", data: docs },
        { table: "documents", data: docs },
        { table: "organizations", data: [{ id: "org", kind: "team" }] },
        { table: "document_versions", data: versions },
      ],
    };
  };
  it("asks the usage once for a batch of three, then copies all three", async () => {
    const { ids, reads } = batch(3, [1, 1, 1]);
    const fake = scriptedDb([
      ...reads,
      { table: "documents", op: "insert" },
      { table: "document_versions", data: [{ training_author_user_id: null, training_stage: null }] },
      { rpc: "create_document_version" },
      { table: "document_versions", data: [{ training_author_user_id: null, training_stage: null }] },
      { rpc: "create_document_version" },
      { table: "document_versions", data: [{ training_author_user_id: null, training_stage: null }] },
      { rpc: "create_document_version" },
      { table: "documents", data: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    ]);
    const result = await copyDocumentsToWorkflowAssets(fake.db, { ...params, documentIds: ids });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.usage).toHaveBeenCalledOnce();
    expect(mocks.space).toHaveBeenCalledOnce();
    expect(mocks.copyFile).toHaveBeenCalledTimes(3);
  });
  it("counts a source whose row has no size with its object's own size", async () => {
    const { ids, reads } = batch(2, [10, null]);
    mocks.usage.mockResolvedValue({ usedBytes: 0, limitBytes: 500 });
    mocks.headFile.mockResolvedValue({ size: 600, etag: null, contentType: null });
    const fake = scriptedDb([...reads, { table: "documents", op: "delete" }]);
    expect(await copyDocumentsToWorkflowAssets(fake.db, { ...params, documentIds: ids }))
      .toMatchObject({ ok: false, kind: "storage_quota_exceeded" });
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });
});
