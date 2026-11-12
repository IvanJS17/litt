import { beforeEach, describe, expect, it, vi } from "vitest";
import mammoth from "mammoth";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { buildRichDocx, FIXTURE_TEXT } from "../../../lib/__tests__/docxFixtures";
import { contentSha256 } from "../../../lib/documentVersions";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  create: vi.fn(),
  files: new Map<string, ArrayBuffer>(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  docxToPdf: vi.fn(),
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
vi.mock("../../../lib/convert", async (original) => ({
  ...(await original<typeof import("../../../lib/convert")>()),
  docxToPdf: mocks.docxToPdf,
}));
// The parser process is the one under test elsewhere; here the op runs in-process.
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
import {
  CONVERSION_LOSSES,
  CONVERT_MAX_MARKDOWN_BYTES,
  conversionTargets,
  convertDocument,
  convertedFilename,
  previewDocumentConversion,
} from "../documents.convert";

const USER = "user-1";
const DOC = "doc-1";
const VERSION = "ver-1";

const asArrayBuffer = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

type Seed = {
  fileType: string;
  filename: string;
  bytes: Buffer;
  extra?: Record<string, unknown>;
  doc?: Record<string, unknown>;
  projectRole?: string;
  others?: Array<{ id: string; filename: string; folder_id?: string | null }>;
  locale?: string;
};

function seed({ fileType, filename, bytes, extra = {}, doc = {}, projectRole = "editor", others = [], locale }: Seed) {
  const storage = `src/${VERSION}`;
  mocks.files.set(storage, asArrayBuffer(bytes));
  const docRow = { id: DOC, user_id: USER, project_id: "proj", org_id: "org", folder_id: "folder", library_kind: "file", current_version_id: VERSION, archived_at: null, ...doc };
  const fake = tableDb({
    documents: [docRow, ...others.map((o) => ({ id: o.id, project_id: "proj", folder_id: o.folder_id ?? "folder", current_version_id: `v-${o.id}`, archived_at: null }))],
    document_versions: [
      { id: VERSION, document_id: DOC, storage_path: storage, pdf_storage_path: null, version_number: 1, filename, source: "upload", file_type: fileType, size_bytes: bytes.byteLength, page_count: null, textless_page_count: null, content_sha256: contentSha256(bytes), training_stage: null, deleted_at: null, ...extra },
      ...others.map((o) => ({ id: `v-${o.id}`, document_id: o.id, filename: o.filename, deleted_at: null })),
    ],
    user_profiles: locale ? [{ user_id: USER, ui_locale: locale }] : [],
    training_version_approvals: [],
  });
  mocks.access.mockResolvedValue({ ok: true, doc: docRow, isCreator: true, projectRole });
  return { fake, docRow };
}

const run = (db: never, target: unknown) => convertDocument(db, { documentId: DOC, userId: USER, userEmail: "u@x.test", target });
const preview = (db: never, target: unknown) => previewDocumentConversion(db, { documentId: DOC, userId: USER, userEmail: "u@x.test", target });
const stored = (key: string) => Buffer.from(mocks.files.get(key)!);

/** A one-page PDF with a text layer, written by hand so no converter is needed. */
function textPdf(text: string | null): Buffer {
  // null: a page that only saves and restores graphics state, so it has no text at all.
  const stream = text === null ? "q Q" : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const blankPdf = () => textPdf(null);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.extraction.fail = null;
  mocks.uploadFile.mockImplementation(async (key: string, bytes: ArrayBuffer) => void mocks.files.set(key, bytes));
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (_db: unknown, v: Record<string, unknown>) => ({ data: { id: "new-version", ...v }, error: null }));
});

describe("what can be converted to what", () => {
  it("offers Word, Markdown and PDF only the targets that exist, and never PDF → Word", () => {
    expect(conversionTargets("md")).toEqual(["docx", "pdf"]);
    expect(conversionTargets("docx")).toEqual(["md", "pdf"]);
    expect(conversionTargets("pdf")).toEqual(["md"]);
    expect(Object.keys(CONVERSION_LOSSES)).not.toContain("pdf>docx");
  });
});

describe("Word → Markdown", () => {
  it("creates a new converted document with the text, the table and the notice counts, and leaves the original alone", async () => {
    const docx = await buildRichDocx();
    const { fake } = seed({ fileType: "docx", filename: "Contrato.docx", bytes: docx });
    const originalHash = contentSha256(docx);

    const noticed = await preview(fake.db as never, "md");
    expect(noticed).toEqual({
      ok: true,
      data: {
        source_type: "docx",
        target: "md",
        losses: CONVERSION_LOSSES["docx>md"],
        detected: { comments: 1, tracked_insertions: 1, tracked_deletions: 1, images: 1, footnotes: 1, headers: 1, footers: 1 },
        blocked: null,
        textless_page_count: null,
        new_filename: "Contrato (de Word).md",
      },
    });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();

    const result = await run(fake.db as never, "md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ filename: "Contrato (de Word).md", file_type: "md", project_id: "proj", folder_id: "folder" });

    // The new document is a document of its own, in the same project and folder.
    const created = fake.tables.documents.find((d) => d.id === result.data.document_id)!;
    expect(created).toMatchObject({ project_id: "proj", folder_id: "folder", org_id: "org", user_id: USER, status: "ready", library_kind: "file" });
    // Version 1, source 'converted', with the hash of the bytes it stored.
    const [, version, options] = [...mocks.create.mock.calls[0], undefined];
    expect(version).toMatchObject({ document_id: result.data.document_id, source: "converted", version_number: 1, file_type: "md", filename: "Contrato (de Word).md", pdf_storage_path: null, authorship: { kind: "author", userId: USER } });
    expect(options).toBeUndefined();
    const markdown = stored(version.storage_path as string).toString("utf8");
    expect(version.content_sha256).toBe(contentSha256(Buffer.from(markdown, "utf8")));
    expect(version.size_bytes).toBe(Buffer.byteLength(markdown));
    expect(markdown).toContain(`# ${FIXTURE_TEXT.title}`);
    expect(markdown).toContain("| Concepto | Monto |\n| --- | --- |\n| Asesoría | 1,500 |");
    expect(markdown).not.toContain(FIXTURE_TEXT.deleted);
    expect(markdown).not.toContain(FIXTURE_TEXT.commentBody);

    // The original: same bytes, same version row, no other version.
    expect(contentSha256(Buffer.from(mocks.files.get("src/ver-1")!))).toBe(originalHash);
    expect(fake.tables.document_versions.filter((v) => v.document_id === DOC)).toHaveLength(1);
    expect(fake.tables.documents.find((d) => d.id === DOC)).toMatchObject({ current_version_id: VERSION });
    expect(fake.calls.filter((c) => c.table === "document_versions" && c.op !== "select")).toEqual([]);
  });

  it("names the document in English for a person who uses English", async () => {
    const { fake } = seed({ fileType: "docx", filename: "Lease.docx", bytes: await buildRichDocx(), locale: "en-US" });
    expect(await preview(fake.db as never, "md")).toMatchObject({ ok: true, data: { new_filename: "Lease (from Word).md" } });
  });

  it("does not collide with a name already taken in the same folder, only in that folder", async () => {
    const { fake } = seed({
      fileType: "docx",
      filename: "Contrato.docx",
      bytes: await buildRichDocx(),
      others: [
        { id: "a", filename: "Contrato (de Word).md" },
        { id: "b", filename: "CONTRATO (de Word) (2).md" },
        { id: "c", filename: "Contrato (de Word) (3).md", folder_id: "elsewhere" },
      ],
    });
    const result = await run(fake.db as never, "md");
    expect(result).toMatchObject({ ok: true, data: { filename: "Contrato (de Word) (3).md" } });
  });

  it.each([
    ["an unreadable file", new Error("boom"), "validation", "convert_unreadable"],
    ["a file over the parser budget", new ExtractionLimitError("big"), "validation", "convert_source_too_large"],
    ["a parser with no free slot", new ExtractionBusyError(), "unavailable", "convert_unavailable"],
  ])("answers %s without creating anything", async (_label, error, kind, code) => {
    const { fake } = seed({ fileType: "docx", filename: "x.docx", bytes: await buildRichDocx() });
    mocks.extraction.fail = error;
    expect(await run(fake.db as never, "md")).toMatchObject({ ok: false, kind, code });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(fake.tables.documents).toHaveLength(1);
  });

  it.each([
    ["a package over the parser budget", new ExtractionLimitError("big"), "validation", "convert_source_too_large"],
    ["a parser with no free slot", new ExtractionBusyError(), "unavailable", "convert_unavailable"],
    ["a package that cannot be read", new Error("boom"), "validation", "convert_unreadable"],
  ])("answers the preview of %s with a controlled error", async (_label, error, kind, code) => {
    const { fake } = seed({ fileType: "docx", filename: "x.docx", bytes: await buildRichDocx() });
    mocks.extraction.fail = error;
    expect(await preview(fake.db as never, "md")).toMatchObject({ ok: false, kind, code });
  });

  it("refuses a Word file with no text", async () => {
    const { Document, Packer } = await import("docx");
    const empty = await Packer.toBuffer(new Document({ sections: [{ children: [] }] }));
    const { fake } = seed({ fileType: "docx", filename: "vacio.docx", bytes: empty });
    expect(await run(fake.db as never, "md")).toMatchObject({ ok: false, kind: "validation", code: "convert_unreadable" });
  });

  it("reports a file that is not a Word package in the notice", async () => {
    const { fake } = seed({ fileType: "docx", filename: "x.docx", bytes: Buffer.from("not a zip") });
    expect(await preview(fake.db as never, "md")).toMatchObject({ ok: false, kind: "validation", code: "convert_unreadable" });
  });
});

describe("Markdown → Word and PDF", () => {
  const SOURCE = "# Título\n\nEl señor **Muñoz** pagó.\n\n1. uno\n2. dos\n\n| a | b |\n| - | - |\n| ñ | á |\n";

  it("writes a Word file whose text matches the Markdown", async () => {
    const { fake } = seed({ fileType: "md", filename: "notas.md", bytes: Buffer.from(SOURCE, "utf8") });
    const result = await run(fake.db as never, "docx");
    expect(result).toMatchObject({ ok: true, data: { filename: "notas (de Markdown).docx", file_type: "docx" } });
    const version = mocks.create.mock.calls[0][1];
    expect(version).toMatchObject({ source: "converted", version_number: 1, file_type: "docx" });
    const text = (await mammoth.extractRawText({ buffer: stored(version.storage_path) })).value;
    for (const piece of ["Título", "El señor Muñoz pagó.", "uno", "dos", "ñ", "á"]) expect(text).toContain(piece);
    // The original Markdown bytes are untouched.
    expect(Buffer.from(mocks.files.get("src/ver-1")!).toString("utf8")).toBe(SOURCE);
  });

  it("renders the PDF from the Word it wrote", async () => {
    const { fake } = seed({ fileType: "md", filename: "notas.md", bytes: Buffer.from(SOURCE, "utf8") });
    mocks.docxToPdf.mockImplementation(async (docx: Buffer) => {
      expect((await mammoth.extractRawText({ buffer: docx })).value).toContain("El señor Muñoz pagó.");
      return textPdf("pdf");
    });
    const result = await run(fake.db as never, "pdf");
    expect(result).toMatchObject({ ok: true, data: { filename: "notas (en PDF).pdf", file_type: "pdf" } });
    expect(stored(mocks.create.mock.calls[0][1].storage_path).subarray(0, 5).toString()).toBe("%PDF-");
    expect(mocks.uploadFile.mock.calls[0][2]).toBe("application/pdf");
  });

  it("says LibreOffice is unavailable when it is", async () => {
    const { fake } = seed({ fileType: "md", filename: "notas.md", bytes: Buffer.from(SOURCE) });
    mocks.docxToPdf.mockRejectedValue(new ConversionError("conversion.unavailable", "no soffice"));
    expect(await run(fake.db as never, "pdf")).toMatchObject({ ok: false, kind: "unavailable", code: "convert_unavailable" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalled();
  });

  it("refuses a Markdown file over the in-process cap", async () => {
    const { fake } = seed({ fileType: "md", filename: "grande.md", bytes: Buffer.from("x"), extra: { size_bytes: CONVERT_MAX_MARKDOWN_BYTES + 1 } });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "validation", code: "convert_source_too_large" });
  });
});

describe("Word → PDF", () => {
  it("uses the version's stored PDF when it has one, LibreOffice when it does not", async () => {
    const docx = await buildRichDocx();
    mocks.files.set("rendition.pdf", asArrayBuffer(textPdf("rendition")));
    const withPdf = seed({ fileType: "docx", filename: "a.docx", bytes: docx, extra: { pdf_storage_path: "rendition.pdf" } });
    expect(await run(withPdf.fake.db as never, "pdf")).toMatchObject({ ok: true, data: { filename: "a (en PDF).pdf" } });
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(stored(mocks.create.mock.calls[0][1].storage_path).toString("latin1")).toContain("rendition");

    mocks.docxToPdf.mockResolvedValue(textPdf("converted"));
    const without = seed({ fileType: "docx", filename: "b.docx", bytes: docx });
    expect(await run(without.fake.db as never, "pdf")).toMatchObject({ ok: true });
    expect(mocks.docxToPdf).toHaveBeenCalledTimes(1);
  });

  it("falls back to LibreOffice when the stored PDF is gone", async () => {
    mocks.docxToPdf.mockResolvedValue(textPdf("again"));
    const { fake } = seed({ fileType: "docx", filename: "a.docx", bytes: await buildRichDocx(), extra: { pdf_storage_path: "missing.pdf" } });
    expect(await run(fake.db as never, "pdf")).toMatchObject({ ok: true });
    expect(mocks.docxToPdf).toHaveBeenCalledTimes(1);
  });
});

describe("PDF → Markdown", () => {
  it("writes the text of a PDF with a text layer, page by page, in the person's language", async () => {
    const { fake } = seed({ fileType: "pdf", filename: "escritura.pdf", bytes: textPdf("Clausula primera del senor Munoz") });
    expect(await preview(fake.db as never, "md")).toMatchObject({ ok: true, data: { source_type: "pdf", detected: null, blocked: null, losses: ["pdf_layout_lost"] } });
    const result = await run(fake.db as never, "md");
    expect(result).toMatchObject({ ok: true, data: { filename: "escritura (de PDF).md" } });
    const markdown = stored(mocks.create.mock.calls[0][1].storage_path).toString("utf8");
    expect(markdown).toBe("## Página 1\n\nClausula primera del senor Munoz");
  });

  it("keeps the English page heading for English", async () => {
    const { fake } = seed({ fileType: "pdf", filename: "deed.pdf", bytes: textPdf("First clause"), locale: "en-US" });
    await run(fake.db as never, "md");
    expect(stored(mocks.create.mock.calls[0][1].storage_path).toString("utf8")).toBe("## Page 1\n\nFirst clause");
  });

  it("says a PDF with no text needs OCR, and creates nothing", async () => {
    const { fake } = seed({ fileType: "pdf", filename: "escaneo.pdf", bytes: blankPdf() });
    expect(await run(fake.db as never, "md")).toMatchObject({ ok: false, kind: "validation", code: "convert_pdf_without_text" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(fake.tables.documents).toHaveLength(1);
  });

  it("knows from the measured pages that a PDF is a scan, before reading it", async () => {
    const { fake } = seed({ fileType: "pdf", filename: "escaneo.pdf", bytes: textPdf("x"), extra: { page_count: 3, textless_page_count: 3 } });
    expect(await preview(fake.db as never, "md")).toMatchObject({ ok: true, data: { blocked: "pdf_without_text", textless_page_count: 3 } });
    expect(await run(fake.db as never, "md")).toMatchObject({ ok: false, code: "convert_pdf_without_text" });
    const mixed = seed({ fileType: "pdf", filename: "mixto.pdf", bytes: textPdf("x"), extra: { page_count: 3, textless_page_count: 1 } });
    expect(await preview(mixed.fake.db as never, "md")).toMatchObject({ ok: true, data: { blocked: null, textless_page_count: 1 } });
  });

  it("counts the pages without text of a mixed PDF, and none for other sources", async () => {
    const mixed = seed({ fileType: "pdf", filename: "mixto.pdf", bytes: textPdf("x"), extra: { page_count: 10, textless_page_count: 3 } });
    expect(await preview(mixed.fake.db as never, "md")).toMatchObject({ ok: true, data: { blocked: null, textless_page_count: 3 } });
    const word = seed({ fileType: "docx", filename: "a.docx", bytes: await buildRichDocx() });
    expect(await preview(word.fake.db as never, "md")).toMatchObject({ ok: true, data: { textless_page_count: null } });
  });

  it("does not offer PDF → Word", async () => {
    const { fake } = seed({ fileType: "pdf", filename: "a.pdf", bytes: textPdf("x") });
    expect(await preview(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "validation", code: "convert_not_supported" });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "validation", code: "convert_not_supported" });
  });
});

describe("who may convert", () => {
  it("answers 404 for a document the caller cannot open, for both routes", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("x") });
    mocks.access.mockResolvedValue({ ok: false, kind: "forbidden" });
    expect(await preview(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "not_found" });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "not_found" });
    mocks.access.mockResolvedValue({ ok: false, kind: "not_found" });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "not_found" });
    const failed = new Error("db down");
    mocks.access.mockResolvedValue({ ok: false, kind: "error", error: failed });
    expect(await run(fake.db as never, "docx")).toEqual(expect.objectContaining({ ok: false, kind: "error", error: failed }));
  });

  it("answers 409 for a trainee's draft that is not approved, and converts it once approved", async () => {
    const bytes = Buffer.from("# borrador");
    const { fake } = seed({ fileType: "md", filename: "borrador.md", bytes, extra: { training_stage: "pasante" } });
    const held = { ok: false, kind: "conflict", code: "training_approval_required" };
    expect(await preview(fake.db as never, "docx")).toMatchObject(held);
    expect(await run(fake.db as never, "docx")).toMatchObject(held);
    expect(mocks.uploadFile).not.toHaveBeenCalled();

    fake.tables.training_version_approvals.push({ document_version_id: VERSION, content_sha256: contentSha256(bytes) });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: true });
  });

  it("passes an unreadable approval table through as an internal failure, not a release", async () => {
    const { fake } = seed({ fileType: "md", filename: "b.md", bytes: Buffer.from("x"), extra: { training_stage: "pasante", content_sha256: "h" } });
    const broken = tableDb({ ...fake.tables }, { failSelects: ["training_version_approvals"] });
    expect(await run(broken.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
  });

  it("lets a viewer see the notice but not create, with the same sentence as uploading", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("x"), projectRole: "viewer" });
    expect(await preview(fake.db as never, "docx")).toMatchObject({ ok: true });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "forbidden", detail: "You do not have permission to edit content in this project." });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a target that does not exist, and documents that are not filed like documents", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("x") });
    expect(await run(fake.db as never, "odt")).toMatchObject({ ok: false, kind: "validation" });
    expect(await run(fake.db as never, undefined)).toMatchObject({ ok: false, kind: "validation" });
    expect(mocks.access).not.toHaveBeenCalled();
    for (const doc of [{ workflow_id: "w", project_id: null }, { library_kind: "template", project_id: null }]) {
      const other = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("x"), doc });
      expect(await run(other.fake.db as never, "docx")).toMatchObject({ ok: false, code: "convert_not_supported" });
    }
    const spreadsheet = seed({ fileType: "xlsx", filename: "a.xlsx", bytes: Buffer.from("x") });
    expect(await run(spreadsheet.fake.db as never, "pdf")).toMatchObject({ ok: false, code: "convert_not_supported" });
  });

  it("answers 404 when the document has no readable file", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("x") });
    mocks.files.clear();
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "not_found" });
    fake.tables.documents[0].current_version_id = null;
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "not_found" });
  });
});

describe("a library document", () => {
  it("lands in the same library folder and is named among that folder's files", async () => {
    const { fake } = seed({
      fileType: "docx",
      filename: "Modelo.docx",
      bytes: await buildRichDocx(),
      doc: { project_id: null, folder_id: null, library_folder_id: "lib-folder" },
    });
    const result = await run(fake.db as never, "md");
    expect(result).toMatchObject({ ok: true, data: { project_id: null, folder_id: "lib-folder" } });
    const created = fake.tables.documents.find((d) => d.id !== DOC)!;
    expect(created).toMatchObject({ project_id: null, folder_id: null, library_kind: "file", library_folder_id: "lib-folder", user_id: USER });
  });

  it("lands at the root of the library when the original is there", async () => {
    const { fake } = seed({ fileType: "md", filename: "n.md", bytes: Buffer.from("x"), doc: { project_id: null, folder_id: null, library_folder_id: null } });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: true, data: { folder_id: null } });
  });
});

describe("when storing or recording fails", () => {
  it("removes the stored file when the document row cannot be written", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("# x") });
    const original = fake.db.from.bind(fake.db);
    (fake.db as unknown as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (table === "documents") builder.insert = () => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: "no" } }) });
      return builder;
    };
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("removes the document and the file when the version cannot be recorded", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("# x") });
    mocks.create.mockResolvedValue({ data: null, error: { message: "rpc failed" } });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
    expect(fake.tables.documents.map((d) => d.id)).toEqual([DOC]);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("reports a storage write failure as internal and creates no document", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("# x") });
    mocks.uploadFile.mockRejectedValue(new Error("r2 down"));
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
    expect(fake.tables.documents).toHaveLength(1);
  });

  it("reports a sibling lookup failure as internal", async () => {
    const { fake } = seed({ fileType: "md", filename: "a.md", bytes: Buffer.from("# x") });
    const original = fake.db.from.bind(fake.db);
    // Only the sibling listing (the one that filters out archived documents) fails.
    (fake.db as unknown as { from: unknown }).from = (table: string) => {
      const builder = original(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const is = builder.is;
      builder.is = (column: unknown, value: unknown) =>
        column === "archived_at"
          ? { order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "down" } }) }) }
          : is(column, value);
      return builder;
    };
    expect(await preview(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
    expect(await run(fake.db as never, "docx")).toMatchObject({ ok: false, kind: "error" });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });
});

describe("convertedFilename", () => {
  it("handles a name with no extension, a long name and a missing name", () => {
    expect(convertedFilename("Acta", "md>docx", "es-MX", new Set())).toBe("Acta (de Markdown).docx");
    expect(convertedFilename(null, "pdf>md", "en-US", new Set())).toBe("Untitled document (from PDF).md");
    const long = convertedFilename(`${"ñ".repeat(300)}.docx`, "docx>md", "es-MX", new Set());
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(" (de Word).md")).toBe(true);
  });
});
