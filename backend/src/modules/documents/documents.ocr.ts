// Scan reading (layer 6, docs/document-ocr.md): a PDF with pages that have no
// text layer is read with the owner's own LandingAI key, in the background, and
// the reading is merged into the text the assistant, the search and the
// Markdown conversion already use.
import { assertAuthorizationStamp, readAuthorizationStamp } from "../../lib/authorizationEpoch";
import { enqueueDbJob } from "../../lib/dbq/enqueue";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import { DbJobDeferredError, type DbJob } from "../../lib/dbq/types";
import { loadActiveVersion, type ActiveVersion } from "../../lib/documentVersions";
import { ExtractionBusyError, withBackgroundExtraction } from "../../lib/extraction/isolated";
import { resolveScanKey } from "../../lib/ocr/key";
import { OcrError, parsePdfWithLandingAi, LANDINGAI_MODEL, type OcrErrorCode } from "../../lib/ocr/landingai";
import { OCR_AUTO_MAX_PAGES, OCR_MAX_BYTES, estimateOcrCostUsd } from "../../lib/ocr/pages";
import { reportError, setOperation } from "../../lib/observability/report";
import { can, DOCUMENT_EDIT_FORBIDDEN } from "../../lib/permissions";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { downloadFile } from "../../lib/storage";
import { assertVersionReleasable } from "../../lib/trainingRelease";
import { ensureDocumentAccess } from "./documents.access";
import { extractAndPublishText } from "./documents.indexing";
import { loadScanRow, type ScanRow } from "./documents.ocr.state";
import type { Db } from "./documents.shared";

export const OCR_KEY_MISSING_CODE = "ocr_key_missing";
export const OCR_NOT_SUPPORTED_CODE: OcrErrorCode = "ocr_not_supported";
export const OCR_TOO_LARGE_CODE: OcrErrorCode = "ocr_too_large";
export const DOCUMENT_OCR_JOB = "document.ocr";
/** A retry after a timeout can bill the same pages twice, so one is all a job gets. */
const OCR_MAX_ATTEMPTS = 2;

export type ScanReadingStatus = "none" | "processing" | "ready" | "failed";

export type ScanReadingState = {
  /** A PDF that a reading could apply to at all. */
  applicable: boolean;
  status: ScanReadingStatus;
  /** An OcrErrorCode (or ocr_key_missing) when status is failed. */
  error_code: string | null;
  /** A key is saved and on for this person in this document's context. */
  key_available: boolean;
  can_edit: boolean;
  /** Pages without text remain unread and no reading is running. */
  needs_reading: boolean;
  page_count: number | null;
  textless_page_count: number | null;
  /** Up to this many pages a reading starts by itself on upload. */
  auto_max_pages: number;
  estimated_cost_usd: number | null;
  /** What the last finished reading cost, in LandingAI credits. */
  credits: number | null;
};

type Target = {
  doc: { id: string; org_id: string | null };
  version: ActiveVersion;
  canEdit: boolean;
};

async function openTarget(
  db: Db,
  args: { documentId: string; userId: string; userEmail: string | undefined },
): Promise<ServiceResult<Target>> {
  const access = await ensureDocumentAccess(args.documentId, args.userId, args.userEmail, db, {
    select: "id, user_id, project_id, org_id, workflow_id, current_version_id, archived_at",
  });
  if (!access.ok) {
    if (access.kind === "error") return internalFailure(access.error);
    return failure("not_found", "Document not found");
  }
  const version = await loadActiveVersion(args.documentId, db);
  if (!version) return failure("not_found", "No file available");
  return ok({
    doc: { id: access.doc.id, org_id: access.doc.org_id ?? null },
    version,
    canEdit: can(access.projectRole, "content.edit"),
  });
}

const isScannedPdf = (version: ActiveVersion) =>
  (version.file_type ?? "").toLowerCase() === "pdf" && (version.textless_page_count ?? 0) > 0;

async function describeState(db: Db, userId: string, target: Target): Promise<ScanReadingState> {
  const { version } = target;
  const isPdf = (version.file_type ?? "").toLowerCase() === "pdf";
  const row = isPdf ? await loadScanRow(db, version.id) : null;
  const current = row && row.source_revision === version.text_revision ? row : null;
  const status: ScanReadingStatus = current ? current.status : "none";
  const keyAvailable = isPdf ? (await resolveScanKey(db, userId, target.doc.org_id)) !== null : false;
  const textless = version.textless_page_count ?? null;
  const pages = version.page_count ?? null;
  const credits = current?.credits === null || current?.credits === undefined ? null : Number(current.credits);
  return {
    applicable: isPdf,
    status,
    error_code: current?.status === "failed" ? current.error_code : null,
    key_available: keyAvailable,
    can_edit: target.canEdit,
    needs_reading: isPdf && (textless ?? 0) > 0 && status !== "processing",
    page_count: pages,
    textless_page_count: textless,
    auto_max_pages: OCR_AUTO_MAX_PAGES,
    // Only the pages without a text layer are sent and billed. After a partial reading
    // `textless` counts just the pages still unread, but reading again sends every scanned
    // page of the file again: the ones already read plus the ones still unread.
    estimated_cost_usd: textless ? estimateOcrCostUsd(textless + (current?.pages?.length ?? 0)) : null,
    credits: credits !== null && Number.isFinite(credits) ? credits : null,
  };
}

export async function getScanReadingState(
  db: Db,
  args: { documentId: string; userId: string; userEmail: string | undefined },
): Promise<ServiceResult<ScanReadingState>> {
  try {
    const opened = await openTarget(db, args);
    if (!opened.ok) return opened;
    return ok(await describeState(db, args.userId, opened.data));
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * Mark the version as being read and queue the job. Key and permission were
 * already checked. A reading already saved for these same bytes stays in
 * place (and in force) until the new one finishes; if the job cannot be
 * queued the row is failed, never left "processing" with nothing to run.
 */
async function queueReading(
  db: Db,
  target: Target,
  actor: { userId: string; userEmail: string | undefined },
  previous: ScanRow | null,
): Promise<void> {
  const { version, doc } = target;
  const revision = version.text_revision;
  if (!revision) throw new Error("document_version_without_revision");
  const now = new Date().toISOString();
  if (previous?.source_revision === revision) {
    const { error } = await db.from("document_version_ocr")
      .update({ status: "processing", error_code: null, requested_by: actor.userId, updated_at: now })
      .eq("version_id", version.id).eq("source_revision", revision);
    if (error) throw error;
  } else {
    const { error } = await db.from("document_version_ocr").upsert({
      version_id: version.id,
      source_revision: revision,
      provider: "landingai",
      status: "processing",
      pages: null,
      model: null,
      credits: null,
      page_count: null,
      failed_pages: [],
      error_code: null,
      requested_by: actor.userId,
      updated_at: now,
    }, { onConflict: "version_id" });
    if (error) throw error;
  }
  try {
    await enqueueDbJob(db, {
      kind: DOCUMENT_OCR_JOB,
      // No key and no document content: the job resolves the key again when it runs.
      payload: {
        documentId: doc.id,
        versionId: version.id,
        revision,
        userId: actor.userId,
        userEmail: actor.userEmail ?? null,
        authorization: await readAuthorizationStamp(db, doc.org_id),
      },
      dedupeKey: `document.ocr:${version.id}:${revision}`,
      maxAttempts: OCR_MAX_ATTEMPTS,
    });
  } catch (error) {
    await finishRow(db, version.id, revision, { status: "failed", error_code: "ocr_unavailable" }).catch(() => false);
    throw error;
  }
}

/** POST: a person asks for the reading, usually after seeing the estimated cost. */
export async function requestScanReading(
  db: Db,
  args: { documentId: string; userId: string; userEmail: string | undefined },
): Promise<ServiceResult<ScanReadingState>> {
  try {
    const opened = await openTarget(db, args);
    if (!opened.ok) return opened;
    const target = opened.data;
    if (!target.canEdit) return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);
    // A version held for training is not sent anywhere until it is approved.
    const releasable = await assertVersionReleasable(db, target.version);
    if (!releasable.ok) return releasable;
    if (!isScannedPdf(target.version))
      return failure("validation", "This document has no scanned pages to read.", OCR_NOT_SUPPORTED_CODE);
    if ((target.version.size_bytes ?? 0) > OCR_MAX_BYTES)
      return failure("validation", "The document is too large to read.", OCR_TOO_LARGE_CODE);
    if ((await resolveScanKey(db, args.userId, target.doc.org_id)) === null)
      return failure(
        "conflict",
        "Add a LandingAI key in Settings to read scanned documents.",
        OCR_KEY_MISSING_CODE,
      );
    const current = await loadScanRow(db, target.version.id);
    const running = current?.status === "processing" && current.source_revision === target.version.text_revision;
    if (!running) await queueReading(db, target, args, current);
    return ok(await describeState(db, args.userId, target));
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * After an upload: read the scan by itself when a key is available and the
 * PDF is short enough. Never throws and never blocks the upload; whatever it
 * skips stays a button the person can press.
 */
export async function queueScanReadingOnUpload(
  db: Db,
  args: { documentId: string; versionId: string; userId: string; userEmail: string | undefined },
): Promise<void> {
  try {
    const version = await loadActiveVersion(args.documentId, db, args.versionId);
    if (!version || !isScannedPdf(version)) return;
    const pages = version.page_count ?? 0;
    if (pages < 1 || pages > OCR_AUTO_MAX_PAGES || (version.size_bytes ?? 0) > OCR_MAX_BYTES) return;
    const { data: doc, error } = await db.from("documents").select("id, org_id").eq("id", args.documentId).maybeSingle();
    if (error || !doc) return;
    const releasable = await assertVersionReleasable(db, version);
    if (!releasable.ok) return;
    const orgId = (doc as { org_id: string | null }).org_id ?? null;
    if ((await resolveScanKey(db, args.userId, orgId)) === null) return;
    await queueReading(db, { doc: { id: args.documentId, org_id: orgId }, version, canEdit: true }, args, await loadScanRow(db, version.id));
  } catch (error) {
    reportError(error, { level: "warning", tags: { component: "documents", stage: "ocr-queue" } });
  }
}

// --- the job ----------------------------------------------------------------

async function finishRow(db: Db, versionId: string, revision: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db.from("document_version_ocr")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("version_id", versionId).eq("source_revision", revision).eq("status", "processing")
    .select("version_id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function handleDocumentOcr(db: Db, job: DbJob): Promise<void> {
  setOperation("documents.ocr");
  const { documentId, versionId, revision, userId } = job.payload;
  if (typeof documentId !== "string" || typeof versionId !== "string" || typeof revision !== "string" || typeof userId !== "string")
    return;
  const userEmail = typeof job.payload.userEmail === "string" ? job.payload.userEmail : undefined;

  const { data: version, error } = await db.from("document_versions")
    .select("id,document_id,storage_path,file_type,content_sha256,size_bytes,training_stage,text_revision")
    .eq("id", versionId).eq("document_id", documentId).eq("text_revision", revision).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!version?.storage_path) return; // replaced or deleted while queued: nothing to read

  // Same standing as the request had, checked again now. An organization's
  // membership changes advance its epoch; a project share is read live.
  const { data: doc, error: docError } = await db.from("documents").select("id,org_id,archived_at").eq("id", documentId).maybeSingle();
  if (docError) throw docError;
  if (!doc || (doc as { archived_at: string | null }).archived_at) return;
  const orgId = (doc as { org_id: string | null }).org_id ?? null;
  await assertAuthorizationStamp(db, orgId, job.payload.authorization);
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok || !can(access.projectRole, "content.edit")) throw new NonRetryableJobError("ocr_forbidden");
  const releasable = await assertVersionReleasable(db, version as never);
  if (!releasable.ok) throw new NonRetryableJobError("ocr_held_for_training");

  const existing = await loadScanRow(db, versionId);
  if (!existing || existing.source_revision !== revision) return;
  // A retry after the reading was saved only has the merge left: never pay twice.
  if (existing.status !== "ready") {
    const key = await resolveScanKey(db, userId, orgId);
    if (key === null) {
      await finishRow(db, versionId, revision, { status: "failed", error_code: OCR_KEY_MISSING_CODE });
      return;
    }
    const raw = await downloadFile(version.storage_path);
    if (!raw) throw new Error("ocr_source_unavailable");
    // Only the pages without a text layer are sent (and billed); a PDF that
    // is scanned throughout goes whole, without the page selection.
    const scanned = await scannedPages(raw);
    if (scanned.pages.length === 0) {
      await finishRow(db, versionId, revision, { status: "failed", error_code: OCR_NOT_SUPPORTED_CODE });
      return;
    }
    try {
      const result = await parsePdfWithLandingAi(key, raw, scanned.pages.length < scanned.total ? { pages: scanned.pages } : {});
      const saved = await finishRow(db, versionId, revision, {
        status: "ready",
        pages: result.pages.map((p) => ({ page: p.page, text: p.text.replaceAll("\0", "") })),
        model: result.model || LANDINGAI_MODEL,
        credits: result.credits,
        page_count: result.pageCount || null,
        failed_pages: result.failedPages,
        error_code: null,
      });
      if (!saved) return; // superseded by a newer request
    } catch (error) {
      if (error instanceof OcrError && !error.retryable) {
        await finishRow(db, versionId, revision, { status: "failed", error_code: error.code });
        return;
      }
      throw error instanceof OcrError ? new Error(error.code) : error;
    }
  }
  await publishReading(db, { versionId, revision, storage_path: version.storage_path, content_sha256: version.content_sha256 ?? null });
}

async function scannedPages(raw: ArrayBuffer): Promise<{ pages: number[]; total: number }> {
  try {
    return await withBackgroundExtraction({ waitMs: 60_000 }, (extract) => extract("pdfTextlessPages", raw, { fileType: "pdf" }));
  } catch (error) {
    if (error instanceof ExtractionBusyError)
      throw new DbJobDeferredError(new Date(Date.now() + 30_000).toISOString(), "document_extraction_busy");
    throw error;
  }
}

/** Merge the saved reading into the version's text and clear the scanned-page warning for what it read. */
export async function publishReading(
  db: Db,
  version: { versionId: string; revision: string; storage_path: string; content_sha256: string | null },
): Promise<void> {
  try {
    await withBackgroundExtraction({ waitMs: 60_000 }, async (extract) => {
      const outcome = await extractAndPublishText(db, { ...version, fileType: "pdf" }, extract);
      if (outcome === "too_large") return;
      const { error } = await db.from("document_versions")
        .update({ textless_page_count: outcome.textlessPageCount })
        .eq("id", version.versionId).eq("text_revision", version.revision).is("deleted_at", null);
      if (error) throw error;
    });
  } catch (error) {
    if (error instanceof ExtractionBusyError)
      throw new DbJobDeferredError(new Date(Date.now() + 30_000).toISOString(), "document_extraction_busy");
    throw error;
  }
}

/** The job ran out of attempts: say so on the version, so the person sees an error and can retry. */
export async function markDocumentOcrFailed(db: Db, job: DbJob): Promise<void> {
  const { versionId, revision } = job.payload;
  if (typeof versionId !== "string" || typeof revision !== "string") return;
  await finishRow(db, versionId, revision, { status: "failed", error_code: "ocr_unavailable" });
}
