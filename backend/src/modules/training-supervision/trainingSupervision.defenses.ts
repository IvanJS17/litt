// Oral defenses of a pupil (docs/training.md, layer 2 §6.2).
//
// Who: only the pupil's CURRENT mentor creates a defense, generates its
// questions and records its outcome (assertCurrentMentor); the pupil reads
// theirs through GET /training/me/supervision, and sees the questions, the
// reason and the note only once the outcome is recorded (open question 5).
//
// Questions: five, four that ask the pupil to justify their own reasoning
// and one change of facts, each with what the mentor should listen for. They
// rest on the pupil's attempts and the contrasts of the linked work, or of
// the works in the defense's practice area the mentor can open. Generated on
// the MENTOR's route exactly as a work review is (mentorRoute: stored per
// defense, no fallback, never the pupil's key), with the pupil's text fenced
// by a nonce, llm.egress before any text is sent, one generation at a time
// and nothing written half-way.
//
// Outcome: approved or not, a reason from a closed list and a note of up to
// 500 characters, recorded once (409 training_defense_already_recorded; the
// database refuses a second write too). It can be recorded without
// questions: a defense really held is not lost because the AI was not there.
// The audit gets the defense's id, never its outcome, reason, note or
// questions.

import type {
    TrainingDefense,
    TrainingDefenseOutcome,
    TrainingDefenseQuestion,
    TrainingDefenseReason,
    TrainingDefenses,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { promptNonce } from "../../lib/promptFence";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { projectPractice } from "../../lib/training";
import {
    buildDefensePrompt,
    completeSupervision,
    DEFENSE_MAX_TOKENS,
    DEFENSE_SYSTEM_PROMPT,
    defenseInputText,
    effectiveGenerationStatus,
    parseDefenseQuestions,
    REVIEW_MAX_NOTES,
} from "../../lib/trainingSupervisionAi";
import type { TurnNoteSurface } from "../../lib/trainingNotes";
import { mayOpenWorkMatter, workPlace } from "../../lib/trainingWork";
import { isUuid } from "../../lib/uuid";
import { readPractice } from "../training/training.service";
import { chatRouteColumns, parseCredentialRef, recordChatEgress } from "../user/user.service";
import { assertCurrentMentor, LEARNING_NOT_FOUND } from "./trainingSupervision.access";
import { mentorGeneration, mentorRoute, noteInputs, REVIEW_IN_PROGRESS_CODE } from "./trainingSupervision.reviews";
import { groupWorks, loadTraineeNotes, surfaceOf, type NoteRow } from "./trainingSupervision.signals";

export const DEFENSE_ALREADY_RECORDED_CODE = "training_defense_already_recorded";
export const DEFENSE_NOTE_MAX_CHARS = 500;
export const DEFENSE_REASONS: readonly TrainingDefenseReason[] = [
    "razonamiento_solido",
    "razonamiento_incompleto",
    "cambio_de_hechos_no_resuelto",
    "sin_sustento",
    "otro",
];
const DEFENSE_LIST_LIMIT = 200;
const ALREADY_RECORDED = "This defense's outcome is already recorded. Create a new defense to correct it.";
const IN_PROGRESS = "These questions are already being generated.";
const NO_WORK = "There is no work of this pupil to base the questions on yet.";

export type DefenseRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    practice: string | null;
    work_review_id: string | null;
    questions: TrainingDefenseQuestion[] | null;
    questions_status: string;
    model_provider: string | null;
    model: string | null;
    credential_ref: string | null;
    outcome: TrainingDefenseOutcome | null;
    outcome_reason: TrainingDefenseReason | null;
    outcome_note: string | null;
    held_at: string | null;
    created_at: string;
    updated_at: string;
};

type Actor = { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown };

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);

/**
 * The wire form, never the credential. For the pupil (`forPupil`), the
 * questions, the reason and the note only once the outcome is recorded.
 */
export function serializeDefense(row: DefenseRow, forPupil: boolean, now: number = Date.now()): TrainingDefense {
    const status = row.questions_status === "none" ? "none" : effectiveGenerationStatus(row.questions_status, row.updated_at, now);
    const visible = !forPupil || !!row.outcome;
    return {
        id: row.id,
        org_id: row.org_id,
        trainee_user_id: row.trainee_user_id,
        practice: row.practice ?? null,
        work_review_id: row.work_review_id ?? null,
        questions_status: status,
        questions: visible && status === "ready" ? row.questions : null,
        model_provider: row.model_provider ?? null,
        model: row.model ?? null,
        outcome: row.outcome ?? null,
        outcome_reason: visible ? (row.outcome_reason ?? null) : null,
        outcome_note: visible ? (row.outcome_note ?? null) : null,
        held_at: row.held_at ?? null,
        created_at: row.created_at,
    };
}

/** A pupil's defenses in an organization, newest first. No access check. */
export async function readDefenses(db: Db, orgId: string, traineeId: string): Promise<ServiceResult<DefenseRow[]>> {
    const { data, error } = await db
        .from("training_defenses")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(DEFENSE_LIST_LIMIT);
    if (error) return internalFailure(error);
    return ok((data ?? []) as unknown as DefenseRow[]);
}

/** The pupil's own defenses (GET /training/me/supervision). */
export async function listOwnDefenses(
    db: Db,
    args: { orgId: string; traineeId: string },
): Promise<ServiceResult<TrainingDefense[]>> {
    const rows = await readDefenses(db, args.orgId, args.traineeId);
    if (!rows.ok) return rows;
    const now = Date.now();
    return ok(rows.data.map((row) => serializeDefense(row, true, now)));
}

/** GET …/pupils/:userId/defenses */
export async function listDefenses(db: Db, actor: Actor): Promise<ServiceResult<TrainingDefenses>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const rows = await readDefenses(db, orgId, traineeId);
    if (!rows.ok) return rows;
    const now = Date.now();
    return ok({
        defenses: rows.data.map((row) => serializeDefense(row, false, now)),
        generation: await mentorGeneration(db, actor.actorId, orgId),
    });
}

/** The pupil's work review `id`, if the actor may open its matter. */
async function visibleReview(
    db: Db,
    args: { orgId: string; traineeId: string; reviewId: string; actorId: string; actorEmail: string | null },
): Promise<ServiceResult<{ surface: { surface: TurnNoteSurface; chatId: string }; projectId: string | null } | null>> {
    const { data, error } = await db
        .from("training_work_reviews")
        .select("id, org_id, trainee_user_id, chat_id, word_chat_id, tabular_chat_id")
        .eq("id", args.reviewId)
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.traineeId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const at = data ? surfaceOf(data as { chat_id?: string | null }) : null;
    if (!at) return ok(null);
    const place = await workPlace(db, at.surface, at.chatId);
    if (!place.ok) return internalFailure(place.error);
    if (
        !place.place ||
        !(await mayOpenWorkMatter(db, {
            projectId: place.place.projectId,
            actorId: args.actorId,
            actorEmail: args.actorEmail,
        }))
    )
        return ok(null);
    return ok({ surface: at, projectId: place.place.projectId });
}

/** POST …/pupils/:userId/defenses: `{ practice?, work_review_id? }`. */
export async function createDefense(
    db: Db,
    actor: Actor & { body: unknown },
): Promise<ServiceResult<TrainingDefense>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const body = (actor.body ?? {}) as { practice?: unknown; work_review_id?: unknown };

    let workReviewId: string | null = null;
    let workProjectId: string | null = null;
    if (body.work_review_id !== undefined && body.work_review_id !== null) {
        if (typeof body.work_review_id !== "string" || !isUuid(body.work_review_id)) return notFound();
        const review = await visibleReview(db, {
            orgId,
            traineeId,
            reviewId: body.work_review_id,
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
        });
        if (!review.ok) return review;
        if (!review.data) return notFound();
        workReviewId = body.work_review_id;
        workProjectId = review.data.projectId;
    }

    let practice: string | null;
    if (body.practice === undefined) {
        try {
            practice = workProjectId ? await projectPractice(db, workProjectId) : null;
        } catch (error) {
            return internalFailure(error);
        }
    } else {
        const read = readPractice(body.practice);
        if (!read.ok) return read;
        practice = read.data;
    }

    const { data, error } = await db
        .from("training_defenses")
        .insert({ org_id: orgId, trainee_user_id: traineeId, practice, work_review_id: workReviewId, questions_status: "none" })
        .select("*")
        .single();
    if (error) {
        if ((error as { code?: string }).code === "23514") return failure("validation", "Choose a practice area.");
        return internalFailure(error);
    }
    const row = data as unknown as DefenseRow;
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId,
        action: "training.defense_created",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: traineeId, defense_id: row.id },
    });
    return ok(serializeDefense(row, false));
}

async function loadDefense(
    db: Db,
    args: { orgId: string; traineeId: string; defenseId: unknown },
): Promise<ServiceResult<DefenseRow | null>> {
    if (typeof args.defenseId !== "string" || !isUuid(args.defenseId)) return ok(null);
    const { data, error } = await db
        .from("training_defenses")
        .select("*")
        .eq("id", args.defenseId)
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.traineeId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as unknown as DefenseRow | null) ?? null);
}

/**
 * The notes the questions rest on, newest last: the linked work's, or else
 * those of every work in the defense's practice area (all areas when null)
 * whose matter the mentor can open. Null when the linked work is not visible.
 */
async function defenseNotes(
    db: Db,
    args: { orgId: string; traineeId: string; defense: DefenseRow; actorId: string; actorEmail: string | null },
): Promise<ServiceResult<{ notes: NoteRow[]; chatId: string | null; projectId: string | null } | null>> {
    const { orgId, traineeId, defense } = args;
    if (defense.work_review_id) {
        const review = await visibleReview(db, { ...args, reviewId: defense.work_review_id });
        if (!review.ok) return review;
        if (!review.data) return ok(null);
        const notes = await loadTraineeNotes(db, { orgId, traineeId, work: review.data.surface });
        if (!notes.ok) return notes;
        const [work] = groupWorks(notes.data);
        return ok({
            notes: work?.notes ?? [],
            chatId: review.data.surface.chatId,
            projectId: review.data.projectId,
        });
    }
    const all = await loadTraineeNotes(db, { orgId, traineeId });
    if (!all.ok) return all;
    const picked: NoteRow[] = [];
    for (const work of groupWorks(all.data)) {
        const place = await workPlace(db, work.surface, work.chatId);
        if (!place.ok) return internalFailure(place.error);
        if (!place.place) continue;
        if (
            !(await mayOpenWorkMatter(db, {
                projectId: place.place.projectId,
                actorId: args.actorId,
                actorEmail: args.actorEmail,
            }))
        )
            continue;
        if (defense.practice !== null) {
            let practice: string | null;
            try {
                practice = place.place.projectId ? await projectPractice(db, place.place.projectId) : null;
            } catch (error) {
                return internalFailure(error);
            }
            if (practice !== defense.practice) continue;
        }
        picked.push(...work.notes);
        if (picked.length >= REVIEW_MAX_NOTES) break;
    }
    picked.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return ok({ notes: picked, chatId: null, projectId: null });
}

/** POST …/defenses/:id/questions: generates (or regenerates) the five questions. */
export async function generateDefenseQuestions(
    db: Db,
    actor: Actor & { defenseId: unknown; credentialRef?: unknown },
): Promise<ServiceResult<TrainingDefense>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const credential = parseCredentialRef(actor.credentialRef);
    if (!credential.ok) return failure("validation", credential.detail);
    const loaded = await loadDefense(db, { orgId, traineeId, defenseId: actor.defenseId });
    if (!loaded.ok) return loaded;
    const row = loaded.data;
    if (!row) return notFound();
    if (row.outcome) return failure("conflict", ALREADY_RECORDED, DEFENSE_ALREADY_RECORDED_CODE);
    if (row.questions_status !== "none" && effectiveGenerationStatus(row.questions_status, row.updated_at) === "pending")
        return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);

    const source = await defenseNotes(db, {
        orgId,
        traineeId,
        defense: row,
        actorId: actor.actorId,
        actorEmail: actor.actorEmail,
    });
    if (!source.ok) return source;
    if (!source.data) return notFound();
    if (source.data.notes.length === 0) return failure("validation", NO_WORK);

    const route = await mentorRoute(db, { actorId: actor.actorId, orgId, row, credentialRef: credential.value });
    if (!route.ok) return route;
    const resolved = route.data;

    // Claim the defense: one generation at a time (a stale pending may be claimed again).
    const { data: claimedRows, error: claimError } = await db
        .from("training_defenses")
        .update({
            questions_status: "pending",
            questions: null,
            ...chatRouteColumns(resolved.route),
            generated_by: actor.actorId,
            updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .is("outcome", null)
        .select("id");
    if (claimError) return internalFailure(claimError);
    if (((claimedRows ?? []) as unknown[]).length !== 1)
        return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);

    await recordChatEgress(db, {
        userId: actor.actorId,
        orgId,
        chatId: source.data.chatId,
        projectId: source.data.projectId,
        surface: "training_supervision",
        resolved,
        extra: { defense_id: row.id },
    });

    const input = noteInputs(source.data.notes);
    let questions: TrainingDefenseQuestion[] | null = null;
    try {
        const text = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: DEFENSE_SYSTEM_PROMPT,
            user: buildDefensePrompt(input, promptNonce()),
            maxTokens: DEFENSE_MAX_TOKENS,
        });
        questions = parseDefenseQuestions(text, defenseInputText(input));
        if (!questions) throw new Error("questions without the required format");
    } catch (error) {
        // The notes are learning data: log only the defense id.
        console.warn("[training] defense questions failed", {
            defenseId: row.id,
            reason: error instanceof Error ? error.name : "error",
        });
    }

    const { data, error } = await db
        .from("training_defenses")
        .update(
            questions
                ? { questions_status: "ready", questions, updated_at: new Date().toISOString() }
                : { questions_status: "failed", updated_at: new Date().toISOString() },
        )
        .eq("id", row.id)
        .eq("questions_status", "pending")
        .select("*");
    if (error) return internalFailure(error);
    const final = ((data ?? []) as unknown as DefenseRow[])[0];
    if (!final) return internalFailure(new Error("defense questions settled elsewhere"));
    return ok(serializeDefense(final, false));
}

type OutcomeInput = { outcome: TrainingDefenseOutcome; reason: TrainingDefenseReason; note: string | null };

/** The outcome request as stored, or what is wrong with it. */
export function readOutcomeBody(body: unknown): ServiceResult<OutcomeInput> {
    const input = (body ?? {}) as Record<string, unknown>;
    if (input.outcome !== "approved" && input.outcome !== "not_approved")
        return failure("validation", "Choose approved or not approved.");
    if (!(DEFENSE_REASONS as readonly unknown[]).includes(input.reason))
        return failure("validation", "Choose the reason for the outcome.");
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== "string") return failure("validation", "The note must be text.");
        const trimmed = input.note.trim();
        if ([...trimmed].length > DEFENSE_NOTE_MAX_CHARS)
            return failure("validation", `The note takes up to ${DEFENSE_NOTE_MAX_CHARS} characters.`);
        note = trimmed || null;
    }
    return ok({ outcome: input.outcome, reason: input.reason as TrainingDefenseReason, note });
}

/** PUT …/defenses/:id/outcome: records `{ outcome, reason, note? }` once. */
export async function recordDefenseOutcome(
    db: Db,
    actor: Actor & { defenseId: unknown; body: unknown },
): Promise<ServiceResult<TrainingDefense>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const loaded = await loadDefense(db, { orgId, traineeId, defenseId: actor.defenseId });
    if (!loaded.ok) return loaded;
    if (!loaded.data) return notFound();
    if (loaded.data.outcome) return failure("conflict", ALREADY_RECORDED, DEFENSE_ALREADY_RECORDED_CODE);
    const input = readOutcomeBody(actor.body);
    if (!input.ok) return input;

    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_defenses")
        .update({
            outcome: input.data.outcome,
            outcome_reason: input.data.reason,
            outcome_note: input.data.note,
            held_at: now,
            recorded_by: actor.actorId,
            updated_at: now,
        })
        .eq("id", loaded.data.id)
        .is("outcome", null)
        .select("*");
    if (error) {
        if ((error as { code?: string }).code === "LT002")
            return failure("conflict", ALREADY_RECORDED, DEFENSE_ALREADY_RECORDED_CODE);
        return internalFailure(error);
    }
    const recorded = ((data ?? []) as unknown as DefenseRow[])[0];
    // Someone recorded it in between.
    if (!recorded) return failure("conflict", ALREADY_RECORDED, DEFENSE_ALREADY_RECORDED_CODE);
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId,
        action: "training.defense_recorded",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: traineeId, defense_id: recorded.id },
    });
    return ok(serializeDefense(recorded, false));
}
