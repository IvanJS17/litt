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
};

export async function loadScanRow(db: Db, versionId: string): Promise<ScanRow | null> {
  const { data, error } = await db.from("document_version_ocr")
    .select("version_id,source_revision,status,pages,failed_pages,credits,page_count,error_code")
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
