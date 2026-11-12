import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import type { DbJob } from "../../../lib/dbq/types";

// LandingAI is never called: its client is a mock. Nothing here touches a real key.
const mocks = vi.hoisted(() => ({
  access: vi.fn(), active: vi.fn(), key: vi.fn(), released: vi.fn(), enqueue: vi.fn(),
  stamp: vi.fn(), assertStamp: vi.fn(), download: vi.fn(), parse: vi.fn(), publish: vi.fn(), extract: vi.fn(),
}));
vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../../../lib/documentVersions", () => ({ loadActiveVersion: mocks.active }));
vi.mock("../../../lib/ocr/key", () => ({ resolveScanKey: mocks.key }));
vi.mock("../../../lib/trainingRelease", () => ({ assertVersionReleasable: mocks.released }));
vi.mock("../../../lib/dbq/enqueue", () => ({ enqueueDbJob: mocks.enqueue }));
vi.mock("../../../lib/authorizationEpoch", () => ({ readAuthorizationStamp: mocks.stamp, assertAuthorizationStamp: mocks.assertStamp }));
vi.mock("../../../lib/storage", () => ({ downloadFile: mocks.download }));
vi.mock("../documents.indexing", () => ({ extractAndPublishText: mocks.publish }));
vi.mock("../../../lib/extraction/isolated", async () => {
  class ExtractionBusyError extends Error {}
  return { ExtractionBusyError, withBackgroundExtraction: (_: unknown, work: (e: unknown) => unknown) => work(mocks.extract) };
});
vi.mock("../../../lib/ocr/landingai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ocr/landingai")>()),
  parsePdfWithLandingAi: mocks.parse,
}));
import { OcrError } from "../../../lib/ocr/landingai";
import {
  getScanReadingState, handleDocumentOcr, markDocumentOcrFailed, queueScanReadingOnUpload, requestScanReading,
} from "../documents.ocr";

const args = { documentId: "d1", userId: "u1", userEmail: "a@example.test" };
const scanned = { id: "v1", file_type: "pdf", text_revision: "r1", textless_page_count: 3, page_count: 10, size_bytes: 1000, storage_path: "p", content_sha256: null };
const okResult = { ok: true as const, data: undefined };
const allowed = { ok: true, doc: { id: "d1", org_id: "o1" }, isCreator: true, projectRole: "owner" };
const row = (patch: Record<string, unknown> = {}) => ({ version_id: "v1", source_revision: "r1", status: "processing", pages: null, failed_pages: [], credits: null, page_count: null, error_code: null, ...patch });
const job = { id: "j", kind: "document.ocr", status: "running", attempts: 1, max_attempts: 2, payload: { documentId: "d1", versionId: "v1", revision: "r1", userId: "u1", userEmail: "a@example.test", authorization: { orgId: "o1", epoch: 3 } } } as unknown as DbJob;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(allowed);
  mocks.active.mockResolvedValue(scanned);
  mocks.key.mockResolvedValue("synthetic-key");
  mocks.released.mockResolvedValue(okResult);
  mocks.stamp.mockResolvedValue({ orgId: "o1", epoch: 3 });
  mocks.download.mockResolvedValue(new ArrayBuffer(8));
  mocks.publish.mockResolvedValue({ textlessPageCount: 0 });
  // Pages 2, 5 and 9 of a 10-page PDF have no text layer.
  mocks.extract.mockResolvedValue({ pages: [2, 5, 9], total: 10 });
});

describe("scan reading state", () => {
  it("offers the reading when pages lack text and a key is available, with the cost of the scanned pages only", async () => {
    const fake = scriptedDb([{ table: "document_version_ocr", data: null }]);
    const result = await getScanReadingState(fake.db, args);
    expect(result).toMatchObject({ ok: true, data: { applicable: true, status: "none", key_available: true, needs_reading: true, estimated_cost_usd: 0.03, auto_max_pages: 50, can_edit: true } });
    fake.done();
  });
  it("reports a running reading and hides the button; a reading of other bytes counts as none", async () => {
    let fake = scriptedDb([{ table: "document_version_ocr", data: row() }]);
    expect(await getScanReadingState(fake.db, args)).toMatchObject({ data: { status: "processing", needs_reading: false } });
    fake = scriptedDb([{ table: "document_version_ocr", data: row({ source_revision: "old", status: "ready", pages: [{ page: 1, text: "x" }] }) }]);
    expect(await getScanReadingState(fake.db, args)).toMatchObject({ data: { status: "none" } });
  });
  it("shows a failure code and says no key when none is saved", async () => {
    mocks.key.mockResolvedValue(null);
    const fake = scriptedDb([{ table: "document_version_ocr", data: row({ status: "failed", error_code: "ocr_no_credits" }) }]);
    expect(await getScanReadingState(fake.db, args)).toMatchObject({ data: { status: "failed", error_code: "ocr_no_credits", key_available: false } });
  });
  it("is not applicable to a Word file and never looks for a key", async () => {
    mocks.active.mockResolvedValue({ ...scanned, file_type: "docx" });
    const fake = scriptedDb([]);
    expect(await getScanReadingState(fake.db, args)).toMatchObject({ data: { applicable: false, needs_reading: false } });
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it("is a 404 without access", async () => {
    mocks.access.mockResolvedValue({ ok: false, kind: "forbidden" });
    expect(await getScanReadingState(scriptedDb([]).db, args)).toMatchObject({ ok: false, kind: "not_found" });
  });
});

describe("requesting a reading", () => {
  it("marks the version as being read and queues a job without the key", async () => {
    const fake = scriptedDb([
      { table: "document_version_ocr", data: null },
      { table: "document_version_ocr", op: "upsert" },
      { table: "document_version_ocr", data: row() },
    ]);
    const result = await requestScanReading(fake.db, args);
    expect(result).toMatchObject({ ok: true, data: { status: "processing" } });
    expect(fake.calls[1].payload).toMatchObject({ version_id: "v1", source_revision: "r1", status: "processing", requested_by: "u1", provider: "landingai" });
    const queued = mocks.enqueue.mock.calls[0][1];
    expect(queued).toMatchObject({ kind: "document.ocr", dedupeKey: "document.ocr:v1:r1", maxAttempts: 2 });
    expect(JSON.stringify(queued)).not.toContain("synthetic-key");
    fake.done();
  });
  it("does not queue twice while one is running", async () => {
    const fake = scriptedDb([{ table: "document_version_ocr", data: row() }, { table: "document_version_ocr", data: row() }]);
    expect(await requestScanReading(fake.db, args)).toMatchObject({ ok: true });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("reading again keeps the previous reading until the new one finishes", async () => {
    const previous = row({ status: "ready", pages: [{ page: 2, text: "viejo" }], credits: 1, page_count: 10, failed_pages: [5] });
    const fake = scriptedDb([
      { table: "document_version_ocr", data: previous },
      { table: "document_version_ocr", op: "update" },
      { table: "document_version_ocr", data: row({ ...previous, status: "processing" }) },
    ]);
    expect(await requestScanReading(fake.db, args)).toMatchObject({ ok: true, data: { status: "processing" } });
    expect(fake.calls[1].payload).toMatchObject({ status: "processing", error_code: null });
    expect(fake.calls[1].payload).not.toHaveProperty("pages");
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    fake.done();
  });
  it("does not leave the version processing when the job cannot be queued", async () => {
    mocks.enqueue.mockRejectedValue(new Error("queue down"));
    const fake = scriptedDb([
      { table: "document_version_ocr", data: null },
      { table: "document_version_ocr", op: "upsert" },
      { table: "document_version_ocr", op: "update", data: [{ version_id: "v1" }] },
    ]);
    expect(await requestScanReading(fake.db, args)).toMatchObject({ ok: false });
    expect(fake.calls[2].payload).toMatchObject({ status: "failed", error_code: "ocr_unavailable" });
    expect(fake.calls[2].filters).toContainEqual(["eq", "status", "processing"]);
    fake.done();
  });
  it.each([
    ["needs edit rights", () => mocks.access.mockResolvedValue({ ...allowed, projectRole: "viewer" }), "forbidden", undefined],
    ["is refused for a version held for training", () => mocks.released.mockResolvedValue({ ok: false, kind: "conflict", detail: "held", code: "training_approval_required" }), "conflict", "training_approval_required"],
    ["needs a scanned PDF", () => mocks.active.mockResolvedValue({ ...scanned, textless_page_count: 0 }), "validation", "ocr_not_supported"],
    ["caps the size", () => mocks.active.mockResolvedValue({ ...scanned, size_bytes: 60 * 1024 * 1024 }), "validation", "ocr_too_large"],
    ["needs a key", () => mocks.key.mockResolvedValue(null), "conflict", "ocr_key_missing"],
  ])("%s", async (_name, arrange, kind, code) => {
    arrange();
    const result = await requestScanReading(scriptedDb([]).db, args);
    expect(result).toMatchObject({ ok: false, kind, ...(code ? { code } : {}) });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("reading on upload", () => {
  const upload = { documentId: "d1", versionId: "v1", userId: "u1", userEmail: undefined };
  const steps = () => [
    { table: "documents", data: { id: "d1", org_id: null } },
    { table: "document_version_ocr", data: null },
    { table: "document_version_ocr", op: "upsert" },
  ];
  it("starts by itself for 50 pages or fewer when a key is available", async () => {
    mocks.active.mockResolvedValue({ ...scanned, page_count: 50 });
    const fake = scriptedDb(steps());
    await queueScanReadingOnUpload(fake.db, upload);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    fake.done();
  });
  it.each([
    ["over 50 pages", () => mocks.active.mockResolvedValue({ ...scanned, page_count: 51 })],
    ["with text", () => mocks.active.mockResolvedValue({ ...scanned, textless_page_count: 0 })],
    ["without a key", () => mocks.key.mockResolvedValue(null)],
    ["held for training", () => mocks.released.mockResolvedValue({ ok: false, kind: "conflict", detail: "x" })],
  ])("does nothing %s", async (_name, arrange) => {
    arrange();
    const fake = scriptedDb([{ table: "documents", data: { id: "d1", org_id: null } }]);
    await queueScanReadingOnUpload(fake.db, upload);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("never fails the upload", async () => {
    mocks.active.mockRejectedValue(new Error("db down"));
    await expect(queueScanReadingOnUpload(scriptedDb([]).db, upload)).resolves.toBeUndefined();
  });
});

describe("the job", () => {
  const versionRow = { id: "v1", document_id: "d1", storage_path: "p", file_type: "pdf", content_sha256: null, text_revision: "r1" };
  const read = { pages: [{ page: 1, text: "# Hola" }], pageCount: 3, failedPages: [2], credits: 1.5, model: "dpt-3-pro-20260710" };
  const head = () => [
    { table: "document_versions", data: versionRow },
    { table: "documents", data: { id: "d1", org_id: "o1", archived_at: null } },
  ];
  it("reads, saves the reading with its provenance, then merges it into the text and clears the warning", async () => {
    mocks.parse.mockResolvedValue(read);
    mocks.publish.mockResolvedValue({ textlessPageCount: 1 });
    const fake = scriptedDb([
      ...head(),
      { table: "document_version_ocr", data: row() },
      { table: "document_version_ocr", op: "update", data: [{ version_id: "v1" }] },
      { table: "document_versions", op: "update" },
    ]);
    await handleDocumentOcr(fake.db, job);
    expect(mocks.assertStamp).toHaveBeenCalledWith(fake.db, "o1", { orgId: "o1", epoch: 3 });
    expect(mocks.extract).toHaveBeenCalledWith("pdfTextlessPages", expect.anything(), { fileType: "pdf" });
    // Only the scanned pages are sent.
    expect(mocks.parse).toHaveBeenCalledWith("synthetic-key", expect.anything(), { pages: [2, 5, 9] });
    expect(fake.calls[3].payload).toMatchObject({ status: "ready", pages: [{ page: 1, text: "# Hola" }], credits: 1.5, page_count: 3, failed_pages: [2], model: "dpt-3-pro-20260710" });
    expect(fake.calls[4].payload).toEqual({ textless_page_count: 1 });
    fake.done();
  });
  it("sends a PDF scanned throughout whole, without a page selection", async () => {
    mocks.extract.mockResolvedValue({ pages: [1, 2, 3], total: 3 });
    mocks.parse.mockResolvedValue(read);
    const fake = scriptedDb([...head(), { table: "document_version_ocr", data: row() }, { table: "document_version_ocr", op: "update", data: [{ version_id: "v1" }] }, { table: "document_versions", op: "update" }]);
    await handleDocumentOcr(fake.db, job);
    expect(mocks.parse).toHaveBeenCalledWith("synthetic-key", expect.anything(), {});
  });
  it("does not call LandingAI when no page lacks text", async () => {
    mocks.extract.mockResolvedValue({ pages: [], total: 3 });
    const fake = scriptedDb([...head(), { table: "document_version_ocr", data: row() }, { table: "document_version_ocr", op: "update", data: [{ version_id: "v1" }] }]);
    await handleDocumentOcr(fake.db, job);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(fake.calls[3].payload).toMatchObject({ status: "failed", error_code: "ocr_not_supported" });
  });
  it("on a retry after the reading was saved, only merges: it never pays twice", async () => {
    const fake = scriptedDb([...head(), { table: "document_version_ocr", data: row({ status: "ready", pages: [{ page: 1, text: "x" }] }) }, { table: "document_versions", op: "update" }]);
    await handleDocumentOcr(fake.db, job);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalled();
    fake.done();
  });
  it.each(["ocr_key_invalid", "ocr_no_credits", "ocr_too_large", "ocr_not_supported"] as const)("fails %s for good without retrying", async (code) => {
    mocks.parse.mockRejectedValue(new OcrError(code));
    const fake = scriptedDb([...head(), { table: "document_version_ocr", data: row() }, { table: "document_version_ocr", op: "update", data: [{ version_id: "v1" }] }]);
    await expect(handleDocumentOcr(fake.db, job)).resolves.toBeUndefined();
    expect(fake.calls[3].payload).toMatchObject({ status: "failed", error_code: code });
    expect(mocks.publish).not.toHaveBeenCalled();
    fake.done();
  });
  it("lets the queue retry when LandingAI is unavailable", async () => {
    mocks.parse.mockRejectedValue(new OcrError("ocr_unavailable"));
    const fake = scriptedDb([...head(), { table: "document_version_ocr", data: row() }]);
    await expect(handleDocumentOcr(fake.db, job)).rejects.toThrow("ocr_unavailable");
    const done = scriptedDb([{ table: "document_version_ocr", op: "update" }]);
    await markDocumentOcrFailed(done.db, job);
    expect(done.calls[0].payload).toMatchObject({ status: "failed", error_code: "ocr_unavailable" });
  });
  it("fails without a key and when the requester lost edit rights or the epoch moved", async () => {
    mocks.key.mockResolvedValue(null);
    let fake = scriptedDb([...head(), { table: "document_version_ocr", data: row() }, { table: "document_version_ocr", op: "update", data: [{}] }]);
    await handleDocumentOcr(fake.db, job);
    expect(fake.calls[3].payload).toMatchObject({ status: "failed", error_code: "ocr_key_missing" });
    expect(mocks.parse).not.toHaveBeenCalled();

    mocks.access.mockResolvedValue({ ...allowed, projectRole: "viewer" });
    await expect(handleDocumentOcr(scriptedDb(head()).db, job)).rejects.toThrow("ocr_forbidden");
    mocks.assertStamp.mockRejectedValue(new Error("stale_authorization_epoch"));
    await expect(handleDocumentOcr(scriptedDb(head()).db, job)).rejects.toThrow("stale_authorization_epoch");
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("does nothing for a version that was replaced or deleted", async () => {
    const fake = scriptedDb([{ table: "document_versions", data: null }]);
    await handleDocumentOcr(fake.db, job);
    expect(mocks.key).not.toHaveBeenCalled();
    await handleDocumentOcr(scriptedDb([]).db, { ...job, payload: {} } as DbJob);
  });
});
