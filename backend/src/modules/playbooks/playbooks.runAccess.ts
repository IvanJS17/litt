// A playbook run keeps the findings and the summary it wrote about the document
// it reviewed. Whether a reader may read them is decided when they are read,
// from the documents the reader can open then (keepReadableDerived).

import { keepReadableDerived, type DerivedReader } from "../../lib/access";
import type { Db } from "../../lib/supabase";

type Row = Record<string, unknown>;

/**
 * The stored document a run quoted: its id, none (text that was pasted in, so
 * nothing is derived) or null when it cannot be established. A run says it was
 * over a stored document when it has `stored_document`; one stored before that
 * was recorded is over pasted text only if it kept neither a document nor a
 * name. A stored document that is gone leaves no id: unknown.
 */
export function runSources(row: Row): string[] | null {
  if (row.document_id) return [String(row.document_id)];
  if (row.stored_document === false) return [];
  if (row.stored_document === true) return null;
  return row.document_name ? null : [];
}

export type RunWithheldReason = "no_access" | "source_unknown";

/** Why a run is withheld: its document cannot be established (not recorded, or deleted), or it exists and the reader cannot open it. */
export const runWithheldReason = (row: Row): RunWithheldReason => (runSources(row) === null ? "source_unknown" : "no_access");

/** What a reader gets of a run whose document they cannot open now: its outcome, not what it quoted. */
export function withheldRun<
  T extends { documentName: unknown; documentId: unknown; editedVersionId: unknown; summary: unknown; findings: unknown },
>(run: T, reason: RunWithheldReason) {
  return {
    ...run,
    documentName: null,
    documentId: null,
    editedVersionId: null,
    summary: null,
    findings: [],
    detailsWithheld: true as const,
    detailsWithheldReason: reason,
  };
}

/**
 * Stored run rows as a reader may take them away (the account export): a run
 * whose document the reader cannot open now keeps its place and outcome but not
 * what it quoted. A failed lookup throws.
 */
export async function withholdUnreadableRunRows(db: Db, reader: DerivedReader, rows: Row[]): Promise<Row[]> {
  const kept = new Set(await keepReadableDerived(db, reader, rows, runSources));
  return rows.map((row) =>
    kept.has(row)
      ? row
      : {
          ...row,
          document_id: null,
          document_name: null,
          edited_version_id: null,
          summary: null,
          findings_json: [],
        },
  );
}

/** The rows whose document the reader can open now. A failed lookup throws. */
export async function readableRunRows(db: Db, reader: DerivedReader, rows: Row[]): Promise<Set<Row>> {
  return new Set(await keepReadableDerived(db, reader, rows, runSources));
}

/** The runs, each as `shape` shows it, or withheld when the reader cannot open its document now. A failed lookup throws. */
export async function readableRuns<T extends Parameters<typeof withheldRun>[0]>(
  db: Db,
  reader: DerivedReader,
  rows: Row[],
  shape: (row: Row) => T,
) {
  const kept = await readableRunRows(db, reader, rows);
  return rows.map((row) => (kept.has(row) ? shape(row) : withheldRun(shape(row), runWithheldReason(row))));
}
