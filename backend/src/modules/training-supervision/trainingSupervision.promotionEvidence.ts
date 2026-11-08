// The layer-3 evidence of a promotion proposal (docs/training.md): the pupil's
// marked turns (for the calibration), the bulk-review audits the mentor
// evaluated and the full readings handed in. Read through the eyes of the
// current mentor: what lives in a matter they cannot open is only counted
// (`without_access`), never used, dated or described, the rule of the
// criterion map. Nothing here is a score: the function that uses it counts
// the same person's own events.

import { ensureReviewAccess } from "../../lib/access";
import { selectInBatches } from "../../lib/batchedQuery";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { countedTurns, type EvidenceNote } from "../../lib/trainingMap";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "../../lib/trainingNotes";
import type { PromotionAudit, PromotionTurn, PromotionWork } from "../../lib/trainingPromotion";
import { WORK_SURFACES, workPlace } from "../../lib/trainingWork";
import type { projectLens, Viewer } from "./trainingSupervision.lens";

/** The newest turn notes read; a person is nowhere near this many in practice. */
export const PROMOTION_NOTES_LIMIT = 1000;
const NOTE_COLUMNS =
    "id, chat_id, word_chat_id, tabular_chat_id, created_at, contrast_status, confidence, verdict, verdict_source, foundation, topics, answer_unverified, mode";

type Lens = ReturnType<typeof projectLens>;
type StoredNote = Omit<EvidenceNote, "work"> & {
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
};

export type PromotionLayer3 = {
    turns: PromotionTurn[];
    audits: PromotionAudit[];
    readings: PromotionWork[];
    without_access: { turns: number; audits: number; readings: number };
};

async function loadTurns(db: Db, viewer: Viewer, lens: Lens): Promise<ServiceResult<{ turns: PromotionTurn[]; without: number }>> {
    const read = await db
        .from("training_turn_notes")
        .select(NOTE_COLUMNS)
        .eq("org_id", viewer.orgId)
        .eq("trainee_user_id", viewer.traineeId)
        .order("created_at", { ascending: false })
        .limit(PROMOTION_NOTES_LIMIT);
    if (read.error) return internalFailure(read.error);
    const notes: EvidenceNote[] = [];
    const placeOf = new Map<string, { surface: TurnNoteSurface; chatId: string }>();
    for (const note of (read.data ?? []) as unknown as StoredNote[]) {
        const surface = WORK_SURFACES.find((candidate) => note[TURN_NOTE_CHAT_COLUMN[candidate] as "chat_id"] != null);
        if (!surface) continue;
        const chatId = note[TURN_NOTE_CHAT_COLUMN[surface] as "chat_id"] as string;
        const work = `${surface}:${chatId}`;
        placeOf.set(work, { surface, chatId });
        notes.push({
            id: note.id,
            work,
            created_at: note.created_at,
            contrast_status: note.contrast_status,
            confidence: note.confidence ?? null,
            verdict: note.verdict ?? null,
            verdict_source: note.verdict_source ?? null,
            foundation: note.foundation ?? null,
            topics: note.topics ?? null,
            answer_unverified: note.answer_unverified === true,
            mode: note.mode ?? null,
        });
    }
    const workOf = new Map(notes.map((note) => [note.id, note.work]));
    const projectOf = new Map<string, string | null | undefined>();
    const turns: PromotionTurn[] = [];
    let without = 0;
    for (const turn of countedTurns(notes)) {
        const work = workOf.get(turn.id) as string;
        if (!projectOf.has(work)) {
            const at = placeOf.get(work) as { surface: TurnNoteSurface; chatId: string };
            const place = await workPlace(db, at.surface, at.chatId);
            if (!place.ok) return internalFailure(place.error);
            // undefined: the work's chat is gone; nothing to count.
            projectOf.set(work, place.place ? place.place.projectId : undefined);
        }
        const projectId = projectOf.get(work);
        if (projectId === undefined) continue;
        if (!(await lens.mayOpen(projectId))) {
            without += 1;
            continue;
        }
        turns.push({
            id: turn.id,
            practice: await lens.practice(projectId),
            at: turn.at,
            confidence: turn.confidence,
            verdict: turn.verdict,
        });
    }
    return ok({ turns, without });
}

type ReviewRef = { id: string; user_id: string | null; project_id: string | null; org_id: string | null };

async function loadAudits(db: Db, viewer: Viewer, lens: Lens): Promise<ServiceResult<{ audits: PromotionAudit[]; without: number }>> {
    const read = await db
        .from("training_review_audits")
        .select("id, tabular_review_id, mentor_outcome, evaluated_at")
        .eq("org_id", viewer.orgId)
        .eq("trainee_user_id", viewer.traineeId)
        .not("mentor_outcome", "is", null);
    if (read.error) return internalFailure(read.error);
    const rows = (read.data ?? []) as unknown as {
        id: string;
        tabular_review_id: string;
        mentor_outcome: "adequate" | "needs_work";
        evaluated_at: string;
    }[];
    let reviews: ReviewRef[];
    try {
        reviews = await selectInBatches<ReviewRef>(
            "promotion audit reviews",
            rows.map((row) => row.tabular_review_id),
            (batch) => db.from("tabular_reviews").select("id, user_id, project_id, org_id").in("id", batch),
        );
    } catch (error) {
        return internalFailure(error);
    }
    const byId = new Map(reviews.map((review) => [review.id, review]));
    const audits: PromotionAudit[] = [];
    let without = 0;
    for (const row of rows) {
        const review = byId.get(row.tabular_review_id);
        if (!review) continue;
        // A review in a matter is openable with the matter; one outside any
        // matter by the review's own access.
        const may = review.project_id
            ? await lens.mayOpen(review.project_id)
            : (await ensureReviewAccess(review, viewer.actorId, viewer.actorEmail, db)).ok;
        if (!may) {
            without += 1;
            continue;
        }
        audits.push({
            id: row.id,
            practice: await lens.practice(review.project_id),
            at: row.evaluated_at,
            outcome: row.mentor_outcome,
        });
    }
    return ok({ audits, without });
}

async function loadReadings(db: Db, viewer: Viewer, lens: Lens): Promise<ServiceResult<{ readings: PromotionWork[]; without: number }>> {
    const read = await db
        .from("training_readings")
        .select("id, project_id, submitted_at")
        .eq("org_id", viewer.orgId)
        .eq("trainee_user_id", viewer.traineeId)
        .not("submitted_at", "is", null);
    if (read.error) return internalFailure(read.error);
    const readings: PromotionWork[] = [];
    let without = 0;
    for (const row of (read.data ?? []) as unknown as { id: string; project_id: string | null; submitted_at: string }[]) {
        if (!(await lens.mayOpen(row.project_id))) {
            without += 1;
            continue;
        }
        readings.push({ id: row.id, practice: await lens.practice(row.project_id), at: row.submitted_at });
    }
    return ok({ readings, without });
}

/** Everything layer 3 adds to the input of proposePromotions, and what was left out. */
export async function loadPromotionLayer3(db: Db, viewer: Viewer, lens: Lens): Promise<ServiceResult<PromotionLayer3>> {
    try {
        const turns = await loadTurns(db, viewer, lens);
        if (!turns.ok) return turns;
        const audits = await loadAudits(db, viewer, lens);
        if (!audits.ok) return audits;
        const readings = await loadReadings(db, viewer, lens);
        if (!readings.ok) return readings;
        return ok({
            turns: turns.data.turns,
            audits: audits.data.audits,
            readings: readings.data.readings,
            without_access: { turns: turns.data.without, audits: audits.data.without, readings: readings.data.without },
        });
    } catch (error) {
        return internalFailure(error);
    }
}
