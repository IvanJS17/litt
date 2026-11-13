import { createHash } from "node:crypto";
import { downloadFile } from "../../lib/storage";
import { EXTRACTION_MAX_BYTES, ExtractionLimitError, ExtractionBusyError, ExtractionParseError, withBackgroundExtraction } from "../../lib/extraction/isolated";
import { DbJobDeferredError, type Db, type DbJob } from "../../lib/dbq/types";
import { NonRetryableJobError } from "../../lib/dbq/runner";
import { AppError } from "../../lib/appError";
import type { ExtractInSlot } from "../../lib/extraction/isolated";
import { loadReadScan } from "./documents.ocr.state";
import { reportError, setOperation } from "../../lib/observability/report";

export { extractDocumentText } from "../../lib/extraction/documentText";

/** Extract and publish only while the queued version revision still matches. */
export async function handleDocumentExtractText(db: Db, job: DbJob): Promise<void> {
  setOperation("documents.extract");
  const { versionId, revision } = job.payload;
  if (typeof versionId !== "string" || typeof revision !== "string") return;
  try {
    await withBackgroundExtraction({ waitMs: job.status === "running" ? 60_000 : undefined }, async (extract) => {
      const { data: version, error } = await db.from("document_versions")
        .select("id,storage_path,file_type,filename,content_sha256,text_revision,size_bytes")
        .eq("id", versionId).eq("text_revision", revision).is("deleted_at", null).maybeSingle();
      if (error) throw error;
      if (!version?.storage_path) return; // superseded/deleted work is a successful no-op
      const fileType = version.file_type || version.filename?.split(".").pop() || "";
      // Retrying cannot shrink the file, so too large is final, not a retry.
      if ((version.size_bytes ?? 0) > EXTRACTION_MAX_BYTES) {
        await markDocumentTextFailed(db, job, "too_large");
        return;
      }
      const { data: claim, error: claimError } = await db.from("document_version_texts")
        .update({ status: "processing", error_code: null, updated_at: new Date().toISOString() })
        .eq("version_id", versionId).eq("source_revision", revision)
        .in("status", ["pending", "processing", "failed"]).select("version_id").maybeSingle();
      if (claimError) throw claimError;
      if (!claim) return; // already published, replaced, or deleted
      const outcome = await extractAndPublishText(db, { ...version, versionId, revision, fileType }, extract);
      if (outcome === "too_large") await markDocumentTextFailed(db, job, "too_large");
    });
  } catch (error) {
    if (error instanceof ExtractionBusyError) {
      // Existing DB-queue deferral refunds the claim attempt and preserves its fence.
      throw new DbJobDeferredError(new Date(Date.now() + 30_000).toISOString(), "document_extraction_busy");
    }
    throw error;
  }
}

type PublishableVersion = {
  versionId: string; revision: string; fileType: string;
  storage_path: string; content_sha256: string | null;
};

/**
 * Read the stored file, extract its text and publish it for `revision`. A scan
 * reading saved for this exact revision is merged into a PDF's own text (the
 * pages with no text layer take the reading), which is how the assistant, the
 * search and the Markdown conversion all see it. Shared by the extraction job
 * and by the scan-reading job, so both produce identical text.
 */
export async function extractAndPublishText(
  db: Db, version: PublishableVersion, extract: ExtractInSlot,
): Promise<{ textlessPageCount: number | null } | "too_large"> {
  const { versionId, revision, fileType } = version;
  const raw = await downloadFile(version.storage_path);
  if (!raw) throw new Error("document_text_source_unavailable");
  const hash = createHash("sha256").update(Buffer.from(raw)).digest("hex");
  if (version.content_sha256 && version.content_sha256 !== hash) throw new Error("document_text_source_changed");
  const isPdf = fileType.toLowerCase() === "pdf";
  // The scan reading can be saved while this runs (the upload's extraction and
  // the reading's own publish race). So after publishing, read it again: if it
  // changed, extract and publish once more, which makes the last write the one
  // that includes it.
  let ocr = isPdf ? await loadReadScan(db, versionId, revision) : null;
  for (let attempt = 0; ; attempt++) {
    let extracted: { text: string; textlessPageCount: number | null };
    try {
      extracted = await extract("documentText", raw, ocr ? { fileType, ocr } : { fileType });
    } catch (err) {
      // The source hash matched, so the parser saw the same bytes it will
      // see on every retry: an unreadable file fails once, not three times.
      // The runner's failure hook marks the text failed.
      if (err instanceof ExtractionParseError) throw new NonRetryableJobError("document_text_unreadable", { cause: err, reportLevel: "warning" });
      if (!(err instanceof ExtractionLimitError)) throw err;
      return "too_large";
    }
    const { text, textlessPageCount } = extracted;
    const { error: publishError } = await db.rpc("publish_document_text", {
      p_version_id: versionId, p_revision: revision,
      // PostgreSQL text cannot contain NUL; do not truncate otherwise.
      p_text: text.replaceAll("\0", ""), p_sha256: hash, p_textless_pages: textlessPageCount,
    });
    if (publishError) throw publishError;
    if (!isPdf) return { textlessPageCount };
    const latest = await loadReadScan(db, versionId, revision);
    if (attempt >= 2 || JSON.stringify(latest) === JSON.stringify(ocr)) return { textlessPageCount };
    ocr = latest;
  }
}

/** Mark exhausted work failed without overwriting a newer revision or ready text. */
export async function markDocumentTextFailed(db: Db, job: DbJob, errorCode = "extraction_failed"): Promise<void> {
  const { versionId, revision } = job.payload;
  if (typeof versionId !== "string" || typeof revision !== "string") return;
  const { error } = await db.from("document_version_texts")
    .update({ status: "failed", text_content: null, error_code: errorCode, updated_at: new Date().toISOString() })
    .eq("version_id", versionId).eq("source_revision", revision).in("status", ["pending", "processing", "failed"]);
  if (error) throw error;
}

/** Escape-hatch deployments still process durable text work without a runner. */
export async function processDocumentTextInline(db: Db, versionIds?: string[]) {
  if (process.env.DB_JOBS_ENABLED !== "false") return;
  let query = db.from("db_jobs").select("*").eq("kind", "document.extract_text").eq("status", "pending");
  if (versionIds?.length) query = query.in("payload->>versionId", versionIds);
  const { data, error } = await query.order("created_at").limit(versionIds?.length ?? 5);
  if (error) throw error;
  for (const job of (data ?? []) as DbJob[]) {
    try {
      await handleDocumentExtractText(db, job);
      const { error: doneError } = await db.from("db_jobs").update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "pending");
      if (doneError) throw doneError;
    } catch (err) {
      await markDocumentTextFailed(db, job);
      const { error: failedError } = await db.from("db_jobs").update({ status: "failed", last_error: "extraction_failed", finished_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "pending");
      if (failedError) throw failedError;
      // No runner reports this path: name the job and the kind here, keep the
      // real error as the cause (its code reaches failure_code), and log the
      // same object so the console bridge files no second event.
      const failure = err instanceof AppError
        ? err
        : new AppError("extraction.failed", "document text extraction failed", { cause: err });
      reportError(failure, {
        tags: { job_kind: "document.extract_text" },
        extra: { job_id: job.id },
      });
      console.error("[document-text-inline] extraction failed", failure);
    }
  }
}

/** Queue a bounded, resumable batch of missing text, optionally retrying failures. */
export async function backfillDocumentText(db: Db, options: { limit?: number; retryFailed?: boolean } = {}) {
  const { data, error } = await db.rpc("backfill_document_text", {
    p_limit: options.limit ?? 100, p_retry_failed: options.retryFailed ?? false,
  });
  if (error) throw error;
  await processDocumentTextInline(db);
  return Number(data ?? 0);
}
