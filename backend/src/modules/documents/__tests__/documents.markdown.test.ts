import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  stored: vi.fn(),
  log: vi.fn(),
}));
vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../documents.lifecycle", () => ({ createDocumentVersion: mocks.create }));
vi.mock("../documents.textSearch", () => ({ readStoredDocumentText: mocks.stored }));
vi.mock("../../../lib/storage", () => ({
  uploadFile: mocks.upload,
  deleteFile: mocks.remove,
  versionStorageKey: (user: string, doc: string, slug: string, name: string) => `v/${user}/${doc}/${slug}/${name}`,
}));
vi.mock("../../../lib/log", () => ({ logError: mocks.log }));

import {
  COMPARE_MAX_TEXT_CHARS,
  compareVersionTexts,
  saveMarkdownEdit,
} from "../documents.markdown";

const DOC = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";

function allow(projectRole = "editor", current: string | null = V1) {
  mocks.access.mockResolvedValue({
    ok: true,
    doc: { id: DOC, current_version_id: current },
    isCreator: true,
    projectRole,
  });
}
const mdVersion = { id: V1, filename: "notes.md", file_type: "md" };
const save = (db: unknown, over: Record<string, unknown> = {}) =>
  saveMarkdownEdit(db as never, {
    documentId: DOC,
    userId: "u1",
    userEmail: "u@x.test",
    text: "# Hola ñ 😀\n",
    baseVersionId: V1,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

describe("saveMarkdownEdit", () => {
  it("stores the exact bytes and creates a new user_edit version, never overwriting", async () => {
    allow();
    mocks.create.mockResolvedValue({
      data: { id: "new", version_number: 2, source: "user_edit", created_at: "t", filename: "notes.md" },
      error: null,
    });
    const fake = scriptedDb([{ table: "document_versions", data: mdVersion }]);
    const result = await save(fake.db);
    expect(result).toEqual({
      ok: true,
      data: { id: "new", version_number: 2, source: "user_edit", created_at: "t", filename: "notes.md", file_type: "md", size_bytes: 15 },
    });
    const [key, bytes, type] = mocks.upload.mock.calls[0];
    expect(key).toMatch(/^v\/u1\/.*\/notes\.md$/);
    expect(Buffer.from(bytes).toString("utf8")).toBe("# Hola ñ 😀\n");
    expect(type).toBe("text/markdown; charset=utf-8");
    expect(mocks.create).toHaveBeenCalledWith(
      fake.db,
      expect.objectContaining({
        authorship: { kind: "author", userId: "u1" },
        document_id: DOC,
        storage_path: key,
        pdf_storage_path: null,
        source: "user_edit",
        file_type: "md",
        size_bytes: 15,
        base_version_id: V1,
        content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(fake.calls[0].filters).toEqual(expect.arrayContaining([["eq", "id", V1], ["eq", "document_id", DOC]]));
    fake.done();
  });

  it("falls back to a default name and the version's own filename", async () => {
    allow();
    mocks.create.mockResolvedValue({ data: { id: "n", version_number: 3, source: "user_edit", created_at: "t", filename: null }, error: null });
    const fake = scriptedDb([{ table: "document_versions", data: { ...mdVersion, filename: null } }]);
    const result = await save(fake.db);
    expect(result.ok && result.data.filename).toBe("Untitled document.md");
    fake.done();
  });

  it.each([
    ["a missing text", { text: undefined }],
    ["a missing base", { baseVersionId: undefined }],
    ["a base that is not an id", { baseVersionId: "nope" }],
  ])("rejects %s before touching anything", async (_label, over) => {
    const fake = scriptedDb([]);
    const result = await save(fake.db, over);
    expect(result).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["not found", { ok: false, kind: "not_found" }, "not_found"],
    ["forbidden", { ok: false, kind: "forbidden" }, "not_found"],
  ])("answers a document the caller cannot open as not found (%s)", async (_label, verdict, kind) => {
    mocks.access.mockResolvedValue(verdict);
    const result = await save(scriptedDb([]).db);
    expect(result).toMatchObject({ ok: false, kind });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("reports a failed access lookup as an internal failure", async () => {
    mocks.access.mockResolvedValue({ ok: false, kind: "error", error: new Error("db") });
    expect(await save(scriptedDb([]).db)).toMatchObject({ ok: false, kind: "error" });
  });

  it("refuses a viewer, who cannot upload versions either", async () => {
    allow("viewer");
    const result = await save(scriptedDb([]).db);
    expect(result).toMatchObject({ ok: false, kind: "forbidden" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("is not found when the document has no current version or it was deleted", async () => {
    allow("editor", null);
    expect(await save(scriptedDb([]).db)).toMatchObject({ ok: false, kind: "not_found" });
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: null }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("reports a failed version lookup as an internal failure", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", error: { message: "down" } }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "error" });
  });

  it("only edits Markdown documents", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: { ...mdVersion, file_type: "docx" } }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("answers 409 document_version_conflict when the base is not the current version, writing nothing", async () => {
    allow("editor", V2);
    const fake = scriptedDb([{ table: "document_versions", data: { ...mdVersion, id: V2 } }]);
    expect(await save(fake.db)).toEqual({
      ok: false,
      kind: "conflict",
      code: "document_version_conflict",
      detail: expect.any(String),
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers the same 409 when the database finds the base stale under its lock, and removes the file", async () => {
    allow();
    mocks.create.mockResolvedValue({ data: null, error: { code: "P0001", message: "document_version_conflict" } });
    const fake = scriptedDb([{ table: "document_versions", data: mdVersion }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "conflict", code: "document_version_conflict" });
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls[0][0]);
  });

  it("recognizes the conflict by its message alone", async () => {
    allow();
    mocks.create.mockResolvedValue({ data: null, error: { message: "boom: document_version_conflict" } });
    expect(await save(scriptedDb([{ table: "document_versions", data: mdVersion }]).db)).toMatchObject({ kind: "conflict" });
  });

  it("reports any other insert failure as internal, still removing the file, even if removal fails", async () => {
    allow();
    mocks.create.mockResolvedValue({ data: null, error: { code: "XX000", message: "down" } });
    mocks.remove.mockRejectedValue(new Error("gone"));
    const fake = scriptedDb([{ table: "document_versions", data: mdVersion }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.log).toHaveBeenCalled();
    mocks.create.mockResolvedValue({ data: null, error: null });
    mocks.remove.mockResolvedValue(undefined);
    expect(await save(scriptedDb([{ table: "document_versions", data: mdVersion }]).db)).toMatchObject({ ok: false, kind: "error" });
  });

  it("reports a storage failure as internal and creates no version", async () => {
    allow();
    mocks.upload.mockRejectedValue(new Error("s3"));
    const fake = scriptedDb([{ table: "document_versions", data: mdVersion }]);
    expect(await save(fake.db)).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses text over the size cap and text that is not valid UTF-8", async () => {
    allow();
    const big = await save(scriptedDb([{ table: "document_versions", data: mdVersion }]).db, {
      text: "a".repeat(100 * 1024 * 1024 + 1),
    });
    expect(big).toMatchObject({ ok: false, kind: "validation", code: "upload_file_too_large" });
    const lone = await save(scriptedDb([{ table: "document_versions", data: mdVersion }]).db, { text: "ok \ud800 x" });
    expect(lone).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

const row = (id: string, extra: object = {}) => ({
  id,
  version_number: 1,
  filename: "notes.md",
  source: "upload",
  created_at: "2026-11-11T00:00:00Z",
  storage_path: `p/${id}`,
  textless_page_count: null,
  ...extra,
});
const ready = (text: string, extra: object = {}) => ({
  revision: "r",
  status: "ready",
  text,
  textless_page_count: null,
  ...extra,
});
const compare = (db: unknown, over: Record<string, unknown> = {}) =>
  compareVersionTexts(db as never, {
    documentId: DOC,
    userId: "u1",
    userEmail: "u@x.test",
    baseVersionId: V1,
    headVersionId: V2,
    ...over,
  });

describe("compareVersionTexts", () => {
  it("returns the stored text of both versions, with their source", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1), row(V2, { version_number: 2, source: "assistant_edit" })] }]);
    mocks.stored.mockImplementation(async (_db, args) => (args.versionId === V1 ? ready("antes") : ready("después", { textless_page_count: 2 })));
    const result = await compare(fake.db);
    expect(result).toEqual({
      ok: true,
      data: {
        base: { id: V1, version_number: 1, filename: "notes.md", source: "upload", created_at: "2026-11-11T00:00:00Z", text_status: "ready", text: "antes", too_large: false, textless_page_count: null },
        head: { id: V2, version_number: 2, filename: "notes.md", source: "assistant_edit", created_at: "2026-11-11T00:00:00Z", text_status: "ready", text: "después", too_large: false, textless_page_count: 2 },
      },
    });
    expect(mocks.stored).toHaveBeenCalledWith(fake.db, { userId: "u1", userEmail: "u@x.test", documentId: DOC, versionId: V1 });
    expect(fake.calls[0].filters).toEqual(expect.arrayContaining([["eq", "document_id", DOC], ["is", "deleted_at", null]]));
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("antes");
    fake.done();
  });

  it("gives the status and no text for a version still pending, processing, failed or without text", async () => {
    allow();
    for (const [stored, status] of [
      [{ revision: "r", status: "pending", text: null, textless_page_count: null }, "pending"],
      [{ revision: "r", status: "processing", text: null, textless_page_count: null }, "pending"],
      [{ revision: "r", status: "failed", text: null, textless_page_count: null }, "failed"],
      [{ revision: "r", status: "ready", text: null, textless_page_count: null }, "pending"],
      [{ revision: null, status: "pending", text: null, textless_page_count: null }, "none"],
    ] as const) {
      const fake = scriptedDb([{ table: "document_versions", data: [row(V1, { textless_page_count: 3 }), row(V2)] }]);
      mocks.stored.mockImplementation(async (_db, args) => (args.versionId === V1 ? ready("antes") : stored));
      const result = await compare(fake.db);
      expect(result.ok && result.data.head).toMatchObject({ text_status: status, text: null, too_large: false });
      expect(result.ok && result.data.base.text).toBe("antes");
    }
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1, { textless_page_count: 3 }), row(V2)] }]);
    mocks.stored.mockResolvedValue({ revision: "r", status: "failed", text: null, textless_page_count: null });
    const result = await compare(fake.db);
    expect(result.ok && result.data.base.textless_page_count).toBe(3);
  });

  it("withholds a text over the cap and says so", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1), row(V2)] }]);
    mocks.stored.mockImplementation(async (_db, args) => ready(args.versionId === V1 ? "x".repeat(COMPARE_MAX_TEXT_CHARS + 1) : "small"));
    const result = await compare(fake.db);
    expect(result.ok && result.data.base).toMatchObject({ text_status: "ready", text: null, too_large: true });
    expect(result.ok && result.data.head).toMatchObject({ text: "small", too_large: false });
  });

  it("compares a version with itself with one lookup", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1)] }]);
    mocks.stored.mockResolvedValue(ready("same"));
    const result = await compare(fake.db, { headVersionId: V1 });
    expect(result.ok && result.data.base.text).toBe("same");
    fake.done();
  });

  it.each([
    ["missing", { baseVersionId: undefined }],
    ["not ids", { headVersionId: "x" }],
  ])("rejects base/head that are %s", async (_label, over) => {
    expect(await compare(scriptedDb([]).db, over)).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("is not found without access to the document, whatever the reason", async () => {
    for (const kind of ["not_found", "forbidden"]) {
      mocks.access.mockResolvedValue({ ok: false, kind });
      expect(await compare(scriptedDb([]).db)).toMatchObject({ ok: false, kind: "not_found" });
    }
    mocks.access.mockResolvedValue({ ok: false, kind: "error", error: new Error("db") });
    expect(await compare(scriptedDb([]).db)).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.stored).not.toHaveBeenCalled();
  });

  it("is not found when a version is not a live version of this document or has no file", async () => {
    allow();
    const missing = scriptedDb([{ table: "document_versions", data: [row(V1)] }]);
    expect(await compare(missing.db)).toMatchObject({ ok: false, kind: "not_found" });
    const noFile = scriptedDb([{ table: "document_versions", data: [row(V1), row(V2, { storage_path: null })] }]);
    expect(await compare(noFile.db)).toMatchObject({ ok: false, kind: "not_found" });
    const none = scriptedDb([{ table: "document_versions", data: null }]);
    expect(await compare(none.db)).toMatchObject({ ok: false, kind: "not_found" });
    expect(mocks.stored).not.toHaveBeenCalled();
  });

  it("is not found when the text read itself refuses the caller", async () => {
    allow();
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1), row(V2)] }]);
    mocks.stored.mockResolvedValue(null);
    expect(await compare(fake.db)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("reports a failed lookup or text read as internal", async () => {
    allow();
    expect(await compare(scriptedDb([{ table: "document_versions", error: { message: "down" } }]).db)).toMatchObject({ ok: false, kind: "error" });
    const fake = scriptedDb([{ table: "document_versions", data: [row(V1), row(V2)] }]);
    mocks.stored.mockRejectedValue(new Error("rpc"));
    expect(await compare(fake.db)).toMatchObject({ ok: false, kind: "error" });
  });
});
