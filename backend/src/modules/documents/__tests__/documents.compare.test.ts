import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { contentSha256 } from "../../../lib/documentVersions";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  create: vi.fn(),
  files: new Map<string, ArrayBuffer>(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  log: vi.fn(),
  extraction: { fail: null as unknown },
}));

vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../documents.lifecycle", () => ({ createDocumentVersion: mocks.create }));
vi.mock("../../../lib/log", () => ({ logError: mocks.log }));
vi.mock("../../../lib/storage", () => ({
  downloadFile: async (key: string) => mocks.files.get(key) ?? null,
  uploadFile: mocks.uploadFile,
  deleteFile: mocks.deleteFile,
  versionStorageKey: (user: string, doc: string, slug: string, name: string) => `v/${user}/${doc}/${slug}/${name}`,
}));
// The parser process is tested in lib/__tests__/docxCompare.test.ts; here the op runs in-process.
vi.mock("../../../lib/extraction/isolated", async (original) => {
  const real = await original<typeof import("../../../lib/extraction/isolated")>();
  return {
    ...real,
    runIsolatedExtraction: async (op: keyof typeof EXTRACTION_OPS, load: () => Promise<ArrayBuffer | null>, options: { fileType?: string } = {}) => {
      if (mocks.extraction.fail) throw mocks.extraction.fail;
      return (EXTRACTION_OPS[op] as (b: ArrayBuffer, t: string) => unknown)((await load())!, options.fileType ?? "");
    },
  };
});

import { ConversionError } from "../../../lib/convert";
import { EXTRACTION_OPS } from "../../../lib/extraction/ops";
import { ExtractionBusyError, ExtractionLimitError } from "../../../lib/extraction/isolated";
import { COMPARE_MAX_SOURCE_BYTES, comparedFilename, compareDocuments } from "../documents.compare";

const USER = "user-1";
const BASE = "doc-base";
const OTHER = "doc-other";
const FIXTURES = path.join(__dirname, "../../../lib/__tests__/fixtures/compare");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));
const asArrayBuffer = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const ORIGINAL = fixture("par2_servicios_original.docx");
const NEGOTIATED = fixture("par2_servicios_negociado.docx");

type Seed = {
  baseType?: string;
  otherType?: string;
  baseBytes?: Buffer;
  otherBytes?: Buffer;
  baseDoc?: Record<string, unknown>;
  otherDoc?: Record<string, unknown>;
  baseExtra?: Record<string, unknown>;
  otherExtra?: Record<string, unknown>;
  projectRole?: string;
  locale?: string;
  taken?: string[];
};

function seed(s: Seed = {}) {
  const baseBytes = s.baseBytes ?? ORIGINAL;
  const otherBytes = s.otherBytes ?? NEGOTIATED;
  mocks.files.set("src/vb", asArrayBuffer(baseBytes));
  mocks.files.set("src/vo", asArrayBuffer(otherBytes));
  const row = (id: string, version: string, extra: Record<string, unknown>) => ({
    id, user_id: USER, project_id: "proj", org_id: "org", folder_id: "folder", library_kind: "file",
    current_version_id: version, archived_at: null, ...extra,
  });
  const ver = (id: string, doc: string, bytes: Buffer, type: string, filename: string, extra: Record<string, unknown>) => ({
    id, document_id: doc, storage_path: `src/${id}`, pdf_storage_path: null, version_number: 1, filename, source: "upload",
    file_type: type, size_bytes: bytes.byteLength, page_count: null, textless_page_count: null,
    content_sha256: contentSha256(bytes), training_stage: null, deleted_at: null, ...extra,
  });
  const docs = [row(BASE, "vb", s.baseDoc ?? {}), row(OTHER, "vo", s.otherDoc ?? {})];
  const fake = tableDb({
    documents: [
      ...docs,
      ...(s.taken ?? []).map((name, i) => row(`t${i}`, `vt${i}`, {})),
    ],
    document_versions: [
      ver("vb", BASE, baseBytes, s.baseType ?? "docx", "Contrato.docx", s.baseExtra ?? {}),
      ver("vo", OTHER, otherBytes, s.otherType ?? "docx", "Contrato negociado.docx", s.otherExtra ?? {}),
      ...(s.taken ?? []).map((name, i) => ({ id: `vt${i}`, document_id: `t${i}`, filename: name, deleted_at: null })),
    ],
    user_profiles: s.locale ? [{ user_id: USER, ui_locale: s.locale }] : [],
    training_version_approvals: [],
  });
  mocks.access.mockImplementation(async (id: string) => {
    const doc = docs.find((d) => d.id === id);
    return doc ? { ok: true, doc, isCreator: true, projectRole: s.projectRole ?? "editor" } : { ok: false, kind: "not_found" };
  });
  return fake;
}

const run = (db: never, against: unknown = OTHER) =>
  compareDocuments(db, { documentId: BASE, againstDocumentId: against, userId: USER, userEmail: "u@x.test" });
const stored = (key: string) => Buffer.from(mocks.files.get(key)!);
const hash = (id: string) => contentSha256(Buffer.from(mocks.files.get(id)!));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.extraction.fail = null;
  mocks.uploadFile.mockImplementation(async (key: string, bytes: ArrayBuffer) => void mocks.files.set(key, bytes));
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (_db: unknown, v: Record<string, unknown>) => ({ data: { id: "new-version", ...v }, error: null }));
});

describe("comparing two Word documents", () => {
  it("creates a new compared document with the expected tracked changes and leaves both sources alone", async () => {
    const fake = seed({ locale: "en-US" });
    const before = [hash("src/vb"), hash("src/vo")];
    const result = await run(fake.db as never);
    expect(result).toMatchObject({
      ok: true,
      data: { filename: "Contrato vs Contrato negociado (changes).docx", file_type: "docx", project_id: "proj", folder_id: "folder" },
    });
    if (!result.ok) return;
    expect(result.data.document_id).not.toBe(BASE);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "compared", version_number: 1, file_type: "docx", document_id: result.data.document_id }),
    );
    const key = mocks.uploadFile.mock.calls[0][0] as string;
    const xml = await (await JSZip.loadAsync(stored(key))).file("word/document.xml")!.async("string");
    expect(xml.match(/<w:ins[\s>]/g)).toHaveLength(11);
    expect(xml.match(/<w:del[\s>]/g)).toHaveLength(4);
    expect(xml).toContain('w:author="LiTT"');
    // Sources untouched: same bytes, no new version, same current version.
    expect([hash("src/vb"), hash("src/vo")]).toEqual(before);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(fake.tables.documents.find((d) => d.id === BASE)!.current_version_id).toBe("vb");
    expect(fake.tables.documents.find((d) => d.id === result.data.document_id)).toMatchObject({ project_id: "proj", folder_id: "folder", library_kind: "file" });
  });

  it("names it in the person's language and does not collide with an existing name", async () => {
    const fake = seed({ locale: "es-MX", taken: ["Contrato vs Contrato negociado (cambios).docx"] });
    expect(await run(fake.db as never)).toMatchObject({ ok: true, data: { filename: "Contrato vs Contrato negociado (cambios) (2).docx" } });
  });

  it("builds names that stay under the limit", () => {
    const long = "x".repeat(300);
    const name = comparedFilename(`${long}.docx`, "otro.docx", "en-US", new Set());
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(" (changes).docx")).toBe(true);
    expect(comparedFilename(null, "", "es-MX", new Set())).toBe("Untitled document vs Untitled document (cambios).docx");
  });
});

describe("who may compare", () => {
  it("answers 404 for either document the caller cannot open, and 500 when access fails", async () => {
    const fake = seed();
    mocks.access.mockImplementation(async (id: string) => (id === OTHER ? { ok: false, kind: "forbidden" } : mocks.access.getMockImplementation() && { ok: false, kind: "forbidden" }));
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "not_found" });
    const seeded = seed();
    mocks.access.mockImplementation(async (id: string) =>
      id === BASE ? { ok: true, doc: seeded.tables.documents[0], projectRole: "editor" } : { ok: false, kind: "not_found" });
    expect(await run(seeded.db as never)).toMatchObject({ ok: false, kind: "not_found" });
    const failed = new Error("db down");
    mocks.access.mockResolvedValue({ ok: false, kind: "error", error: failed });
    expect(await run(seeded.db as never)).toEqual(expect.objectContaining({ ok: false, kind: "error", error: failed }));
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("answers 404 when a document has no current file", async () => {
    const fake = seed();
    fake.tables.documents[1].current_version_id = null;
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("answers 409 when either document is a trainee's unapproved draft", async () => {
    const held = { ok: false, kind: "conflict", code: "training_approval_required" };
    expect(await run(seed({ baseExtra: { training_stage: "pasante" } }).db as never)).toMatchObject(held);
    expect(await run(seed({ otherExtra: { training_stage: "pasante" } }).db as never)).toMatchObject(held);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("answers 403 for a viewer of the base, without creating anything", async () => {
    const fake = seed({ projectRole: "viewer" });
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["a base that is a PDF", { baseType: "pdf" }],
    ["a base that is Markdown", { baseType: "md" }],
    ["an other that is a PDF", { otherType: "pdf" }],
    ["an other that is Markdown", { otherType: "md" }],
    ["documents of different projects", { otherDoc: { project_id: "proj-2" } }],
    ["documents outside any project", { baseDoc: { project_id: null }, otherDoc: { project_id: null } }],
    ["a workflow file", { otherDoc: { workflow_id: "w" } }],
    ["a library template", { baseDoc: { library_kind: "template" } }],
  ])("answers compare_not_supported for %s", async (_label, options) => {
    const fake = seed(options as Seed);
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "validation", code: "compare_not_supported" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("refuses to compare a document with itself and a missing or non-text id", async () => {
    const fake = seed();
    expect(await run(fake.db as never, BASE)).toMatchObject({ ok: false, code: "compare_not_supported" });
    mocks.access.mockClear();
    expect(await run(fake.db as never, null)).toMatchObject({ ok: false, kind: "validation" });
    expect(await run(fake.db as never, 42)).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

describe("limits and failures", () => {
  it("answers compare_unreadable for a file that is not a Word package, with nothing created", async () => {
    const fake = seed({ otherBytes: Buffer.from("not a zip at all") });
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "validation", code: "compare_unreadable" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalled();
  });

  it("answers compare_source_too_large by the declared size and by the bytes read", async () => {
    const declared = seed({ baseExtra: { size_bytes: COMPARE_MAX_SOURCE_BYTES + 1 } });
    expect(await run(declared.db as never)).toMatchObject({ ok: false, code: "compare_source_too_large" });
    const other = seed({ otherExtra: { size_bytes: COMPARE_MAX_SOURCE_BYTES + 1 } });
    expect(await run(other.db as never)).toMatchObject({ ok: false, code: "compare_source_too_large" });
    const lying = seed({ otherExtra: { size_bytes: 10 }, otherBytes: Buffer.alloc(COMPARE_MAX_SOURCE_BYTES + 1) });
    expect(await run(lying.db as never)).toMatchObject({ ok: false, code: "compare_source_too_large" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("answers 404 when a stored file is gone", async () => {
    const fake = seed();
    mocks.files.delete("src/vo");
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it.each([
    ["the parser's resource budget", () => new ExtractionLimitError("memory"), "compare_source_too_large"],
    ["a busy parser", () => new ExtractionBusyError(), "compare_unavailable"],
    ["an unavailable converter", () => new ConversionError("conversion.unavailable", "y"), "compare_unavailable"],
    ["any other error", () => new Error("boom"), "compare_unreadable"],
  ])("maps %s to %s", async (_label, make, code) => {
    const fake = seed();
    mocks.extraction.fail = make();
    expect(await run(fake.db as never)).toMatchObject({ ok: false, code });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("removes what it stored when the document or its version cannot be recorded", async () => {
    const fake = seed();
    mocks.create.mockResolvedValue({ data: null, error: new Error("insert failed") });
    expect(await run(fake.db as never)).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(fake.tables.documents.filter((d) => d.id !== BASE && d.id !== OTHER)).toHaveLength(0);
    mocks.uploadFile.mockRejectedValue(new Error("disk"));
    expect(await run(seed().db as never)).toMatchObject({ ok: false, kind: "error" });
  });
});
