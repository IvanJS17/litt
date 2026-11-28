import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  projectAccess: vi.fn(),
  docAccess: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  copyFile: vi.fn(),
  readStream: vi.fn(),
  space: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("../../../lib/storageQuota", async (original) => ({
  ...(await original<typeof import("../../../lib/storageQuota")>()),
  resolveUploadSpace: mocks.space,
  storageSpaceUsage: mocks.usage,
}));
vi.mock("../../../lib/access", async (original) => ({
  ...(await original<typeof import("../../../lib/access")>()),
  checkProjectAccess: mocks.projectAccess,
  ensureDocAccess: mocks.docAccess,
}));
vi.mock("../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../lib/documentVersions")>()),
  attachActiveVersionPaths: vi.fn(),
}));
vi.mock("../../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../../lib/storage")>()),
  downloadFile: mocks.downloadFile,
  uploadFile: mocks.uploadFile,
  copyFile: mocks.copyFile,
  createFileReadStream: mocks.readStream,
}));
import { assignOrCopyDocument } from "../projects.service";

const firmDoc = {
  id: "doc",
  user_id: "actor",
  project_id: "firm-matter",
  org_id: "firm",
  workflow_id: null,
  current_version_id: "v1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copyFile.mockResolvedValue(undefined);
  mocks.readStream.mockImplementation(() => Readable.from([Buffer.from("streamed")]));
  mocks.space.mockResolvedValue({ ok: true, space: { orgId: null, userId: "actor" } });
  mocks.usage.mockResolvedValue({ usedBytes: 0, limitBytes: 1000 });
  mocks.projectAccess.mockResolvedValue({
    ok: true,
    projectRole: "owner",
    project: { org_id: "firm" },
  });
});

// What the workspace check reads about the source: where it is filed, its
// project's organization, and which of those organizations are personal.
const placementReads = [
  { table: "documents", data: [firmDoc] },
  { table: "projects", data: [{ id: "firm-matter", org_id: "firm" }] },
  { table: "organizations", data: [{ id: "firm", kind: "team" }] },
];

describe("adding a document to a project by id", () => {
  // Authorship is provenance, not access: a document the caller wrote inside
  // a firm matter stays the firm's after the caller leaves or is denied it.
  it("refuses to copy a document out of a project the author can no longer reach", async () => {
    mocks.docAccess.mockResolvedValue({ ok: false });
    const fake = scriptedDb([{ table: "documents", data: firmDoc }]);
    expect(
      await assignOrCopyDocument(fake.db, {
        projectId: "personal",
        documentId: "doc",
        userId: "actor",
        userEmail: "actor@example.com",
      }),
    ).toEqual({ ok: false, kind: "doc_not_found" });
    expect(mocks.docAccess).toHaveBeenCalledWith(
      firmDoc,
      "actor",
      "actor@example.com",
      fake.db,
    );
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    fake.done();
  });

  it("still copies when the author keeps access to the source", async () => {
    mocks.docAccess.mockResolvedValue({
      ok: true,
      isCreator: true,
      orgRole: "member",
      projectRole: "viewer",
    });
    // Stop right after the gate: the source version read is the first step
    // the copy takes once access is established.
    const fake = scriptedDb([
      { table: "documents", data: firmDoc },
      ...placementReads,
      { table: "document_versions", data: null },
    ]);
    expect(
      await assignOrCopyDocument(fake.db, {
        projectId: "other-firm-matter",
        documentId: "doc",
        userId: "actor",
      }),
    ).toEqual({ ok: false, kind: "no_active_version" });
    fake.done();
  });

  // Access to the source is not enough to take it somewhere else: the firm's
  // document stays in the firm's workspace.
  it("refuses to copy an organization's document into a personal project", async () => {
    mocks.projectAccess.mockResolvedValue({
      ok: true,
      projectRole: "owner",
      project: { org_id: null },
    });
    mocks.docAccess.mockResolvedValue({
      ok: true,
      isCreator: true,
      orgRole: "member",
      projectRole: "editor",
    });
    const fake = scriptedDb([
      { table: "documents", data: firmDoc },
      ...placementReads,
    ]);
    expect(
      await assignOrCopyDocument(fake.db, {
        projectId: "personal",
        documentId: "doc",
        userId: "actor",
      }),
    ).toEqual({ ok: false, kind: "workspace_mismatch" });
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    fake.done();
  });

  it("refuses to move a personal document into an organization's project", async () => {
    const personalDoc = { ...firmDoc, project_id: null, org_id: null };
    mocks.docAccess.mockResolvedValue({
      ok: true,
      isCreator: true,
      orgRole: null,
      projectRole: "owner",
    });
    const fake = scriptedDb([
      { table: "documents", data: personalDoc },
      { table: "documents", data: [personalDoc] },
      { table: "organizations", data: [{ id: "firm", kind: "team" }] },
    ]);
    expect(
      await assignOrCopyDocument(fake.db, {
        projectId: "firm-matter",
        documentId: "doc",
        userId: "actor",
      }),
    ).toEqual({ ok: false, kind: "workspace_mismatch" });
    // Nothing was written: the script holds no update.
    fake.done();
  });
});

it.each([
  { workflow_id: "workflow", library_kind: null },
  { workflow_id: null, library_kind: "template" },
])("copies rather than reassigning a workflow asset or template: %j", async placement => {
  mocks.projectAccess.mockResolvedValue({ ok: true, projectRole: "owner", project: { org_id: null } });
  mocks.docAccess.mockResolvedValue({ ok: true, projectRole: "owner", isCreator: true });
  const source = { ...firmDoc, project_id: null, org_id: null, ...placement };
  const fake = scriptedDb([
    { table: "documents", data: source },
    { table: "documents", data: [source] },
    { table: "document_versions", data: null },
  ]);
  expect(await assignOrCopyDocument(fake.db, { projectId: "destination", documentId: "doc", userId: "actor" }))
    .toEqual({ ok: false, kind: "no_active_version" });
  expect(fake.calls.some(c => c.table === "documents" && c.op === "update")).toBe(false);
  fake.done();
});

it.each([
  ["a pasante's version keeps its author, not the copying actor", [{ training_author_user_id: "pasante-1", training_stage: "pasante" }], true],
  ["an unsealed version stays unsealed", [{ training_author_user_id: null, training_stage: null }], false],
])("copying a document: %s", async (_name, sourceSeal, sealed) => {
  mocks.projectAccess.mockResolvedValue({ ok: true, projectRole: "owner", project: { org_id: null } });
  mocks.docAccess.mockResolvedValue({ ok: true, projectRole: "owner", isCreator: true });
  mocks.downloadFile.mockResolvedValue(new ArrayBuffer(4));
  mocks.uploadFile.mockResolvedValue(undefined);
  const source = { ...firmDoc, project_id: null, org_id: null, workflow_id: "workflow" };
  const fake = scriptedDb([
    { table: "documents", data: source },
    { table: "documents", data: [source] },
    { table: "document_versions", data: { storage_path: "src/key.pdf", filename: "Source.pdf", file_type: "pdf", version_number: 1, size_bytes: 4 } },
    { table: "projects", data: { org_id: null } },
    { table: "documents", op: "insert", data: { id: "copy" } },
    { table: "document_versions", data: sourceSeal },
    // A sealed copy is only made where it can be approved: an organization.
    ...(sealed ? [{ table: "documents", data: { org_id: "org" } }] : []),
    { rpc: "create_document_version", data: { id: "copy-version" } },
    { table: "documents", data: { id: "copy" } },
  ]);
  expect(await assignOrCopyDocument(fake.db, { projectId: "destination", documentId: "doc", userId: "actor" }))
    .toMatchObject({ ok: true, status: 201 });
  const seal = fake.calls.find(c => c.table === "document_versions" && c.op === "select" && c.filters.length === 1 && c.filters[0][0] === "eq" && c.filters[0][1] === "id");
  expect(seal?.filters).toEqual([["eq", "id", "v1"]]);
  const version = (fake.calls.find(c => c.op === "rpc")?.args as { p_version: Record<string, unknown> }).p_version;
  expect(version).not.toHaveProperty("authorship");
  if (sealed) expect(version).toMatchObject({ training_author_user_id: "pasante-1", training_stage: "pasante" });
  else {
    expect(version).not.toHaveProperty("training_author_user_id");
    expect(version).not.toHaveProperty("training_stage");
  }
  fake.done();
});

describe("copying a document into a project asks the storage space", () => {
  const sourceRow = (extra: Record<string, unknown> = {}) => ({
    storage_path: "src/key.pdf", pdf_storage_path: null, filename: "Source.pdf",
    file_type: "pdf", version_number: 1, size_bytes: 100, content_sha256: "row-hash", ...extra,
  });
  const script = (tail: unknown[], row = sourceRow()): Parameters<typeof scriptedDb>[0] => [
    { table: "documents", data: { ...firmDoc, project_id: null, org_id: null, workflow_id: "workflow" } },
    { table: "documents", data: [{ ...firmDoc, project_id: null, org_id: null, workflow_id: "workflow" }] },
    { table: "document_versions", data: row },
    { table: "projects", data: { org_id: null } },
    { table: "documents", op: "insert", data: { id: "copy" } },
    ...(tail as Parameters<typeof scriptedDb>[0]),
  ];
  const run = (db: Parameters<typeof assignOrCopyDocument>[0]) =>
    assignOrCopyDocument(db, { projectId: "destination", documentId: "doc", userId: "actor" });
  const unsealed = [
    { table: "document_versions", data: [{ training_author_user_id: null, training_stage: null }] },
    { rpc: "create_document_version", data: { id: "copy-version" } },
    { table: "documents", data: { id: "copy" } },
  ];
  beforeEach(() => {
    mocks.projectAccess.mockResolvedValue({ ok: true, projectRole: "owner", project: { org_id: null } });
    mocks.docAccess.mockResolvedValue({ ok: true, projectRole: "owner", isCreator: true });
  });

  it("copies in the store, with the row's hash, when it fits", async () => {
    mocks.usage.mockResolvedValue({ usedBytes: 900, limitBytes: 1000 }); // exactly at the limit
    const fake = script(unsealed);
    const db = scriptedDb(fake);
    expect(await run(db.db)).toMatchObject({ ok: true, status: 201 });
    expect(mocks.copyFile).toHaveBeenCalledWith("src/key.pdf", expect.any(String));
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.readStream).not.toHaveBeenCalled();
    expect(mocks.space).toHaveBeenCalledWith(db.db, expect.objectContaining({
      purpose: "document_create", destination: { scope: "project", project_id: "destination" },
    }));
    const version = (db.calls.find((c) => c.op === "rpc")?.args as { p_version: Record<string, unknown> }).p_version;
    expect(version.content_sha256).toBe("row-hash");
    db.done();
  });

  it("streams the hash when the source row has none", async () => {
    const db = scriptedDb(script(unsealed, sourceRow({ content_sha256: null })));
    expect(await run(db.db)).toMatchObject({ ok: true });
    const version = (db.calls.find((c) => c.op === "rpc")?.args as { p_version: Record<string, unknown> }).p_version;
    expect(version.content_sha256).toBe(createHash("sha256").update("streamed").digest("hex"));
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    db.done();
  });

  it.each([
    ["does not fit", () => mocks.usage.mockResolvedValue({ usedBytes: 901, limitBytes: 1000 })],
    ["has a limit of zero", () => mocks.usage.mockResolvedValue({ usedBytes: 0, limitBytes: 0 })],
    ["cannot be read", () => mocks.usage.mockRejectedValue(new Error("unreadable"))],
    ["cannot be resolved", () => mocks.space.mockResolvedValue({ ok: false, detail: "unreadable" })],
  ])("refuses when the space %s, and leaves no object or row", async (_name, arrange) => {
    arrange();
    const db = scriptedDb(script([{ table: "documents", op: "delete" }]));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await run(db.db);
    log.mockRestore();
    expect(result).toMatchObject({ ok: false, kind: _name === "does not fit" || _name === "has a limit of zero" ? "storage_quota_exceeded" : "copy_failed" });
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.op === "rpc")).toBe(false);
    db.done();
  });
});
