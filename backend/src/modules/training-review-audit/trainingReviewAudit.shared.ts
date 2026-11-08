// LiTT training layer 3, bulk review designer (docs/training.md): what the
// junior's routes and the mentor's share. An audit is learning data of the
// person (training_review_audits); the content of a sampled cell is read from
// the review when it is shown and never copied into the row.

import type {
    TrainingAuditCell,
    TrainingAuditColumn,
    TrainingAuditOutcome,
    TrainingAuditStatus,
    TrainingLintWarning,
    TrainingReviewAudit,
} from "@mike/contracts";
import { selectAllByKey } from "../../lib/batchedQuery";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { filterReadableReviewRows, loadReviewRows } from "../../lib/tabularReadAccess";
import {
    cellDigest,
    tallyByColumn,
    type AuditItem,
} from "../../lib/trainingReviewAudit";

export const AUDIT_STALE_CODE = "training_review_audit_stale";

export type AuditRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    tabular_review_id: string;
    columns_snapshot: TrainingAuditColumn[];
    lint: TrainingLintWarning[];
    seed: string;
    /** The key of the sample's digests; never serialized. */
    digest_salt: string;
    sample: AuditItem[];
    status: TrainingAuditStatus;
    completed_at: string | null;
    mentor_outcome: TrainingAuditOutcome | null;
    mentor_note: string | null;
    evaluated_at: string | null;
    created_at: string;
    updated_at: string;
};

export type CellRow = {
    id: string;
    row_id: string;
    column_index: number;
    status: string;
    content: unknown;
    citations: unknown;
};

export const itemKey = (item: { row_id: string; column_index: number }) => `${item.row_id}:${item.column_index}`;

/** The columns of a review as the audit stores them: names and instructions. */
export function auditColumns(columnsConfig: unknown): (TrainingAuditColumn & { format?: unknown })[] {
    if (!Array.isArray(columnsConfig)) return [];
    return columnsConfig.map((raw, position) => {
        const column = (raw ?? {}) as { index?: unknown; name?: unknown; prompt?: unknown; format?: unknown };
        return {
            index: typeof column.index === "number" ? column.index : position,
            name: typeof column.name === "string" ? column.name : "",
            prompt: typeof column.prompt === "string" ? column.prompt : "",
            format: column.format,
        };
    });
}

/** The summary and the reasoning of a stored cell; null when there is nothing to read. */
export function readCell(content: unknown): { summary: string; reasoning: string } | null {
    if (content === null || content === undefined || content === "") return null;
    let value: unknown = content;
    if (typeof content === "string") {
        try {
            value = JSON.parse(content);
        } catch {
            return { summary: content, reasoning: "" };
        }
    }
    if (typeof value !== "object" || value === null) return { summary: String(value), reasoning: "" };
    const cell = value as { summary?: unknown; reasoning?: unknown };
    return {
        summary: typeof cell.summary === "string" ? cell.summary : cell.summary == null ? "" : String(cell.summary),
        reasoning: typeof cell.reasoning === "string" ? cell.reasoning : "",
    };
}

/** Every cell of the review that is done and readable text: what a sample is drawn from. */
export async function loadReviewCells(db: Db, reviewId: string): Promise<ServiceResult<CellRow[]>> {
    try {
        const cells = await selectAllByKey<CellRow>("audit review cells", () =>
            db.from("tabular_cells").select("id, row_id, column_index, status, content, citations").eq("review_id", reviewId),
        );
        return ok(cells);
    } catch (error) {
        return internalFailure(error);
    }
}

/**
 * Whether the review changed under a sample: a sampled cell that is gone, is
 * not done any more, or whose digest differs was regenerated or edited.
 */
export function sampleIsStale(items: readonly AuditItem[], cells: readonly CellRow[], salt: string): boolean {
    const byKey = new Map(cells.map((cell) => [itemKey(cell), cell]));
    return items.some((item) => {
        const cell = byKey.get(itemKey(item));
        return !cell || cell.status !== "done" || cellDigest(salt, cell.content, cell.citations) !== item.digest;
    });
}

/** A live audit that no longer matches its review becomes stale (once, for good). */
export async function settleStale(db: Db, row: AuditRow, cells: readonly CellRow[]): Promise<ServiceResult<AuditRow>> {
    if (row.status === "stale" || !sampleIsStale(row.sample, cells, row.digest_salt)) return ok(row);
    const { error } = await db
        .from("training_review_audits")
        .update({ status: "stale", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("org_id", row.org_id)
        .eq("trainee_user_id", row.trainee_user_id)
        .in("status", ["open", "complete"]);
    if (error) return internalFailure(error);
    return ok({ ...row, status: "stale" });
}

/**
 * The audit as its reader sees it. A cell appears only when the reader can
 * read every document that feeds its row; otherwise it is withheld and
 * counted. A stale audit shows no cells: it only says it expired.
 */
export async function serializeAudit(
    db: Db,
    row: AuditRow,
    cells: readonly CellRow[],
    reader: { userId: string; userEmail: string | null },
): Promise<ServiceResult<TrainingReviewAudit>> {
    let rows: Awaited<ReturnType<typeof loadReviewRows>> = [];
    let readable = new Set<string>();
    if (row.status !== "stale") {
        try {
            const all = await loadReviewRows(db, row.tabular_review_id);
            const wanted = new Set(row.sample.map((item) => item.row_id));
            rows = all.filter((candidate) => wanted.has(candidate.id));
            const allowed = await filterReadableReviewRows(db, rows, [], reader.userId, reader.userEmail);
            readable = new Set(allowed.rows.map((candidate) => candidate.id));
        } catch (error) {
            return internalFailure(error);
        }
    }
    const labels = new Map(rows.map((candidate) => [candidate.id, candidate.label]));
    const names = new Map(row.columns_snapshot.map((column) => [column.index, column.name]));
    const byKey = new Map(cells.map((cell) => [itemKey(cell), cell]));
    const shown: TrainingAuditCell[] = row.status === "stale"
        ? []
        : [...row.sample]
              .sort((a, b) => a.column_index - b.column_index || a.row_id.localeCompare(b.row_id))
              .map((item) => {
                  const canRead = readable.has(item.row_id);
                  const read = canRead ? readCell(byKey.get(itemKey(item))?.content) : null;
                  return {
                      row_id: item.row_id,
                      column_index: item.column_index,
                      column_name: names.get(item.column_index) ?? "",
                      row_label: canRead ? (labels.get(item.row_id) ?? null) : null,
                      summary: read?.summary ?? null,
                      reasoning: read?.reasoning ?? null,
                      withheld: !canRead,
                      mark: item.mark ?? null,
                      note: item.note ?? null,
                      mentor_mark: item.mentor_mark ?? null,
                  };
              });
    return ok({
        id: row.id,
        tabular_review_id: row.tabular_review_id,
        status: row.status,
        columns: row.columns_snapshot,
        lint: row.lint,
        cells: shown,
        withheld: shown.filter((cell) => cell.withheld).length,
        created_at: row.created_at,
        completed_at: row.completed_at,
        tally:
            row.status === "complete"
                ? tallyByColumn(row.sample).map((count) => ({
                      ...count,
                      column_name: names.get(count.column_index) ?? "",
                  }))
                : null,
        evaluation:
            row.mentor_outcome && row.evaluated_at
                ? { outcome: row.mentor_outcome, note: row.mentor_note, evaluated_at: row.evaluated_at }
                : null,
    });
}
