import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../documents.shared";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { syntheticPdf } from "../../../lib/__tests__/pdfFixtures";
import { contentSha256 } from "../../../lib/documentVersions";
import { OCR_PAGE_BREAK } from "../../../lib/ocr/pages";

// LandingAI is never called: global fetch is a mock. Every document is synthetic.
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  key: vi.fn(),
  create: vi.fn(),
  publish: vi.fn(),
  audit: vi.fn(),
  files: new Map<string, ArrayBuffer>(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  log: vi.fn(),
  extraction: { fail: null as unknown },
}));

vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../documents.lifecycle", () => ({ createDocumentVersion: mocks.create }));
vi.mock("../documents.ocr", () => ({ OCR_KEY_MISSING_CODE: "ocr_key_missing", publishReading: mocks.publish }));
vi.mock("../../../lib/ocr/key", () => ({ resolveScanKey: mocks.key }));
vi.mock("../../../lib/audit", () => ({ recordAudit: mocks.audit }));
vi.mock("../../../lib/log", () => ({ logError: mocks.log }));
vi.mock("../../../lib/storage", () => ({
  downloadFile: async (key: string) => mocks.files.get(key) ?? null,
  uploadFile: mocks.uploadFile,
  deleteFile: mocks.deleteFile,
  versionStorageKey: (user: string, doc: string, slug: string, name: string) => `v/${user}/${doc}/${slug}/${name}`,
}));
// The parser process is the one under test elsewhere; here the ops run in-process.
vi.mock("../../../lib/extraction/isolated", async (original) => {
  const real = await original<typeof import("../../../lib/extraction/isolated")>();
  return {
    ...real,
    runIsolatedExtraction: async (op: keyof typeof EXTRACTION_OPS, load: () => Promise<ArrayBuffer | null>, options: { fileType?: string; ocr?: never; args?: never } = {}) => {
      if (mocks.extraction.fail) throw mocks.extraction.fail;
      return (EXTRACTION_OPS[op] as (b: ArrayBuffer, t: string, o?: never, a?: never) => unknown)((await load())!, options.fileType ?? "", options.ocr, options.args);
    },
  };
});

import { EXTRACTION_OPS } from "../../../lib/extraction/ops";
import { ExtractionBusyError, ExtractionLimitError } from "../../../lib/extraction/isolated";
import { DEFAULT_SPLIT_CLASSES } from "../../../lib/ocr/splitClasses";
import { cleanSplitName, createSplitDocuments, getSplitState, proposeSplit, uniquePdfName } from "../documents.split";

const USER = "user-1";
const DOC = "doc-1";
const VERSION = "ver-1";
const SECRET = "synthetic-key-0001";
const args = { documentId: DOC, userId: USER, userEmail: "u@x.test" };
const CONSTANCIA = "Constancia de situación fiscal";
const POWER = "Poder o documento de personalidad";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

type Seed = { pages: (string | null)[]; extra?: Record<string, unknown>; projectRole?: string; ocr?: Record<string, unknown>; fileType?: string; others?: { id: string; filename: string }[]; user?: Record<string, unknown> };

async function seed({ pages, extra = {}, projectRole = "editor", ocr, fileType = "pdf", others = [], user }: Seed) {
  const bytes = Buffer.from(await syntheticPdf(pages));
  const storage = `src/${VERSION}`;
  mocks.files.set(storage, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const docRow = { id: DOC, user_id: USER, project_id: "proj", org_id: "org", folder_id: "folder", library_kind: "file", current_version_id: VERSION, archived_at: null };
  const fake = tableDb({
    documents: [docRow, ...others.map((o) => ({ id: o.id, project_id: "proj", folder_id: "folder", current_version_id: `v-${o.id}`, archived_at: null }))],
    document_versions: [
      { id: VERSION, document_id: DOC, storage_path: storage, pdf_storage_path: null, version_number: 1, filename: "Expediente CLIENTE SECRETO.pdf", source: "upload", file_type: fileType, size_bytes: bytes.byteLength, page_count: pages.length, textless_page_count: pages.filter((p) => !p).length, content_sha256: contentSha256(bytes), text_revision: "rev-src", training_stage: null, deleted_at: null, ...extra },
      ...others.map((o) => ({ id: `v-${o.id}`, document_id: o.id, filename: o.filename, deleted_at: null })),
    ],
    document_version_ocr: ocr ? [{ version_id: VERSION, source_revision: "rev-src", status: "ready", model: "dpt-test", credits: 1.1, failed_pages: [], error_code: null, ...ocr }] : [],
    user_profiles: [{ user_id: USER, ...user }],
    organizations: [{ id: "org", split_classes: null }],
    training_version_approvals: [],
  });
  mocks.access.mockResolvedValue({ ok: true, doc: docRow, isCreator: true, projectRole });
  mocks.create.mockImplementation(async (_db: unknown, v: Record<string, unknown>) => {
    const id = `new-${fake.tables.document_versions.length}`;
    fake.tables.document_versions.push({ id, text_revision: `rev-${id}`, deleted_at: null, ...v });
    return { data: { id, ...v }, error: null };
  });
  return { fake, bytes, docRow };
}

const splitAnswer = (splits: unknown[], credit_usage = 0.2) => json(200, { splits, metadata: { credit_usage, filename: "documento.md" } });
const loadPdf = async (key: string) => PDFDocument.load(mocks.files.get(key)!);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.extraction.fail = null;
  mocks.key.mockResolvedValue(SECRET);
  mocks.publish.mockResolvedValue(undefined);
  mocks.uploadFile.mockImplementation(async (key: string, bytes: ArrayBuffer) => void mocks.files.set(key, bytes));
  mocks.deleteFile.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("naming", () => {
  it("cleans what a person typed into a file name", () => {
    expect(cleanSplitName("  Poder / de \\ GACM: *?\"<>|.PDF ")).toBe("Poder de GACM");
    expect(cleanSplitName("a\u0000b\nc")).toBe("a b c");
    expect(cleanSplitName("x".repeat(400))).toHaveLength(150);
    expect(cleanSplitName(7)).toBe("");
    expect(cleanSplitName(".pdf")).toBe("");
  });

  it("numbers a name until it differs from every name taken, case-insensitively", () => {
    const taken = new Set(["poder.pdf", "poder (2).pdf"]);
    expect(uniquePdfName("Poder", taken)).toBe("Poder (3).pdf");
    expect(uniquePdfName("Poder", taken)).toBe("Poder (4).pdf");
    expect(uniquePdfName("Acta", taken)).toBe("Acta.pdf");
  });
});

describe("what splitting would do (GET)", () => {
  it("counts the text, estimates the cost and lists the built-in types, without calling LandingAI", async () => {
    const { fake } = await seed({ pages: ["Uno", "Dos", null], ocr: { pages: [{ page: 3, text: "Leído por OCR" }] } });
    const result = await getSplitState(fake.db, args);
    expect(result).toMatchObject({
      ok: true,
      data: { version_id: VERSION, page_count: 3, unread_pages: 0, needs_scan_reading: false, too_large: false, key_available: true, can_edit: true, classes_source: "default", estimated_credits: 0.1, estimated_cost_usd: 0.001 },
    });
    if (result.ok) {
      expect(result.data.classes).toEqual(DEFAULT_SPLIT_CLASSES);
      expect(result.data.characters).toBe(`Uno\n\n${OCR_PAGE_BREAK}\n\nDos\n\n${OCR_PAGE_BREAK}\n\nLeído por OCR`.length);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the scan reading first while a page is unread", async () => {
    const { fake } = await seed({ pages: ["Uno", null] });
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: true, data: { unread_pages: 1, needs_scan_reading: true } });
  });

  it("says there is no key and no right to edit, and uses the person's own list over the firm's", async () => {
    mocks.key.mockResolvedValue(null);
    const mine = [{ name: "Mío", description: "Mi tipo." }];
    const { fake } = await seed({ pages: ["Uno"], projectRole: "viewer", user: { split_classes: mine } });
    fake.tables.organizations[0].split_classes = [{ name: "Despacho", description: "Del despacho." }];
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: true, data: { key_available: false, can_edit: false, classes_source: "user", classes: mine } });
  });

  it("uses the firm's list when the person has none", async () => {
    const firm = [{ name: "Despacho", description: "Del despacho." }];
    const { fake } = await seed({ pages: ["Uno"] });
    fake.tables.organizations[0].split_classes = firm;
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: true, data: { classes_source: "org", classes: firm } });
  });

  it("is not for a Word file, nor for a version held for training, and is a 404 without access", async () => {
    const word = await seed({ pages: ["x"], fileType: "docx" });
    expect(await getSplitState(word.fake.db, args)).toMatchObject({ ok: false, kind: "validation", code: "split_not_supported" });
    const held = await seed({ pages: ["x"], extra: { training_stage: "pasante", content_sha256: "h" } });
    expect(await getSplitState(held.fake.db, args)).toMatchObject({ ok: false, kind: "conflict", code: "training_approval_required" });
    mocks.access.mockResolvedValue({ ok: false, kind: "forbidden" });
    expect(await getSplitState(held.fake.db, args)).toMatchObject({ ok: false, kind: "not_found" });
    mocks.access.mockResolvedValue({ ok: false, kind: "error", error: new Error("db") });
    expect(await getSplitState(held.fake.db, args)).toMatchObject({ ok: false, kind: "error" });
  });

  it("maps a parser that is too small, busy or unable to read the file", async () => {
    const { fake } = await seed({ pages: ["x"] });
    mocks.extraction.fail = new ExtractionLimitError("big");
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: false, code: "split_too_large" });
    mocks.extraction.fail = new ExtractionBusyError();
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: false, kind: "unavailable" });
    mocks.extraction.fail = new Error("corrupt");
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: false, kind: "validation", code: "split_not_supported" });
  });

  it("flags a file with more than 400 pages as too large", async () => {
    const { fake } = await seed({ pages: Array.from({ length: 401 }, (_, i) => `p${i}`) });
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: true, data: { page_count: 401, too_large: true } });
  }, 60_000);
});

describe("the proposal (POST /split)", () => {
  it("sends the text of the pages, joined by the page marker, under a neutral file name, and returns the proposal without storing anything", async () => {
    const { fake } = await seed({ pages: ["Poder uno", "Poder dos", "Constancia GACM"] });
    fetchMock.mockResolvedValueOnce(
      splitAnswer([
        { classification: POWER, identifier: null, pages: [0, 1], markdowns: [] },
        { classification: CONSTANCIA, identifier: "GACM701119BH5", pages: [2], markdowns: [] },
      ]),
    );
    const before = JSON.stringify(fake.tables);
    const result = await proposeSplit(fake.db, args);
    expect(result).toMatchObject({
      ok: true,
      data: {
        version_id: VERSION,
        page_count: 3,
        credits: 0.2,
        groups: [
          { type: POWER, identifier: null, pages: [1, 2] },
          { type: CONSTANCIA, identifier: "GACM701119BH5", pages: [3] },
        ],
      },
    });
    expect(JSON.stringify(fake.tables)).toBe(before);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.ade.landing.ai/v1/split");
    const form = init.body as FormData;
    const markdown = form.get("markdown") as File;
    expect(markdown.name).toBe("documento.md");
    expect(await markdown.text()).toBe(`Poder uno\n\n${OCR_PAGE_BREAK}\n\nPoder dos\n\n${OCR_PAGE_BREAK}\n\nConstancia GACM`);
    expect(form.has("markdown_url")).toBe(false);
    expect(JSON.parse(form.get("split_class") as string)).toHaveLength(12);
    // Neither the real file name nor the key in anything but the header.
    expect(JSON.stringify([url, [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "file"])])).not.toContain("CLIENTE SECRETO");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(mocks.audit).toHaveBeenCalledWith(fake.db, expect.objectContaining({ action: "document.split_sent", detail: expect.objectContaining({ document_id: DOC, version_id: VERSION }) }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Poder uno");
  });

  it("sends the person's own list of types", async () => {
    const mine = [{ name: "Mío", description: "Mi tipo.", identifier: "Nombre" }];
    const { fake } = await seed({ pages: ["Uno"], user: { split_classes: mine } });
    fetchMock.mockResolvedValueOnce(splitAnswer([{ classification: "Mío", identifier: "Ana", pages: [0] }]));
    const result = await proposeSplit(fake.db, args);
    expect(JSON.parse(((fetchMock.mock.calls[0][1] as RequestInit).body as FormData).get("split_class") as string)).toEqual(mine);
    expect(result).toMatchObject({ ok: true, data: { classes: mine, groups: [{ type: "Mío", identifier: "Ana" }] } });
  });

  it("needs the right to edit, and calls nothing without it", async () => {
    const { fake } = await seed({ pages: ["Uno"], projectRole: "viewer" });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.key).not.toHaveBeenCalled();
  });

  it("answers 409 ocr_key_missing without a key and never calls LandingAI", async () => {
    mocks.key.mockResolvedValue(null);
    const { fake } = await seed({ pages: ["Uno"] });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, kind: "conflict", code: "ocr_key_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 409 split_needs_scan_reading while scanned pages are unread, and calls nothing", async () => {
    const { fake } = await seed({ pages: ["Uno", null] });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, kind: "conflict", code: "split_needs_scan_reading" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a version held for training", async () => {
    const { fake } = await seed({ pages: ["Uno"], extra: { training_stage: "pasante", content_sha256: "h" } });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, kind: "conflict", code: "training_approval_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses more than 400 pages before sending", async () => {
    const { fake } = await seed({ pages: Array.from({ length: 401 }, (_, i) => `p${i}`) });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, code: "split_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  }, 60_000);

  it.each([
    [401, "validation", "ocr_key_invalid"],
    [402, "validation", "ocr_no_credits"],
    [413, "validation", "split_too_large"],
    [422, "validation", "ocr_not_supported"],
    [503, "unavailable", "ocr_unavailable"],
  ])("reports LandingAI's HTTP %i as %s %s, once, without leaking its answer", async (status, kind, code) => {
    const { fake } = await seed({ pages: ["Uno"] });
    fetchMock.mockResolvedValue(json(status, { detail: `echo ${SECRET}` }));
    const result = await proposeSplit(fake.db, args);
    expect(result).toMatchObject({ ok: false, kind, code });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure as internal", async () => {
    mocks.key.mockRejectedValue(new Error("db"));
    const { fake } = await seed({ pages: ["Uno"] });
    expect(await proposeSplit(fake.db, args)).toMatchObject({ ok: false, kind: "error" });
  });
});

describe("creating the documents (POST /split/create)", () => {
  const body = (groups: unknown, version_id: unknown = VERSION) => ({ version_id, groups });
  const create = (db: Db, groups: unknown, version_id: unknown = VERSION) =>
    createSplitDocuments(db, { ...args, versionId: version_id, body: body(groups, version_id) });

  it("makes one new PDF per group with the original pages, copies the reading for free, and leaves the original alone", async () => {
    const { fake, bytes } = await seed({
      pages: ["Poder uno", "Poder dos", null, "Constancia GACM"],
      ocr: { pages: [{ page: 3, text: "Texto leído de la página 3" }, { page: 99, text: "outside" }], credits: 1.1 },
    });
    const originalHash = contentSha256(bytes);
    const result = await create(fake.db, [
      { pages: [4], name: "Constancia de situación fiscal — GACM701119BH5", type: CONSTANCIA },
      { pages: [3, 1, 2], name: "Poder — Ana.pdf", type: POWER },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // In the order of the original, whatever order the groups came in.
    expect(result.data.documents.map((d) => d.filename)).toEqual(["Poder — Ana.pdf", "Constancia de situación fiscal — GACM701119BH5.pdf"]);
    expect(result.data.documents.every((d) => d.file_type === "pdf" && d.project_id === "proj" && d.folder_id === "folder")).toBe(true);

    // Version 1, source 'split', the page count known, in the same folder.
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ source: "split", version_number: 1, file_type: "pdf", page_count: 3, filename: "Poder — Ana.pdf" });
    expect(fake.tables.documents.filter((d) => d.id !== DOC).every((d) => d.folder_id === "folder" && d.project_id === "proj" && d.user_id === USER)).toBe(true);

    // The pages are the original ones, in order.
    const uploaded = [...mocks.uploadFile.mock.calls].map(([key]) => key as string).filter((key) => key.startsWith("v/"));
    expect(uploaded).toHaveLength(2);
    expect((await loadPdf(uploaded[0])).getPageCount()).toBe(3);
    expect((await loadPdf(uploaded[1])).getPageCount()).toBe(1);

    // The reading of page 3 becomes page 3 of the first document (original order 1, 2, 3), at no cost.
    const readings = fake.tables.document_version_ocr.filter((r) => r.version_id !== VERSION);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ status: "ready", credits: 0, page_count: 3, provider: "landingai", model: "dpt-test", pages: [{ page: 3, text: "Texto leído de la página 3" }], source_revision: "rev-new-1", requested_by: USER });
    expect(mocks.publish).toHaveBeenCalledTimes(2);

    // The original: same bytes, same rows, same reading.
    expect(contentSha256(Buffer.from(mocks.files.get("src/ver-1")!))).toBe(originalHash);
    expect(fake.tables.document_versions[0]).toMatchObject({ id: VERSION, filename: "Expediente CLIENTE SECRETO.pdf" });
    expect(fake.tables.document_version_ocr[0]).toMatchObject({ version_id: VERSION, credits: 1.1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("numbers names that collide with the folder or with each other", async () => {
    const { fake } = await seed({ pages: ["a", "b", "c"], others: [{ id: "other", filename: "Acta.pdf" }] });
    const result = await create(fake.db, [
      { pages: [1], name: "Acta", type: null },
      { pages: [2], name: "acta", type: null },
      { pages: [3], name: "Acta", type: null },
    ]);
    expect(result.ok && result.data.documents.map((d) => d.filename)).toEqual(["Acta (2).pdf", "acta (3).pdf", "Acta (4).pdf"]);
  });

  it("does not need every page to be in a group: an unchecked group is simply not created", async () => {
    const { fake } = await seed({ pages: ["a", "b", "c"] });
    const result = await create(fake.db, [{ pages: [2], name: "Solo la dos", type: null }]);
    expect(result.ok && result.data.documents).toHaveLength(1);
    expect(fake.tables.document_version_ocr).toEqual([]);
  });

  it("refuses a proposal made on a version that is no longer the current one", async () => {
    const { fake } = await seed({ pages: ["a"] });
    expect(await create(fake.db, [{ pages: [1], name: "A", type: null }], "older-version")).toMatchObject({ ok: false, kind: "conflict", code: "document_version_conflict" });
    expect(await create(fake.db, [{ pages: [1], name: "A", type: null }], null)).toMatchObject({ ok: false, code: "document_version_conflict" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no groups", []],
    ["not a list", "x"],
    ["a group that is not an object", [null]],
    ["a group without pages", [{ pages: [], name: "A", type: null }]],
    ["pages that are not a list", [{ pages: "1", name: "A", type: null }]],
    ["a page that is not an integer", [{ pages: [1.5], name: "A", type: null }]],
    ["page zero", [{ pages: [0], name: "A", type: null }]],
    ["a page the version does not have", [{ pages: [4], name: "A", type: null }]],
    ["a page repeated inside a group", [{ pages: [1, 1], name: "A", type: null }]],
    ["a page in two groups", [{ pages: [1], name: "A", type: null }, { pages: [1, 2], name: "B", type: null }]],
    ["a name that is empty once cleaned", [{ pages: [1], name: " / .pdf ", type: null }]],
    ["a name that is not text", [{ pages: [1], name: 5, type: null }]],
    ["a type that is not in the list", [{ pages: [1], name: "A", type: "Invented" }]],
    ["a type that is not text", [{ pages: [1], name: "A", type: 7 }]],
    ["more groups than pages", [{ pages: [1], name: "A", type: null }, { pages: [2], name: "B", type: null }, { pages: [3], name: "C", type: null }, { pages: [], name: "D", type: null }]],
  ])("refuses %s as split_invalid_groups and creates nothing", async (_label, groups) => {
    const { fake } = await seed({ pages: ["a", "b", "c"] });
    expect(await create(fake.db, groups)).toMatchObject({ ok: false, kind: "validation", code: "split_invalid_groups" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("checks the type against the list that applies to this person", async () => {
    const { fake } = await seed({ pages: ["a"], user: { split_classes: [{ name: "Mío", description: "Mi tipo." }] } });
    expect(await create(fake.db, [{ pages: [1], name: "A", type: POWER }])).toMatchObject({ ok: false, code: "split_invalid_groups" });
    expect((await create(fake.db, [{ pages: [1], name: "A", type: "Mío" }])).ok).toBe(true);
  });

  it("needs the right to edit and is a 404 without access; a version held for training is not copied", async () => {
    const viewer = await seed({ pages: ["a"], projectRole: "viewer" });
    expect(await create(viewer.fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, kind: "forbidden" });
    const held = await seed({ pages: ["a"], extra: { training_stage: "pasante", content_sha256: "h" } });
    expect(await create(held.fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, code: "training_approval_required" });
    mocks.access.mockResolvedValue({ ok: false, kind: "forbidden" });
    expect(await create(held.fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, kind: "not_found" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reads the page count from the file when the upload did not record it", async () => {
    const { fake } = await seed({ pages: ["a", "b"], extra: { page_count: null } });
    expect(await create(fake.db, [{ pages: [3], name: "A", type: null }])).toMatchObject({ ok: false, code: "split_invalid_groups" });
    expect((await create(fake.db, [{ pages: [2], name: "A", type: null }])).ok).toBe(true);
  });

  it("removes what it made if a later document cannot be made", async () => {
    const { fake } = await seed({ pages: ["a", "b"], ocr: { pages: [{ page: 1, text: "ocr" }] } });
    mocks.create.mockReset();
    mocks.create
      .mockImplementationOnce(async (_db: unknown, v: Record<string, unknown>) => {
        fake.tables.document_versions.push({ id: "made-1", text_revision: "r", deleted_at: null, ...v });
        return { data: { id: "made-1", ...v }, error: null };
      })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await create(fake.db, [{ pages: [1], name: "Uno", type: null }, { pages: [2], name: "Dos", type: null }]);
    expect(result).toMatchObject({ ok: false, kind: "error" });
    // Both documents rows are gone, and so are their stored files.
    expect(fake.tables.documents.map((d) => d.id)).toEqual([DOC]);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("removes what it made if the reading cannot be copied", async () => {
    const { fake } = await seed({ pages: [null, "b"], ocr: { pages: [{ page: 1, text: "ocr" }] } });
    mocks.create.mockImplementationOnce(async (_db: unknown, v: Record<string, unknown>) => ({ data: { id: "no-row", ...v }, error: null }));
    const result = await create(fake.db, [{ pages: [1], name: "Uno", type: null }]);
    expect(result).toMatchObject({ ok: false, kind: "error" });
    expect(fake.tables.documents.map((d) => d.id)).toEqual([DOC]);
  });

  it("still succeeds when the extra read of a new document fails, because the queued extraction does the same work", async () => {
    const { fake } = await seed({ pages: ["a"] });
    mocks.publish.mockRejectedValue(new Error("busy"));
    expect((await create(fake.db, [{ pages: [1], name: "A", type: null }])).ok).toBe(true);
    expect(mocks.log).toHaveBeenCalled();
  });

  it("maps a parser that cannot copy the pages", async () => {
    const { fake } = await seed({ pages: ["a"] });
    mocks.extraction.fail = new ExtractionLimitError("big");
    expect(await create(fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, code: "split_too_large" });
  });

  it("refuses a source that is too large to copy", async () => {
    const { fake } = await seed({ pages: ["a"], extra: { size_bytes: 26 * 1024 * 1024 } });
    expect(await create(fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, code: "split_too_large" });
    expect(await getSplitState(fake.db, args)).toMatchObject({ ok: false, code: "split_too_large" });
  });

  it("reports a missing stored file as not found", async () => {
    const { fake } = await seed({ pages: ["a"] });
    mocks.files.clear();
    expect(await create(fake.db, [{ pages: [1], name: "A", type: null }])).toMatchObject({ ok: false, kind: "not_found" });
  });
});
