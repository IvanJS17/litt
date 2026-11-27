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

/** A reading's state as shown to a person: the row without the text of its pages, and how many pages were read. */
export type ScanState = Omit<ScanRow, "pages"> & { pages_read: number | null; updated_at: string };

/**
 * The state of the reading of this version, without the text that was read (the database answers with the
 * count of pages read). Use it for everything that only needs the state; loadScanRow is for the callers
 * that need the text.
 */
export async function loadScanState(db: Db, versionId: string): Promise<ScanState | null> {
  const { data, error } = await db.rpc("document_ocr_state", { p_version_id: versionId });
  if (error) throw error;
  return (data as ScanState | null) ?? null;
}

type PagesSlice = { source_revision: string; updated_at: string; pages: OcrPage[] | null; next: number | null };

/**
 * The pages read from a scan, put together from the database's bounded slices (whole pages up to a character
 * budget per answer): no answer carries all the text. Every slice must be of the same reading (same revision and
 * stamp); if a new reading replaces the row between two slices, the read starts again, and fails after three
 * tries rather than hand out a mix of two readings. This is the only way the text of a reading is read.
 */
async function readReadingPages(db: Db, versionId: string): Promise<{ source_revision: string; updated_at: string; pages: OcrPage[] | null } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let first: PagesSlice | null = null;
    const pages: OcrPage[] = [];
    let from = 0;
    let changed = false;
    for (;;) {
      const { data, error } = await db.rpc("document_ocr_pages", { p_version_id: versionId, p_from: from });
      if (error) throw error;
      const slice = data as PagesSlice | null;
      if (first === null && slice === null) return null;
      if (slice === null || (first !== null && (slice.source_revision !== first.source_revision || slice.updated_at !== first.updated_at))) { changed = true; break; }
      first ??= slice;
      if (slice.pages === null) return { source_revision: slice.source_revision, updated_at: slice.updated_at, pages: null };
      pages.push(...slice.pages);
      if (slice.next === null) return { source_revision: slice.source_revision, updated_at: slice.updated_at, pages };
      from = slice.next;
    }
    if (changed) continue;
  }
  throw new Error("The scan reading changed while it was being read");
}

/** The reading's state with its pages (read in slices): for the callers that need the text that was read. */
export async function loadScanRow(db: Db, versionId: string): Promise<ScanRow | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await readReadingPages(db, versionId);
    const state = read ? await loadScanState(db, versionId) : null;
    if (!read || !state) return null;
    // the pages and the state must be of one reading: the same revision AND the same stamp
    if (state.source_revision !== read.source_revision || state.updated_at !== read.updated_at) continue;
    const { pages_read: _count, updated_at: _stamp, ...row } = state;
    return { ...row, pages: read.pages };
  }
  throw new Error("The scan reading changed while it was being read");
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
