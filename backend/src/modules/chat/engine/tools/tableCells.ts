import { ensureReviewAccess } from "../../../../lib/access";
import { filterReadableReviewRows } from "../../../../lib/tabularReadAccess";
import type { Db } from "../../../../lib/supabase";
import type { TabularCellStore } from "../types";

/**
 * The rows of the table this person may read at this moment, asked again for
 * each read: may they still open the review (judged from its row read again
 * now, so a review moved or deleted since the turn started counts), and which
 * rows' source documents may they still open (the two questions the turn's
 * start asked, answered by the same functions). `null` is a refusal: the
 * review is no longer theirs, the store carries nothing to check against, or
 * the check could not be answered.
 */
export async function readableTableRowIds(
  store: TabularCellStore,
  db: Db,
  userId: string,
  userEmail: string | null | undefined,
): Promise<Set<string> | null> {
  const recheck = store.recheck;
  if (!recheck) return null;
  try {
    const review = await recheck.loadReview();
    if (!review) return null;
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return null;
    const { rows } = await filterReadableReviewRows(db, recheck.rows, [], userId, userEmail);
    return new Set(rows.map((row) => row.id));
  } catch {
    return null;
  }
}

/**
 * Render the read_table_cells tool result for the requested slice of a
 * tabular review. Positions in the output (`COL:n`, `ROW:n`) are positions in
 * the full store, which is what the model passes back as indices.
 *
 * Every lookup is O(1): requested indices go through Sets and positions come
 * from maps built once, so the work is O(columns + rows + emitted cells)
 * rather than a findIndex per emitted cell (O(C·R²) on a large review).
 */
export function renderTableCells(
  store: TabularCellStore,
  colIndices: number[] | undefined,
  rowIndices: number[] | undefined,
  readableRowIds?: ReadonlySet<string>,
): { label: string; content: string } {
  const wantedCols = colIndices?.length ? new Set(colIndices) : null;
  const wantedRows = rowIndices?.length ? new Set(rowIndices) : null;

  // First position wins, matching findIndex on duplicate keys.
  const colPosByIndex = new Map<number, number>();
  store.columns.forEach((col, i) => {
    if (!colPosByIndex.has(col.index)) colPosByIndex.set(col.index, i);
  });
  const rowPosById = new Map<string, number>();
  store.documents.forEach((doc, i) => {
    const id = doc.id;
    if (!rowPosById.has(id)) rowPosById.set(id, i);
  });

  const cols = wantedCols
    ? store.columns.filter((_, i) => wantedCols.has(i))
    : store.columns;
  const docs = store.documents.filter(
    (doc, i) =>
      (!wantedRows || wantedRows.has(i)) &&
      (!readableRowIds || readableRowIds.has(doc.id)),
  );

  const label = `${cols.length} ${cols.length === 1 ? "column" : "columns"} × ${docs.length} ${docs.length === 1 ? "row" : "rows"}`;

  const lines: string[] = [];
  for (const col of cols) {
    const colPos = colPosByIndex.get(col.index);
    for (const doc of docs) {
      const docId = doc.id;
      const cell = store.cells.get(`${col.index}:${docId}`);
      lines.push(
        `[COL:${colPos} "${col.name}" | ROW:${rowPosById.get(docId)} "${doc.filename}"]`,
      );
      if (cell?.summary) {
        lines.push(`Summary: ${cell.summary}`);
        if (cell.flag) lines.push(`Flag: ${cell.flag}`);
        if (cell.reasoning) lines.push(`Reasoning: ${cell.reasoning}`);
      } else {
        lines.push(`(not yet generated)`);
      }
      lines.push("");
    }
  }
  return { label, content: lines.join("\n") || "No cells found." };
}
