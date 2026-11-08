// The two-minute review of a pupil's work (docs/training.md, layer 2 §6.1).
//
// Who: only the pupil's CURRENT mentor generates, lists and marks reviews
// (assertLearningAccess, actor ≠ pupil); the pupil reads theirs through
// GET /training/me/supervision. A work done in a matter the mentor cannot
// open is only counted (works_without_access), never shown; the pupil's own
// list leaves those out too, so it is exactly what the mentor sees.
//
// With what: the MENTOR's route (governed BYOK), never the pupil's
// conversation route. The route is fixed per review and stored on the row
// (identifiers only); regenerating reuses it, and if it no longer serves the
// caller it fails closed (chat_route_credential_unavailable) without trying
// another model or key: the mentor chooses one explicitly. A mentor with no
// usable key is not offered generation (training_review_key_required).
// llm.egress is recorded before any text is sent.
//
// States: pending while the call runs (one at a time per work:
// training_review_in_progress), then ready, or failed when the call fails or
// its answer is not the required JSON. Nothing is written half-way: the lists
// are only filled, and only shown, when ready.

import type {
    TrainingPupilWork,
    TrainingPupilWorks,
    TrainingReviewGeneration,
    TrainingReviewItem,
    TrainingWorkReview,
    TrainingWorkSignals,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import {
    failure,
    internalFailure,
    ok,
    type ServiceFailure,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { contrastSections, TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "../../lib/trainingNotes";
import {
    buildWorkReviewPrompt,
    completeSupervision,
    effectiveGenerationStatus,
    parseWorkReview,
    REVIEW_MAX_NOTES,
    REVIEW_MAX_TOKENS,
    WORK_REVIEW_SYSTEM_PROMPT,
} from "../../lib/trainingSupervisionAi";
import { promptNonce } from "../../lib/promptFence";
import { isWorkSurface, mayOpenWorkMatter, openableWorkMatters, workPlace } from "../../lib/trainingWork";
import { isUuid } from "../../lib/uuid";
import {
    chatRouteColumns,
    chatRouteOf,
    listChatCredentialOptions,
    loadPinnedChatRoute,
    parseCredentialRef,
    pinChatRoute,
    recordChatEgress,
    resolveUserChatSelection,
    type ChatRouteFailure,
    type ResolvedChatRoute,
} from "../user/user.service";
import { assertCurrentMentor, LEARNING_NOT_FOUND } from "./trainingSupervision.access";
import {
    groupWorks,
    loadTraineeNotes,
    loadWorkSignals,
    surfaceOf,
    type NoteRow,
    type Work,
} from "./trainingSupervision.signals";

export const REVIEW_IN_PROGRESS_CODE = "training_review_in_progress";
export const REVIEW_KEY_REQUIRED_CODE = "training_review_key_required";
const KEY_REQUIRED =
    "Add a key for your model in Settings → Bring Your Own Keys to generate reviews and questions.";
const IN_PROGRESS = "This review is already being generated.";
const NOT_READY = "Generate the review before marking it as reviewed.";

export type ReviewRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
    status: string;
    covered_through: string | null;
    proposed: TrainingReviewItem[] | null;
    ai_corrected: TrainingReviewItem[] | null;
    doubts: TrainingReviewItem[] | null;
    unverified: TrainingReviewItem[] | null;
    signals: TrainingWorkSignals | Record<string, never> | null;
    model_provider: string | null;
    model: string | null;
    credential_ref: string | null;
    generated_at: string | null;
    reviewed_at: string | null;
    updated_at: string;
};

type Actor = { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown };
type WorkTarget = Actor & { surface: unknown; chatId: unknown };

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);

/** The wire form; the lists only once ready, never the credential. */
export function serializeReview(row: ReviewRow, now: number = Date.now()): TrainingWorkReview {
    const status = effectiveGenerationStatus(row.status, row.updated_at, now);
    const ready = status === "ready";
    return {
        id: row.id,
        org_id: row.org_id,
        trainee_user_id: row.trainee_user_id,
        surface: surfaceOf(row)?.surface ?? "chat",
        chat_id: row.chat_id ?? null,
        word_chat_id: row.word_chat_id ?? null,
        tabular_chat_id: row.tabular_chat_id ?? null,
        status,
        covered_through: row.covered_through ?? null,
        proposed: ready ? row.proposed : null,
        ai_corrected: ready ? row.ai_corrected : null,
        doubts: ready ? row.doubts : null,
        unverified: ready ? row.unverified : null,
        signals: ready ? (row.signals as TrainingWorkSignals) : null,
        model_provider: row.model_provider ?? null,
        model: row.model ?? null,
        generated_at: row.generated_at ?? null,
        reviewed_at: row.reviewed_at ?? null,
    };
}

async function loadReviews(
    db: Db,
    orgId: string,
    traineeId: string,
): Promise<ServiceResult<ReviewRow[]>> {
    const { data, error } = await db
        .from("training_work_reviews")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId);
    if (error) return internalFailure(error);
    return ok((data ?? []) as unknown as ReviewRow[]);
}

/** The pupil's current mentor and their email, or null when they have none. */
async function currentMentor(
    db: Db,
    orgId: string,
    traineeId: string,
): Promise<ServiceResult<{ id: string; email: string | null } | null>> {
    const pupil = await db
        .from("training_pupils")
        .select("mentor_user_id")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .maybeSingle();
    if (pupil.error) return internalFailure(pupil.error);
    const id = (pupil.data as { mentor_user_id?: string } | null)?.mentor_user_id;
    if (!id) return ok(null);
    const profile = await db.from("user_profiles").select("email").eq("user_id", id).maybeSingle();
    if (profile.error) return internalFailure(profile.error);
    return ok({ id, email: (profile.data as { email?: string | null } | null)?.email ?? null });
}

/**
 * The pupil's own reviews in one organization (GET /training/me/supervision),
 * which is what their CURRENT mentor sees of them: the mentor's Trabajos tab
 * leaves out the works of matters the mentor cannot open, so this does too,
 * by the same test. With no mentor nobody reads them, so nothing is listed.
 */
export async function listOwnReviews(
    db: Db,
    args: { orgId: string; traineeId: string },
): Promise<ServiceResult<TrainingWorkReview[]>> {
    const rows = await loadReviews(db, args.orgId, args.traineeId);
    if (!rows.ok) return rows;
    const mentor = await currentMentor(db, args.orgId, args.traineeId);
    if (!mentor.ok) return mentor;
    const seen: ReviewRow[] = [];
    if (mentor.data) {
        const placed: { row: ReviewRow; projectId: string | null }[] = [];
        for (const row of rows.data) {
            const at = surfaceOf(row);
            if (!at) continue;
            const place = await workPlace(db, at.surface, at.chatId);
            if (!place.ok) return internalFailure(place.error);
            if (place.place) placed.push({ row, projectId: place.place.projectId });
        }
        // One set read for every matter the works sit in, not one per work.
        let openable: Set<string>;
        try {
            openable = await openableWorkMatters(db, {
                projectIds: [...new Set(placed.flatMap((p) => (p.projectId ? [p.projectId] : [])))],
                actorId: mentor.data.id,
                actorEmail: mentor.data.email,
            });
        } catch (error) {
            return internalFailure(error);
        }
        for (const { row, projectId } of placed) if (!projectId || openable.has(projectId)) seen.push(row);
    }
    const now = Date.now();
    return ok(
        seen
            .map((row) => serializeReview(row, now))
            .sort((a, b) => (b.covered_through ?? "").localeCompare(a.covered_through ?? "")),
    );
}

/** Whether the mentor can generate at all, and on which of their keys. */
export async function mentorGeneration(
    db: Db,
    actorId: string,
    orgId: string,
): Promise<TrainingReviewGeneration> {
    const unavailable = { available: false as const, code: REVIEW_KEY_REQUIRED_CODE } as const;
    const selection = await resolveUserChatSelection(db, { userId: actorId, orgId });
    if (!selection.ok) return unavailable;
    const listed = await listChatCredentialOptions(db, {
        userId: actorId,
        orgId,
        model: selection.selectedModel,
    });
    if (!listed || listed.options.length === 0) return unavailable;
    return {
        available: true,
        model: selection.selectedModel,
        credential_options: listed.options,
        default_credential_ref: listed.default,
    };
}

/** GET …/pupils/:userId/works: the pupil's works and their reviews. */
export async function listPupilWorks(
    db: Db,
    actor: Actor,
): Promise<ServiceResult<TrainingPupilWorks>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const notes = await loadTraineeNotes(db, { orgId, traineeId });
    if (!notes.ok) return notes;
    const reviews = await loadReviews(db, orgId, traineeId);
    if (!reviews.ok) return reviews;
    const byChat = new Map<string, ReviewRow>();
    for (const row of reviews.data) {
        const at = surfaceOf(row);
        if (at) byChat.set(`${at.surface}:${at.chatId}`, row);
    }

    const now = Date.now();
    const works: TrainingPupilWork[] = [];
    let hidden = 0;
    for (const work of groupWorks(notes.data)) {
        const place = await workPlace(db, work.surface, work.chatId);
        if (!place.ok) return internalFailure(place.error);
        if (
            !place.place ||
            !(await mayOpenWorkMatter(db, {
                projectId: place.place.projectId,
                actorId: actor.actorId,
                actorEmail: actor.actorEmail,
            }))
        ) {
            hidden += 1;
            continue;
        }
        const row = byChat.get(`${work.surface}:${work.chatId}`);
        const lastNoteAt = work.notes[work.notes.length - 1].created_at;
        const review = row ? serializeReview(row, now) : null;
        works.push({
            surface: work.surface,
            chat_id: work.chatId,
            project_id: place.place.projectId,
            title: place.place.title,
            notes: work.notes.length,
            last_note_at: lastNoteAt,
            review,
            has_new_work:
                !!review?.covered_through &&
                Date.parse(lastNoteAt) > Date.parse(review.covered_through),
        });
    }
    return ok({
        org_id: orgId,
        trainee_user_id: traineeId,
        works,
        works_without_access: hidden,
        generation: await mentorGeneration(db, actor.actorId, orgId),
    });
}

/** The work a mentor route names, visible to the actor, or one 404. */
async function targetWork(
    db: Db,
    target: WorkTarget,
): Promise<ServiceResult<{ orgId: string; traineeId: string; work: Work; projectId: string | null }>> {
    if (!isWorkSurface(target.surface) || typeof target.chatId !== "string" || !isUuid(target.chatId))
        return notFound();
    const gate = await assertCurrentMentor(db, target);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const surface: TurnNoteSurface = target.surface;
    const notes = await loadTraineeNotes(db, { orgId, traineeId, work: { surface, chatId: target.chatId } });
    if (!notes.ok) return notes;
    const [work] = groupWorks(notes.data);
    if (!work) return notFound();
    const place = await workPlace(db, surface, work.chatId);
    if (!place.ok) return internalFailure(place.error);
    if (
        !place.place ||
        !(await mayOpenWorkMatter(db, {
            projectId: place.place.projectId,
            actorId: target.actorId,
            actorEmail: target.actorEmail,
        }))
    )
        return notFound();
    return ok({ orgId, traineeId, work, projectId: place.place.projectId });
}

async function loadReview(
    db: Db,
    work: Work,
): Promise<ServiceResult<ReviewRow | null>> {
    const { data, error } = await db
        .from("training_work_reviews")
        .select("*")
        .eq(TURN_NOTE_CHAT_COLUMN[work.surface], work.chatId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as ReviewRow | null) ?? null);
}

export function routeFailure(failed: ChatRouteFailure): ServiceFailure {
    return failure(failed.status === 409 ? "conflict" : "validation", failed.detail, failed.code);
}

type StoredRoute = { model: string | null; model_provider: string | null; credential_ref: string | null };

/**
 * The mentor's route for one generation (a review, a defense's questions):
 * the one stored on the row unless the mentor explicitly chose a key;
 * otherwise their model on the chosen or default key. Never another model or
 * key on failure, and never the pupil's route.
 */
export async function mentorRoute(
    db: Db,
    args: { actorId: string; orgId: string; row: StoredRoute | null; credentialRef: string | null },
): Promise<ServiceResult<ResolvedChatRoute>> {
    const stored = args.row ? chatRouteOf(args.row) : null;
    if (stored && !args.credentialRef) {
        const loaded = await loadPinnedChatRoute(db, {
            userId: args.actorId,
            orgId: args.orgId,
            route: stored,
        });
        return loaded.ok ? ok(loaded) : routeFailure(loaded);
    }
    const generation = await mentorGeneration(db, args.actorId, args.orgId);
    if (!generation.available) return failure("validation", KEY_REQUIRED, REVIEW_KEY_REQUIRED_CODE);
    const pinned = await pinChatRoute(db, {
        userId: args.actorId,
        orgId: args.orgId,
        model: generation.model,
        requestedCredentialRef: args.credentialRef,
    });
    return pinned.ok ? ok(pinned) : routeFailure(pinned);
}

/** The newest notes as model input: each attempt with its contrast's sections. */
export function noteInputs(notes: readonly NoteRow[]) {
    return notes.slice(-REVIEW_MAX_NOTES).map((note) => {
        const sections =
            note.contrast_status === "ready" && note.contrast
                ? contrastSections(note.contrast)
                : { noCoincide: [], falto: [] };
        return {
            id: note.id,
            attempt: note.attempt,
            noCoincide: sections.noCoincide,
            falto: sections.falto,
        };
    });
}

/** POST …/works/:surface/:chatId/review: generates or regenerates the review. */
export async function generateWorkReview(
    db: Db,
    target: WorkTarget & { credentialRef?: unknown },
): Promise<ServiceResult<TrainingWorkReview>> {
    const found = await targetWork(db, target);
    if (!found.ok) return found;
    const credential = parseCredentialRef(target.credentialRef);
    if (!credential.ok) return failure("validation", credential.detail);
    const { orgId, traineeId, work, projectId } = found.data;

    const existing = await loadReview(db, work);
    if (!existing.ok) return existing;
    let row = existing.data;
    if (row && (row.org_id !== orgId || row.trainee_user_id !== traineeId)) return notFound();
    if (row && effectiveGenerationStatus(row.status, row.updated_at) === "pending")
        return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);

    const route = await mentorRoute(db, {
        actorId: target.actorId,
        orgId,
        row,
        credentialRef: credential.value,
    });
    if (!route.ok) return route;
    const resolved = route.data;

    const computed = await loadWorkSignals(db, work, traineeId);
    if (!computed.ok) return computed;

    // Claim the work: one generation at a time. A stale pending row (its
    // call was lost) may be claimed again.
    const pending = {
        status: "pending",
        ...chatRouteColumns(resolved.route),
        generated_by: target.actorId,
        proposed: null,
        ai_corrected: null,
        doubts: null,
        unverified: null,
        updated_at: new Date().toISOString(),
    };
    if (row) {
        const { data, error } = await db
            .from("training_work_reviews")
            .update(pending)
            .eq("id", row.id)
            .eq("updated_at", row.updated_at)
            .select("*");
        if (error) return internalFailure(error);
        const claimed = (data ?? []) as unknown as ReviewRow[];
        if (claimed.length !== 1) return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);
        row = claimed[0];
    } else {
        const { data, error } = await db
            .from("training_work_reviews")
            .insert({
                org_id: orgId,
                trainee_user_id: traineeId,
                [TURN_NOTE_CHAT_COLUMN[work.surface]]: work.chatId,
                ...pending,
            })
            .select("*")
            .single();
        if (error) {
            if ((error as { code?: string }).code === "23505")
                return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);
            return internalFailure(error);
        }
        row = data as unknown as ReviewRow;
    }
    const reviewId = row.id;

    await recordChatEgress(db, {
        userId: target.actorId,
        orgId,
        chatId: work.chatId,
        projectId,
        surface: "training_supervision",
        resolved,
        extra: { work_review_id: reviewId },
    });

    const input = noteInputs(work.notes);
    let generated: ReturnType<typeof parseWorkReview> = null;
    try {
        const text = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: WORK_REVIEW_SYSTEM_PROMPT,
            user: buildWorkReviewPrompt(input, computed.data.signals, promptNonce()),
            maxTokens: REVIEW_MAX_TOKENS,
        });
        generated = parseWorkReview(text, input.map((note) => note.id));
        if (!generated) throw new Error("review without the required format");
    } catch (error) {
        // The notes are learning data: log only the review id.
        console.warn("[training] work review failed", {
            reviewId,
            reason: error instanceof Error ? error.name : "error",
        });
    }

    const now = new Date().toISOString();
    const settled = generated
        ? {
              status: "ready",
              covered_through: work.notes[work.notes.length - 1].created_at,
              proposed: computed.data.proposed,
              ai_corrected: generated.ai_corrected,
              // The computed lines (hints, thermometer, basis, counterpart) come
              // first and are not the model's: their source is not `inferred`.
              doubts: [...computed.data.computed, ...generated.doubts],
              unverified: computed.data.unverified,
              signals: computed.data.signals,
              generated_at: now,
              // A regenerated review is new: the mentor marks it again.
              reviewed_at: null,
              reviewed_by: null,
              updated_at: now,
          }
        : { status: "failed", updated_at: now };
    const { data, error } = await db
        .from("training_work_reviews")
        .update(settled)
        .eq("id", reviewId)
        .eq("status", "pending")
        .select("*");
    if (error) return internalFailure(error);
    const final = ((data ?? []) as unknown as ReviewRow[])[0];
    if (!final) return internalFailure(new Error("work review settled elsewhere"));

    if (generated) {
        await recordAudit(db, {
            userId: target.actorId,
            userEmail: target.actorEmail,
            orgId,
            action: "training.work_review_generated",
            surface: "organization",
            chatId: work.chatId,
            detail: { org_id: orgId, target_user_id: traineeId },
        });
    }
    return ok(serializeReview(final));
}

/** PUT …/works/:surface/:chatId/review/reviewed: the mentor marks it reviewed. */
export async function markWorkReviewed(
    db: Db,
    target: WorkTarget,
): Promise<ServiceResult<TrainingWorkReview>> {
    const found = await targetWork(db, target);
    if (!found.ok) return found;
    const { orgId, traineeId, work } = found.data;
    const existing = await loadReview(db, work);
    if (!existing.ok) return existing;
    const row = existing.data;
    if (!row || row.org_id !== orgId || row.trainee_user_id !== traineeId) return notFound();
    if (effectiveGenerationStatus(row.status, row.updated_at) !== "ready")
        return failure("conflict", NOT_READY);
    if (row.reviewed_at) return ok(serializeReview(row));

    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_work_reviews")
        .update({ reviewed_at: now, reviewed_by: target.actorId, updated_at: now })
        .eq("id", row.id)
        .eq("status", "ready")
        .select("*");
    if (error) return internalFailure(error);
    const marked = ((data ?? []) as unknown as ReviewRow[])[0];
    if (!marked) return failure("conflict", NOT_READY);
    await recordAudit(db, {
        userId: target.actorId,
        userEmail: target.actorEmail,
        orgId,
        action: "training.work_review_marked",
        surface: "organization",
        chatId: work.chatId,
        detail: { org_id: orgId, target_user_id: traineeId },
    });
    return ok(serializeReview(marked));
}
