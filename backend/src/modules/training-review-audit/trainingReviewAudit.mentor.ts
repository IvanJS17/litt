// The mentor's side of the bulk review designer (docs/training.md): the
// current mentor of a person reads the design of their reviews and the sample
// they marked, and records «adequate» or «needs work» with a note. Like
// every piece of learning data the gate is assertCurrentMentor (404 for
// anyone else). On top of it, a review is shown only when the mentor can open
// the matter it belongs to (a review outside any matter: when they can open
// the review itself); the others are only counted. The mentor may correct a
// mark of the person; the correction is kept apart as the mentor's. Nothing
// here blocks anything: it is evidence.

import type {
    TrainingAuditOutcome,
    TrainingPupilReviewAudits,
    TrainingReviewAudit,
} from "@mike/contracts";
import { ensureReviewAccess } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { selectInBatches } from "../../lib/batchedQuery";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { AUDIT_NOTE_MAX_CHARS, isAuditMark, type AuditItem } from "../../lib/trainingReviewAudit";
import { openableWorkMatters } from "../../lib/trainingWork";
import { isUuid } from "../../lib/uuid";
import {
    assertCurrentMentor,
    LEARNING_NOT_FOUND,
} from "../training-supervision/trainingSupervision.service";
import {
    AUDIT_STALE_CODE,
    itemKey,
    loadReviewCells,
    serializeAudit,
    settleStale,
    type AuditRow,
    type CellRow,
} from "./trainingReviewAudit.shared";

/** Audits listed for a mentor, newest first. */
export const MENTOR_AUDITS_LIMIT = 50;

type Actor = { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown };
type ReviewRef = { id: string; user_id: string | null; project_id: string | null; org_id: string | null; title: string | null };

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);

/** The reviews of these audits that the mentor may open; the rest are not shown. */
async function openableReviews(db: Db, actor: Actor, rows: AuditRow[]): Promise<ServiceResult<Map<string, ReviewRef>>> {
    let reviews: ReviewRef[];
    try {
        reviews = await selectInBatches<ReviewRef>(
            "audit reviews",
            rows.map((row) => row.tabular_review_id),
            (batch) => db.from("tabular_reviews").select("id, user_id, project_id, org_id, title").in("id", batch),
        );
    } catch (error) {
        return internalFailure(error);
    }
    // A review in a matter is openable when its matter is: one set read for
    // every matter (the rule of mayOpenWorkMatter applied to the batch), not one
    // per review. A review outside any matter is the review's own access.
    let matters: Set<string>;
    try {
        matters = await openableWorkMatters(db, {
            projectIds: reviews.flatMap((review) => (review.project_id ? [review.project_id] : [])),
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
        });
    } catch (error) {
        return internalFailure(error);
    }
    const openable = new Map<string, ReviewRef>();
    for (const review of reviews) {
        const may = review.project_id
            ? matters.has(review.project_id)
            : (await ensureReviewAccess(review, actor.actorId, actor.actorEmail, db)).ok;
        if (may) openable.set(review.id, review);
    }
    return ok(openable);
}

/** GET …/review-audits: the person's audits in reviews the mentor may open. */
export async function listPupilReviewAudits(db: Db, actor: Actor): Promise<ServiceResult<TrainingPupilReviewAudits>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const { data, error } = await db
        .from("training_review_audits")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(MENTOR_AUDITS_LIMIT);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as AuditRow[];
    const reviews = await openableReviews(db, actor, rows);
    if (!reviews.ok) return reviews;
    const audits: TrainingPupilReviewAudits["audits"] = [];
    let withoutAccess = 0;
    const cellsOf = new Map<string, CellRow[]>();
    for (const row of rows) {
        const review = reviews.data.get(row.tabular_review_id);
        if (!review) {
            withoutAccess += 1;
            continue;
        }
        let cells = cellsOf.get(row.tabular_review_id);
        if (!cells) {
            const loaded = await loadReviewCells(db, row.tabular_review_id);
            if (!loaded.ok) return loaded;
            cells = loaded.data;
            cellsOf.set(row.tabular_review_id, cells);
        }
        const settled = await settleStale(db, row, cells);
        if (!settled.ok) return settled;
        const shown = await serializeAudit(db, settled.data, cells, { userId: actor.actorId, userEmail: actor.actorEmail });
        if (!shown.ok) return shown;
        audits.push({ ...shown.data, review_title: review.title ?? null });
    }
    return ok({ audits, without_access: withoutAccess });
}

type Evaluation = {
    outcome: TrainingAuditOutcome;
    note: string | null;
    corrections: { row_id: string; column_index: number; mark: NonNullable<AuditItem["mark"]> }[];
};

/** The evaluation request as stored, or what is wrong with it. */
export function readEvaluationBody(body: unknown): ServiceResult<Evaluation> {
    const input = (body ?? {}) as Record<string, unknown>;
    if (input.outcome !== "adequate" && input.outcome !== "needs_work")
        return failure("validation", "Choose adequate or needs work.");
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== "string") return failure("validation", "The note must be text.");
        const trimmed = input.note.trim();
        if ([...trimmed].length > AUDIT_NOTE_MAX_CHARS)
            return failure("validation", `The note takes up to ${AUDIT_NOTE_MAX_CHARS} characters.`);
        note = trimmed || null;
    }
    const corrections: Evaluation["corrections"] = [];
    if (input.corrections !== undefined && input.corrections !== null) {
        if (!Array.isArray(input.corrections) || input.corrections.length > 20)
            return failure("validation", "The corrections are not valid.");
        for (const raw of input.corrections) {
            const entry = (raw ?? {}) as { row_id?: unknown; column_index?: unknown; mark?: unknown };
            if (
                typeof entry.row_id !== "string" ||
                !isUuid(entry.row_id) ||
                typeof entry.column_index !== "number" ||
                !Number.isInteger(entry.column_index) ||
                !isAuditMark(entry.mark)
            )
                return failure("validation", "The corrections are not valid.");
            corrections.push({ row_id: entry.row_id, column_index: entry.column_index, mark: entry.mark });
        }
    }
    return ok({ outcome: input.outcome, note, corrections });
}

/** PUT …/review-audits/:id/evaluation: `{ outcome, note?, corrections? }` on a complete audit. */
export async function evaluateReviewAudit(
    db: Db,
    actor: Actor & { auditId: unknown; body: unknown },
): Promise<ServiceResult<TrainingReviewAudit>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    if (typeof actor.auditId !== "string" || !isUuid(actor.auditId)) return notFound();
    const { data, error } = await db
        .from("training_review_audits")
        .select("*")
        .eq("id", actor.auditId)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const row = data as unknown as AuditRow | null;
    if (!row) return notFound();
    const reviews = await openableReviews(db, actor, [row]);
    if (!reviews.ok) return reviews;
    if (!reviews.data.has(row.tabular_review_id)) return notFound();
    const input = readEvaluationBody(actor.body);
    if (!input.ok) return input;

    const cells = await loadReviewCells(db, row.tabular_review_id);
    if (!cells.ok) return cells;
    const settled = await settleStale(db, row, cells.data);
    if (!settled.ok) return settled;
    if (settled.data.status === "stale")
        return failure("conflict", "The review was regenerated after this audit.", AUDIT_STALE_CODE);
    if (settled.data.status !== "complete") return failure("conflict", "The person has not finished this audit.");

    const shown = await serializeAudit(db, settled.data, cells.data, { userId: actor.actorId, userEmail: actor.actorEmail });
    if (!shown.ok) return shown;
    const readable = new Set(shown.data.cells.filter((cell) => !cell.withheld).map(itemKey));
    const corrected = new Map(input.data.corrections.map((entry) => [itemKey(entry), entry.mark]));
    // The mentor corrects only what they saw.
    for (const key of corrected.keys()) if (!readable.has(key)) return failure("validation", "The corrections are not valid.");
    const sample = settled.data.sample.map((item) =>
        corrected.has(itemKey(item)) ? { ...item, mentor_mark: corrected.get(itemKey(item))! } : item,
    );
    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await db
        .from("training_review_audits")
        .update({
            sample,
            mentor_outcome: input.data.outcome,
            mentor_note: input.data.note,
            evaluated_at: now,
            evaluated_by: actor.actorId,
            updated_at: now,
        })
        .eq("id", row.id)
        .eq("status", "complete")
        .select("*");
    if (saveError) return internalFailure(saveError);
    const final = ((saved ?? []) as unknown as AuditRow[])[0];
    if (!final) return failure("conflict", "The audit changed. Reload it.");
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId,
        action: "training.review_audit_evaluated",
        surface: "organization",
        reviewId: final.tabular_review_id,
        detail: { org_id: orgId, target_user_id: traineeId },
    });
    return serializeAudit(db, final, cells.data, { userId: actor.actorId, userEmail: actor.actorEmail });
}
