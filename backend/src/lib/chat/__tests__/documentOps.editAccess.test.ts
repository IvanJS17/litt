import { beforeEach, describe, expect, it, vi } from "vitest";

// edit_document runs inside a turn whose `allowDocumentMutation` flag is
// decided from the CHAT's container, while its attachments can come from
// anywhere the caller can READ (standalone chat, or a project chat that
// attached a document from another project). These pin the second, per
// document check: the write itself is authorized against the document.
// `can` stays real so the role policy under test is the production one.

const mocks = vi.hoisted(() => ({
  ensureDocAccess: vi.fn(),
  loadActiveVersion: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  applyTrackedEdits: vi.fn(),
}));

vi.mock("../../access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../access")>()),
  ensureDocAccess: mocks.ensureDocAccess,
}));

vi.mock("../../documentVersions", () => ({
  contentSha256: vi.fn(() => "sha"),
  loadActiveVersion: mocks.loadActiveVersion,
}));

vi.mock("../../storage", () => ({
  downloadFile: mocks.downloadFile,
  uploadFile: mocks.uploadFile,
  extractedTextKey: vi.fn((id: string) => `extracted/${id}`),
  generatedDocKey: vi.fn(() => "generated/key.docx"),
}));

vi.mock("../../docxTrackedChanges", () => ({
  applyTrackedEdits: mocks.applyTrackedEdits,
  extractDocxBodyText: vi.fn(() => ""),
}));

vi.mock("../../convert", () => ({
  convertedPdfKey: vi.fn(() => "converted/key.pdf"),
  docxToPdf: vi.fn(),
}));

vi.mock("../../queue/conversionQueue", () => ({ enqueueConversion: vi.fn() }));
vi.mock("../../dbq/enqueue", () => ({
  enqueueDbJob: vi.fn(),
  enqueueStorageCleanup: vi.fn(),
}));
vi.mock("../../supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../userLookup", () => ({
  profileAttributionName: vi.fn(() => "Author"),
}));
vi.mock("../../downloadTokens", () => ({
  buildDownloadUrl: vi.fn(() => "https://example.test/download"),
}));
vi.mock("../../documentTypes", () => ({
  contentTypeForDocumentType: vi.fn(() => "application/octet-stream"),
  isPresentationDocumentType: vi.fn(() => false),
  isSpreadsheetDocumentType: vi.fn(() => false),
  isWordDocumentType: vi.fn(() => true),
  requiresLibreOfficeTextExtraction: vi.fn(() => false),
  shouldConvertToPdf: vi.fn(() => false),
}));
vi.mock("../../officeText", () => ({
  extractPresentationText: vi.fn(async () => ""),
}));
vi.mock("../../spreadsheet", () => ({
  spreadsheetToLLMText: vi.fn(async () => ""),
}));
vi.mock("../types", () => ({
  STANDARD_FONT_DATA_URL: "",
  devLog: vi.fn(),
}));

import { runEditDocument } from "../tools/documentOps";

const docRow = {
  id: "doc-1",
  user_id: "owner-id",
  project_id: "project-1",
  org_id: null,
  workflow_id: null,
};

function scriptedDb(row: Record<string, unknown> | null) {
  const selects: string[] = [];
  const db = {
    from(table: string) {
      const query: Record<string, unknown> = {};
      query.select = vi.fn((columns: string) => {
        if (table === "documents") selects.push(columns);
        return query;
      });
      query.eq = vi.fn(() => query);
      query.single = vi.fn(async () => ({
        data: row,
        error: row ? null : { message: "no rows" },
      }));
      return query;
    },
  };
  return { db: db as never, selects };
}

function run(db: never, userEmail?: string | null) {
  return runEditDocument({
    documentId: "doc-1",
    userId: "actor-id",
    ...(userEmail === undefined ? {} : { userEmail }),
    edits: [{ find: "old", replace: "new" }],
    db,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadActiveVersion.mockResolvedValue({
    id: "version-1",
    filename: "Agreement.docx",
    storage_path: "documents/owner-id/doc-1/Agreement.docx",
  });
  mocks.downloadFile.mockResolvedValue(Buffer.from("bytes"));
});

describe("assistant document-edit authorization", () => {
  it("refuses a caller who can only read the document, before touching bytes", async () => {
    mocks.ensureDocAccess.mockResolvedValue({
      ok: true,
      isCreator: false,
      orgRole: null,
      projectRole: "viewer",
    });
    const fake = scriptedDb(docRow);

    const result = await run(fake.db, "viewer@example.test");

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/permission to edit/);
    expect(mocks.ensureDocAccess).toHaveBeenCalledWith(
      docRow,
      "actor-id",
      "viewer@example.test",
      fake.db,
    );
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.applyTrackedEdits).not.toHaveBeenCalled();
    // The doc row must carry its scope, or the verdict would be about
    // nothing: creator, project, organization and workflow all matter.
    expect(fake.selects[0]).toBe("id, user_id, project_id, org_id, workflow_id");
  });

  it("treats a document the caller cannot reach as missing", async () => {
    mocks.ensureDocAccess.mockResolvedValue({ ok: false });
    const fake = scriptedDb(docRow);

    expect(await run(fake.db, "outsider@example.test")).toEqual({
      ok: false,
      error: "Document not found.",
    });
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("passes an editor through to the byte work", async () => {
    mocks.ensureDocAccess.mockResolvedValue({
      ok: true,
      isCreator: false,
      orgRole: null,
      projectRole: "editor",
    });
    const fake = scriptedDb(docRow);
    // No bytes: the flow stops after authorization, which is all this
    // asserts. The permission gate must not be what refused it.
    mocks.downloadFile.mockResolvedValue(null);

    const result = await run(fake.db, "editor@example.test");

    expect(result).toEqual({
      ok: false,
      error: "Could not load document bytes.",
    });
  });

  it("fails closed when the surface supplies no email", async () => {
    mocks.ensureDocAccess.mockResolvedValue({
      ok: true,
      isCreator: false,
      orgRole: null,
      projectRole: "viewer",
    });
    const fake = scriptedDb(docRow);

    const result = await run(fake.db);

    expect(mocks.ensureDocAccess).toHaveBeenCalledWith(
      docRow,
      "actor-id",
      undefined,
      fake.db,
    );
    expect(result).toMatchObject({ ok: false });
  });
});
