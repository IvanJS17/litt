type Row = Record<string, unknown>;

/** The most characters of page text one answer of `document_ocr_pages` carries before it stops adding whole pages. */
export const OCR_SLICE_CHARS = 500_000;

/** `document_ocr_state` for a stored reading: its columns and how many pages were read, never their text. */
export function ocrStateOf(row: Row | undefined | null): Row | null {
  if (!row) return null;
  const { pages, provider: _provider, requested_by: _by, created_at: _created, updated_at: _updated, ...state } = row;
  return { ...state, pages_read: Array.isArray(pages) ? pages.length : null };
}

/** `document_ocr_pages`, as the database function answers: whole pages from `from` up to the character budget. */
export function ocrPagesOf(row: Row | undefined | null, from: number): Row | null {
  if (!row) return null;
  const stamp = { source_revision: row.source_revision, updated_at: String(row.updated_at ?? "t0") };
  if (!Array.isArray(row.pages)) return { ...stamp, pages: null, next: null };
  const pages = row.pages as Array<{ text?: string }>;
  const out: unknown[] = [];
  let i = Math.max(from, 0);
  let chars = 0;
  while (i < pages.length && chars < OCR_SLICE_CHARS) { out.push(pages[i]); chars += Array.from(pages[i].text ?? "").length; i += 1; }
  return { ...stamp, pages: out, next: i < pages.length ? i : null };
}

/** The two functions over a table of readings, for the fake databases that implement `rpc`. */
export function scanReadingRpc(rows: () => Row[]) {
  const find = (id: unknown) => rows().find((r) => r.version_id === id);
  return {
    document_ocr_state: async (args: Row) => ocrStateOf(find(args.p_version_id)),
    document_ocr_pages: async (args: Row) => ocrPagesOf(find(args.p_version_id), Number(args.p_from ?? 0)),
  };
}

/** The scripted-database steps one `loadScanRow` / `loadReadScan` takes for this reading (null: no reading). */
export function readingSteps(row: Row | null): Array<{ rpc: string; data: unknown }> {
  if (row === null) return [{ rpc: "document_ocr_pages", data: null }];
  const steps: Array<{ rpc: string; data: unknown }> = [];
  let from = 0;
  for (;;) {
    const slice = ocrPagesOf(row, from);
    steps.push({ rpc: "document_ocr_pages", data: slice });
    if (slice?.next === null || slice?.next === undefined) break;
    from = Number(slice.next);
  }
  steps.push({ rpc: "document_ocr_state", data: ocrStateOf(row) });
  return steps;
}
