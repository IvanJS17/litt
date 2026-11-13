// Scan reading state in document_version_ocr (docs/document-ocr.md). Server
// only: the table is closed to every client role, like document_version_texts.
import type { OcrFill, OcrPage } from "../../lib/ocr/pages";
import type { Db } from "./documents.shared";

export type ScanRow = {
  version_id: string;
  source_revision: string;
  status: "processing" | "ready" | "failed";
  pages: OcrPage[] | null;
  failed_pages: number[] | null;
  credits: number | string | null;
  page_count: number | null;
  error_code: string | null;
  model?: string | null;
};

export async function loadScanRow(db: Db, versionId: string): Promise<ScanRow | null> {
  const { data, error } = await db.from("document_version_ocr")
    .select("version_id,source_revision,status,pages,failed_pages,credits,page_count,error_code,model")
    .eq("version_id", versionId).maybeSingle();
  if (error) throw error;
  return (data as ScanRow | null) ?? null;
}

/**
 * The saved reading of exactly this version and byte revision, or null. It is
 * merged into the PDF's own text whenever that is extracted, and it stays
 * after the key that paid for it is removed or turned off. A new reading in
 * progress, or one that failed, does not take the previous one out of force.
 */
export async function loadReadScan(db: Db, versionId: string, revision: string): Promise<OcrFill | null> {
  const row = await loadScanRow(db, versionId);
  if (!row || row.source_revision !== revision || row.pages === null) return null;
  return { pages: row.pages, failedPages: row.failed_pages ?? [] };
}

/**
 * Give a version made by splitting another the reading of its pages (layer 7,
 * docs/document-split.md). `from` is the reading of the source version and
 * `sourcePages` the source page numbers the new version holds, in its order:
 * page N of the new file takes the text read for `sourcePages[N-1]`. The copy
 * costs nothing (credits 0): LandingAI is not called again. Nothing is written
 * when none of those pages was read. Returns whether a row was written.
 */
export async function copyReadingToSplitVersion(
  db: Db,
  args: { from: ScanRow; sourcePages: readonly number[]; versionId: string; userId: string },
): Promise<boolean> {
  const read = new Map((args.from.pages ?? []).map((entry) => [entry.page, entry.text]));
  const failed = new Set(args.from.failed_pages ?? []);
  const pages: OcrPage[] = [];
  const failedPages: number[] = [];
  args.sourcePages.forEach((source, index) => {
    const text = read.get(source);
    if (text !== undefined) pages.push({ page: index + 1, text });
    if (failed.has(source)) failedPages.push(index + 1);
  });
  if (pages.length === 0) return false;
  const { data, error } = await db.from("document_versions").select("text_revision").eq("id", args.versionId).maybeSingle();
  if (error) throw error;
  const revision = (data as { text_revision?: string } | null)?.text_revision;
  if (!revision) throw new Error("split_version_without_revision");
  const now = new Date().toISOString();
  const { error: insertError } = await db.from("document_version_ocr").upsert({
    version_id: args.versionId,
    source_revision: revision,
    provider: "landingai",
    status: "ready",
    pages,
    model: args.from.model ?? null,
    credits: 0,
    page_count: args.sourcePages.length,
    failed_pages: failedPages,
    error_code: null,
    requested_by: args.userId,
    updated_at: now,
  }, { onConflict: "version_id" });
  if (insertError) throw insertError;
  return true;
}
