import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import {
  createDocumentVersion,
  createDocumentVersions,
  activateDocumentVersion,
  updateDocumentVersion,
} from "../documents.lifecycle";

describe("document version persistence boundary", () => {
  it("passes stable identity and metadata to the atomic create operation", async () => {
    const row = { id: "v", version_number: 3 };
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    const db = { rpc } as unknown as Db;
    expect(
      await createDocumentVersion(db, {
        authorship: { kind: "catalog" },
        document_id: "doc",
        id: "v",
        storage_path: "new/key",
        source: "user_upload",
        filename: "Clause.docx",
      }),
    ).toEqual({ data: row, error: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_document_version", {
      p_document_id: "doc",
      p_version: {
        id: "v",
        storage_path: "new/key",
        source: "user_upload",
        filename: "Clause.docx",
      },
      p_activate: true,
    });
    // Number allocation belongs to the transaction, not a preceding SELECT.
    expect(rpc.mock.calls[0][1].p_version).not.toHaveProperty("version_number");
  });

  it("can defer activation until dependent edit rows have been recorded", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "v" }, error: null });
    await createDocumentVersion(
      { rpc } as unknown as Db,
      {
        authorship: { kind: "catalog" },
        document_id: "doc",
        storage_path: "key",
        source: "assistant_edit",
        filename: "Draft.docx",
      },
      { activate: false },
    );
    expect(rpc.mock.calls[0][1].p_activate).toBe(false);
  });

  it("does not hide a transactional insertion failure", async () => {
    const error = { code: "23505", message: "identity conflict" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const versions = [
      {
        authorship: { kind: "catalog" } as const,
        document_id: "doc",
        storage_path: "key",
        source: "upload",
        filename: "Draft.pdf",
      },
    ];
    expect(
      await createDocumentVersions({ rpc } as unknown as Db, versions),
    ).toEqual({ data: null, error });
    const { authorship: _authorship, ...row } = versions[0];
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_document_versions", {
      p_versions: [row],
    });
  });

  it.each([false, null])(
    "rejects a stale activation result: %s",
    async (data) => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      expect(
        await activateDocumentVersion({ rpc } as unknown as Db, "doc", "v"),
      ).toEqual({ activated: false, error: null });
      expect(rpc).toHaveBeenCalledWith("activate_document_version", {
        p_document_id: "doc",
        p_version_id: "v",
      });
    },
  );

  it("replacement repeats the document boundary and excludes tombstones", async () => {
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", op: "update", data: { id: "v" } },
    ]);
    await updateDocumentVersion(fake.db, "doc", "v", {
      storage_path: "new/key",
      pdf_storage_path: null,
    }, { actorUserId: "lawyer" });
    expect(fake.calls[1].filters).toEqual([
      ["eq", "id", "v"],
      ["eq", "document_id", "doc"],
      ["is", "deleted_at", null],
      ["is", "training_stage", null],
    ]);
    fake.done();
  });

  it.each([null, "original-hash"])("atomically guards editor saves against intervening writes (%s)", async (hash) => {
    const fake = scriptedDb([{ table: "documents", data: null }, { table: "document_versions", op: "update", data: null }, { table: "document_versions", data: { training_stage: null } }]);
    const result = await updateDocumentVersion(fake.db, "doc", "v", { storage_path: "new/key" }, {
      actorUserId: "lawyer", expectedStoragePath: "old/key", expectedContentSha256: hash,
    });
    expect(result.data).toBeNull();
    expect(fake.calls[1].filters).toContainEqual(["eq", "storage_path", "old/key"]);
    expect(fake.calls[1].filters).toContainEqual([hash === null ? "is" : "eq", "content_sha256", hash]);
    fake.done();
  });
});

describe("a copy's seal fails closed", () => {
  const copy = (sourceVersionId = "source") => ({
    authorship: { kind: "copy", sourceVersionId } as const,
    document_id: "copy-doc",
    storage_path: "copy/key",
    source: "upload",
    filename: "Copia.docx",
  });

  it("refuses a copy whose source version is gone instead of leaving it unsealed", async () => {
    const fake = scriptedDb([{ table: "document_versions", data: [] }]);
    const result = await createDocumentVersion(fake.db, copy());
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ kind: "training.copy_source_missing" });
    fake.done();
  });

  it("refuses a pasante's copy into a document outside an organization", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: [{ training_author_user_id: "pupil", training_stage: "pasante" }] },
      { table: "documents", data: { org_id: null } },
    ]);
    const result = await createDocumentVersion(fake.db, copy());
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ kind: "training.copy_without_org" });
    expect(fake.calls[1].filters).toEqual([["eq", "id", "copy-doc"]]);
    fake.done();
  });

  it("seals a pasante's copy inside an organization", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: [{ training_author_user_id: "pupil", training_stage: "pasante" }] },
      { table: "documents", data: { org_id: "org" } },
      { rpc: "create_document_version", data: { id: "v" } },
    ]);
    await createDocumentVersion(fake.db, copy());
    expect((fake.calls[2].args as { p_version: object }).p_version).toMatchObject({
      training_author_user_id: "pupil",
      training_stage: "pasante",
    });
    fake.done();
  });
});

const storage = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  assertStorageConfigured: vi.fn(),
}));
vi.mock("../../../lib/storage", () => ({
  ...storage,
  extractedTextKey: (id: string) => `extracted-text/${id}.txt`,
}));
import { afterEach } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("cleans replaced bytes and cache inline with workers disabled while retaining shared bytes", async () => {
  vi.stubEnv("DB_JOBS_ENABLED", "false");
  const fake = scriptedDb([
    { table: "documents", data: null },
    {
      table: "document_versions",
      data: {
        storage_path: "old",
        pdf_storage_path: "shared",
        content_sha256: "old-hash",
      },
    },
    { table: "document_versions", op: "update", data: { id: "v" } },
    { rpc: "document_cache_writer_active", data: false },
    { rpc: "document_cleanup_referenced_keys", data: [{ key: "shared" }] },
    { table: "db_jobs", data: [] },
  ]);
  await updateDocumentVersion(fake.db, "doc", "v", {
    storage_path: "new",
    pdf_storage_path: null,
    content_sha256: "new-hash",
  }, { actorUserId: "lawyer" });
  expect(storage.deleteFile.mock.calls.flat()).toEqual([
    "old",
    "extracted-text/v.txt",
  ]);
  expect(fake.calls[2].filters).toEqual([
    ["eq", "id", "v"],
    ["eq", "document_id", "doc"],
    ["is", "deleted_at", null],
    ["is", "training_stage", null],
  ]);
  fake.done();
});
it.each([{ data: null }, { error: { message: "write failed" } }])(
  "does not clean bytes if the scoped replacement does not commit: %j",
  async (result) => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", data: { storage_path: "old" } },
      { table: "document_versions", op: "update", ...result },
      ...("error" in result ? [] : [{ table: "document_versions", data: { training_stage: null } }]),
    ]);
    await updateDocumentVersion(fake.db, "doc", "v", { storage_path: "new" }, { actorUserId: "lawyer" });
    expect(storage.deleteFile).not.toHaveBeenCalled();
    fake.done();
  },
);
describe("a sealed version's stored content", () => {
  const content = { storage_path: "new", content_sha256: "new-hash", pdf_storage_path: null };
  it("is refused by the update itself and answered as sealed", async () => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", data: { storage_path: "old", pdf_storage_path: null, content_sha256: "old-hash" } },
      { table: "document_versions", op: "update", data: null },
      { table: "document_versions", data: { training_stage: "pasante" } },
    ]);
    expect(await updateDocumentVersion(fake.db, "doc", "v", content, { actorUserId: "lawyer" })).toEqual({ data: null, error: null, sealed: true });
    expect(fake.calls[2].filters).toContainEqual(["is", "training_stage", null]);
    expect(storage.deleteFile).not.toHaveBeenCalled();
    fake.done();
  });
  it.each([{ storage_path: "new" }, { content_sha256: "new-hash" }])("is refused for a patch of %j alone", async (patch) => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", data: { storage_path: "old" } },
      { table: "document_versions", op: "update", data: null },
      { table: "document_versions", data: { training_stage: "pasante" } },
    ]);
    expect(await updateDocumentVersion(fake.db, "doc", "v", patch, { actorUserId: "lawyer" })).toMatchObject({ sealed: true });
    fake.done();
  });
  const expectations = [
    ["path", { expectedStoragePath: "old" }, { training_stage: "pasante", storage_path: "moved", content_sha256: "old-hash" }, { training_stage: "pasante", storage_path: "old", content_sha256: "old-hash" }],
    ["hash", { expectedContentSha256: "old-hash" }, { training_stage: "pasante", storage_path: "old", content_sha256: "other-hash" }, { training_stage: "pasante", storage_path: "old", content_sha256: "old-hash" }],
    ["empty hash", { expectedContentSha256: null }, { training_stage: "pasante", storage_path: "old", content_sha256: "other-hash" }, { training_stage: "pasante", storage_path: "old", content_sha256: null }],
  ] as const;
  const noRow = (read: object) => scriptedDb([
    { table: "documents", data: null },
    { table: "document_versions", data: { storage_path: "old" } },
    { table: "document_versions", op: "update", data: null },
    { table: "document_versions", data: read },
  ]);
  it.each(expectations)("is a plain miss, not sealed, when the version no longer matches the expected %s", async (_name, opts, moved) => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = noRow(moved);
    expect(await updateDocumentVersion(fake.db, "doc", "v", content, { actorUserId: "lawyer", ...opts })).toEqual({ data: null, error: null });
    fake.done();
  });
  it.each(expectations)("is answered sealed while the expected %s still holds", async (_name, opts, _moved, same) => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = noRow(same);
    expect(await updateDocumentVersion(fake.db, "doc", "v", content, { actorUserId: "lawyer", ...opts })).toEqual({ data: null, error: null, sealed: true });
    fake.done();
  });
  it("returns the error when the read that tells sealed from lost fails", async () => {
    vi.stubEnv("DB_JOBS_ENABLED", "false");
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", data: { storage_path: "old" } },
      { table: "document_versions", op: "update", data: null },
      { table: "document_versions", error: { message: "read failed" } },
    ]);
    expect(await updateDocumentVersion(fake.db, "doc", "v", content, { actorUserId: "lawyer", expectedStoragePath: "old" }))
      .toEqual({ data: null, error: { message: "read failed" } });
    fake.done();
  });
  it("accepts a metadata-only patch without the unsealed condition", async () => {
    const fake = scriptedDb([
      { table: "documents", data: null },
      { table: "document_versions", op: "update", data: { id: "v" } },
    ]);
    const result = await updateDocumentVersion(fake.db, "doc", "v", { filename: "renamed.docx" }, { actorUserId: "lawyer" });
    expect(result.data).toEqual({ id: "v" });
    expect(JSON.stringify(fake.calls[1].filters)).not.toContain("training_stage");
    fake.done();
  });
});
it("preserves cached text when only the filename changes", async () => {
  vi.stubEnv("DB_JOBS_ENABLED", "false");
  const fake = scriptedDb([
    { table: "documents", data: null },
    { table: "document_versions", op: "update", data: { id: "v" } },
  ]);
  await updateDocumentVersion(fake.db, "doc", "v", {
    filename: "renamed.docx",
  }, { actorUserId: "lawyer" });
  expect(storage.deleteFile).not.toHaveBeenCalled();
  fake.done();
});
