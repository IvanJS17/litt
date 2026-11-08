// The junior's side of the bulk review designer (docs/training.md): the code
// review of the questions of a tabular review, a sample of its cells drawn by
// the server and marked by hand, and the end of the audit.
//
// Who: only a person who may open the review and whose stage in its matter is
// `junior` (the stage is not a permission: it adds nothing to what they can
// already open). For anyone else the write routes answer 404 as for a review
// that does not exist; the read says `applies: false`. The sample is the
// server's: the person does not choose it. The row holds identifiers, a short
// digest and the marks, never the content of a cell. No model is called.

import { randomUUID } from "node:crypto";
import type {
    TrainingAuditMark,
    TrainingReviewAudit,
    TrainingReviewAuditState,
} from "@mike/contracts";
import { ensureReviewAccess } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { resolveTrainingStage } from "../../lib/training";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { filterReadableReviewRows, loadReviewRows } from "../../lib/tabularReadAccess";
import {
    allMarked,
    AUDIT_NOTE_MAX_CHARS,
    cellDigest,
    drawSample,
    isAuditMark,
    lintColumns,
    sampleSize,
    type AuditItem,
} from "../../lib/trainingReviewAudit";
import { isUuid } from "../../lib/uuid";
import { assertLearningAccess } from "../training-supervision/trainingSupervision.service";
import {
    auditColumns,
    AUDIT_STALE_CODE,
    itemKey,
    loadReviewCells,
    readCell,
    serializeAudit,
    settleStale,
    type AuditRow,
    type CellRow,
} from "./trainingReviewAudit.shared";

const NOT_FOUND = "Review not found";
const NOT_READY = "Generate the review before auditing it.";
const RUNNING = "Wait for the review to finish generating.";
const STALE = "The review was regenerated after this audit began. Start another.";
const ALREADY_COMPLETE = "This audit is complete.";
const INCOMPLETE = "Mark every sampled cell to finish the audit.";

type Actor = { userId: string; userEmail: string | null; reviewId: unknown };

type Context = {
    review: { id: string; org_id: string; project_id: string | null; columns_config: unknown; running: boolean };
    applies: boolean;
};

const notFound = () => failure("not_found", NOT_FOUND);

/** The review the person may open, and whether they audit it as a junior. */
async function loadContext(db: Db, actor: Actor): Promise<ServiceResult<Context>> {
    if (typeof actor.reviewId !== "string" || !isUuid(actor.reviewId)) return notFound();
    const { data, error } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id, org_id, columns_config, active_generation_id, generation_lease_expires_at")
        .eq("id", actor.reviewId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const review = data as {
        id: string;
        user_id: string | null;
        project_id: string | null;
        org_id: string | null;
        columns_config: unknown;
        active_generation_id: string | null;
        generation_lease_expires_at: string | null;
    } | null;
    if (!review) return notFound();
    const access = await ensureReviewAccess(review, actor.userId, actor.userEmail, db);
    if (!access.ok) return notFound();
    let stage: string | null = null;
    if (review.org_id) {
        try {
            stage = await resolveTrainingStage(db, actor.userId, { orgId: review.org_id, projectId: review.project_id });
        } catch (stageError) {
            return internalFailure(stageError);
        }
    }
    const running =
        !!review.active_generation_id &&
        !!review.generation_lease_expires_at &&
        Date.parse(review.generation_lease_expires_at) > Date.now();
    return ok({
        review: {
            id: review.id,
            org_id: review.org_id ?? "",
            project_id: review.project_id,
            columns_config: review.columns_config,
            running,
        },
        applies: stage === "junior",
    });
}

/** The person's newest audit of the review, not yet checked against its cells. */
async function latestAudit(db: Db, ctx: Context, userId: string): Promise<ServiceResult<AuditRow | null>> {
    const { data, error } = await db
        .from("training_review_audits")
        .select("*")
        .eq("org_id", ctx.review.org_id)
        .eq("trainee_user_id", userId)
        .eq("tabular_review_id", ctx.review.id)
        .order("created_at", { ascending: false })
        .limit(1);
    if (error) return internalFailure(error);
    return ok(((data ?? []) as unknown as AuditRow[])[0] ?? null);
}

async function gate(db: Db, userId: string, ctx: Context): Promise<ServiceResult<null>> {
    return assertLearningAccess(db, { actorId: userId, orgId: ctx.review.org_id, traineeId: userId });
}

/** The audit with its staleness settled against the review's cells now. */
async function currentAudit(
    db: Db,
    ctx: Context,
    actor: Actor,
): Promise<ServiceResult<{ row: AuditRow | null; cells: CellRow[] }>> {
    const latest = await latestAudit(db, ctx, actor.userId);
    if (!latest.ok) return latest;
    if (!latest.data) return ok({ row: null, cells: [] });
    const cells = await loadReviewCells(db, ctx.review.id);
    if (!cells.ok) return cells;
    const settled = await settleStale(db, latest.data, cells.data);
    if (!settled.ok) return settled;
    return ok({ row: settled.data, cells: cells.data });
}

async function view(db: Db, row: AuditRow, cells: CellRow[], actor: Actor): Promise<ServiceResult<TrainingReviewAudit>> {
    return serializeAudit(db, row, cells, { userId: actor.userId, userEmail: actor.userEmail });
}

/** GET /tabular-review/:reviewId/training-audit */
export async function getReviewAudit(db: Db, actor: Actor): Promise<ServiceResult<TrainingReviewAuditState>> {
    const ctx = await loadContext(db, actor);
    if (!ctx.ok) return ctx;
    if (!ctx.data.applies) return ok({ applies: false, ready: false, columns: [], lint: [], audit: null });
    const access = await gate(db, actor.userId, ctx.data);
    if (!access.ok) return ok({ applies: false, ready: false, columns: [], lint: [], audit: null });
    const columns = auditColumns(ctx.data.review.columns_config);
    const lint = lintColumns(columns);
    const current = await currentAudit(db, ctx.data, actor);
    if (!current.ok) return current;
    let audit: TrainingReviewAudit | null = null;
    if (current.data.row) {
        const shown = await view(db, current.data.row, current.data.cells, actor);
        if (!shown.ok) return shown;
        audit = shown.data;
    }
    const { data: done, error } = await db
        .from("tabular_cells")
        .select("id")
        .eq("review_id", ctx.data.review.id)
        .eq("status", "done")
        .limit(1);
    if (error) return internalFailure(error);
    return ok({
        applies: true,
        ready: (done ?? []).length > 0,
        columns: columns.map(({ index, name, prompt }) => ({ index, name, prompt })),
        lint,
        audit,
    });
}

function isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === "23505";
}

/** POST /tabular-review/:reviewId/training-audit: starts the audit, or returns the live one. */
export async function startReviewAudit(
    db: Db,
    actor: Actor,
): Promise<ServiceResult<{ audit: TrainingReviewAudit; created: boolean }>> {
    const ctx = await loadContext(db, actor);
    if (!ctx.ok) return ctx;
    if (!ctx.data.applies) return notFound();
    const access = await gate(db, actor.userId, ctx.data);
    if (!access.ok) return notFound();
    const current = await currentAudit(db, ctx.data, actor);
    if (!current.ok) return current;
    if (current.data.row && current.data.row.status !== "stale") {
        const shown = await view(db, current.data.row, current.data.cells, actor);
        return shown.ok ? ok({ audit: shown.data, created: false }) : shown;
    }
    if (ctx.data.review.running) return failure("conflict", RUNNING);

    const cells = await loadReviewCells(db, ctx.data.review.id);
    if (!cells.ok) return cells;
    let candidates: CellRow[];
    try {
        const rows = await loadReviewRows(db, ctx.data.review.id);
        const allowed = await filterReadableReviewRows(db, rows, [], actor.userId, actor.userEmail);
        const readable = new Set(allowed.rows.map((row) => row.id));
        candidates = cells.data.filter(
            (cell) => cell.status === "done" && readable.has(cell.row_id) && readCell(cell.content) !== null,
        );
    } catch (error) {
        return internalFailure(error);
    }
    const size = sampleSize(candidates.length);
    if (size === 0) return failure("conflict", NOT_READY);

    const seed = randomUUID();
    const columns = auditColumns(ctx.data.review.columns_config);
    const sample: AuditItem[] = drawSample(candidates, size, seed).map((cell) => ({
        row_id: cell.row_id,
        column_index: cell.column_index,
        digest: cellDigest(cell.content, cell.citations),
    }));
    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_review_audits")
        .insert({
            status: "open",
            created_at: now,
            updated_at: now,
            org_id: ctx.data.review.org_id,
            trainee_user_id: actor.userId,
            tabular_review_id: ctx.data.review.id,
            columns_snapshot: columns.map(({ index, name, prompt }) => ({ index, name, prompt })),
            lint: lintColumns(columns),
            seed,
            sample,
        })
        .select("*");
    if (error) {
        if (isUniqueViolation(error)) return failure("conflict", RUNNING);
        return internalFailure(error);
    }
    const created = ((data ?? []) as unknown as AuditRow[])[0];
    if (!created) return internalFailure(new Error("review audit not created"));
    await recordAudit(db, {
        userId: actor.userId,
        userEmail: actor.userEmail,
        orgId: ctx.data.review.org_id,
        action: "training.review_audit_started",
        surface: "organization",
        reviewId: ctx.data.review.id,
        detail: { org_id: ctx.data.review.org_id, target_user_id: actor.userId },
    });
    const shown = await view(db, created, cells.data, actor);
    return shown.ok ? ok({ audit: shown.data, created: true }) : shown;
}

/** The key of a cell in the URL: `<row id>:<column index>`. */
function parseCellKey(key: unknown): { row_id: string; column_index: number } | null {
    if (typeof key !== "string") return null;
    const [rowId, column, ...rest] = key.split(":");
    if (rest.length > 0 || !isUuid(rowId) || !/^\d{1,6}$/.test(column ?? "")) return null;
    return { row_id: rowId, column_index: Number(column) };
}

/** PUT …/cells/:key: marks one sampled cell `{ mark, note? }`, while the audit is open. */
export async function markReviewAuditCell(
    db: Db,
    actor: Actor & { cellKey: unknown; body: unknown },
): Promise<ServiceResult<TrainingReviewAudit>> {
    const ctx = await loadContext(db, actor);
    if (!ctx.ok) return ctx;
    if (!ctx.data.applies) return notFound();
    const access = await gate(db, actor.userId, ctx.data);
    if (!access.ok) return notFound();
    const key = parseCellKey(actor.cellKey);
    const input = (actor.body ?? {}) as { mark?: unknown; note?: unknown };
    if (!isAuditMark(input.mark)) return failure("validation", "Choose correct, incomplete or incorrect.");
    let note: string | undefined;
    if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== "string") return failure("validation", "The note must be text.");
        const trimmed = input.note.trim();
        if ([...trimmed].length > AUDIT_NOTE_MAX_CHARS)
            return failure("validation", `The note takes up to ${AUDIT_NOTE_MAX_CHARS} characters.`);
        if (trimmed) note = trimmed;
    }
    const current = await currentAudit(db, ctx.data, actor);
    if (!current.ok) return current;
    const row = current.data.row;
    if (!row || !key) return notFound();
    if (row.status === "stale") return failure("conflict", STALE, AUDIT_STALE_CODE);
    if (row.status === "complete") return failure("conflict", ALREADY_COMPLETE);
    if (!row.sample.some((item) => itemKey(item) === itemKey(key))) return notFound();

    const mark: TrainingAuditMark = input.mark;
    const sample = row.sample.map((item) => {
        if (itemKey(item) !== itemKey(key)) return item;
        const { note: _previous, ...rest } = item;
        void _previous;
        return { ...rest, mark, ...(note ? { note } : {}) };
    });
    const { data, error } = await db
        .from("training_review_audits")
        .update({ sample, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("org_id", row.org_id)
        .eq("trainee_user_id", actor.userId)
        .eq("status", "open")
        .eq("updated_at", row.updated_at)
        .select("*");
    if (error) return internalFailure(error);
    const saved = ((data ?? []) as unknown as AuditRow[])[0];
    // Someone (this person in another tab) wrote in between: ask to look again.
    if (!saved) return failure("conflict", "The audit changed. Reload it and mark again.");
    return view(db, saved, current.data.cells, actor);
}

/** POST …/complete: ends the audit once every sampled cell has its mark. */
export async function completeReviewAudit(db: Db, actor: Actor): Promise<ServiceResult<TrainingReviewAudit>> {
    const ctx = await loadContext(db, actor);
    if (!ctx.ok) return ctx;
    if (!ctx.data.applies) return notFound();
    const access = await gate(db, actor.userId, ctx.data);
    if (!access.ok) return notFound();
    const current = await currentAudit(db, ctx.data, actor);
    if (!current.ok) return current;
    const row = current.data.row;
    if (!row) return notFound();
    if (row.status === "stale") return failure("conflict", STALE, AUDIT_STALE_CODE);
    if (row.status === "complete") return view(db, row, current.data.cells, actor);
    if (!allMarked(row.sample)) return failure("conflict", INCOMPLETE);
    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_review_audits")
        .update({ status: "complete", completed_at: now, updated_at: now })
        .eq("id", row.id)
        .eq("org_id", row.org_id)
        .eq("trainee_user_id", actor.userId)
        .eq("status", "open")
        .select("*");
    if (error) return internalFailure(error);
    const done = ((data ?? []) as unknown as AuditRow[])[0];
    if (!done) return failure("conflict", "The audit changed. Reload it.");
    await recordAudit(db, {
        userId: actor.userId,
        userEmail: actor.userEmail,
        orgId: ctx.data.review.org_id,
        action: "training.review_audit_completed",
        surface: "organization",
        reviewId: ctx.data.review.id,
        detail: { org_id: ctx.data.review.org_id, target_user_id: actor.userId },
    });
    return view(db, done, current.data.cells, actor);
}
