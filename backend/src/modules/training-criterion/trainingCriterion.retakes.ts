// Retaking a weak topic (docs/training.md, layer 3).
//
// Who: only the person, on their own rows (the mentor reads the result in
// the criterion view). Every call asks the learning-data rule first
// (assertLearningAccess); a retake that is not the caller's is the same 404
// as none.
//
// Flow: a topic of the map is weak and its last event is RETAKE_AFTER_DAYS
// old or more → the person asks for the retake → ONE question, built only
// from what they wrote about the topic and what the contrast flagged, on
// THEIR route (governed BYOK, fixed on the row, no fallback, llm.egress
// before any text is sent) → they answer in their own words → a second call
// contrasts the answer with exactly those notes (their ids are kept on the
// row, source_note_ids; none is added later) → one more event of the map.
// Nothing is scheduled: it is generated when the person asks, so no
// credential is ever kept for a background job. One retake is pending or
// open at a time. The audit gets identifiers only.

import type { TrainingRetake } from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { promptNonce } from "../../lib/promptFence";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { computeMap, labelFromNotes, topicKey } from "../../lib/trainingMap";
import {
    buildRetakeContrastPrompt,
    buildRetakeQuestionPrompt,
    checkRetakeAnswer,
    materialOf,
    materialTexts,
    parseRetakeContrast,
    parseRetakeQuestion,
    RETAKE_CONTRAST_MAX_TOKENS,
    RETAKE_CONTRAST_SYSTEM_PROMPT,
    RETAKE_MATERIAL_NOTES,
    RETAKE_MAX_TOKENS,
    RETAKE_QUESTION_SYSTEM_PROMPT,
    type RetakeMaterialNote,
} from "../../lib/trainingRetake";
import { completeSupervision } from "../../lib/trainingSupervisionAi";
import { assertLearningAccess } from "../training-supervision/trainingSupervision.service";
import { chatRouteColumns, parseCredentialRef, recordChatEgress } from "../user/user.service";
import { loadEvidenceNotes } from "./trainingCriterion.evidence";
import {
    effectiveRetakeStatus,
    loadOwnRetake,
    readRetakes,
    retakeNotFound,
    serializeRetake,
    type RetakeRow,
} from "./trainingCriterion.retakeRows";
import { retakeRoute } from "./trainingCriterion.retakeRoute";
import { eventsOf } from "./trainingCriterion.view";

export const RETAKE_IN_PROGRESS_CODE = "training_retake_in_progress";
export const RETAKE_NOT_DUE_CODE = "training_retake_not_due";
export const RETAKE_NOT_OPEN_CODE = "training_retake_not_open";
export const RETAKE_SOURCE_GONE_CODE = "training_retake_source_gone";

const IN_PROGRESS = "You already have a retake in progress.";
const NOT_DUE = "That topic is not due to be retaken.";
const NOT_OPEN = "This retake is not waiting for an answer.";
const SOURCE_GONE = "The notes this question came from no longer exist, so it cannot be judged. This retake was closed; you can ask for a new one.";
const ANSWER_FAILED = "Your answer could not be contrasted just now, and it was not saved. Try again.";
const QUESTION_FAILED = "The retake question could not be made just now. Try again.";

type Person = { userId: string; userEmail: string | null };

const self = (db: Db, userId: string, orgId: unknown) =>
    assertLearningAccess(db, { actorId: userId, orgId, traineeId: userId });

/** A row `pending` too long lost its call: it goes back to waiting for the answer, or fails. */
async function settleStale(db: Db, rows: readonly RetakeRow[], now: number): Promise<ServiceResult<null>> {
    for (const row of rows) {
        if (row.status !== "pending" || effectiveRetakeStatus(row, now) === "pending") continue;
        const { error } = await db
            .from("training_retakes")
            .update({ status: row.question ? "open" : "failed", updated_at: new Date(now).toISOString() })
            .eq("id", row.id)
            .eq("status", "pending")
            .eq("updated_at", row.updated_at);
        if (error) return internalFailure(error);
    }
    return ok(null);
}

/**
 * The lines of exactly the notes `noteIds`, oldest first, and the ids found.
 * It never looks for other notes: one that no longer exists is just absent.
 */
async function materialFor(
    db: Db,
    args: { orgId: string; traineeId: string; noteIds: readonly string[] },
): Promise<ServiceResult<{ material: RetakeMaterialNote[]; foundIds: string[] }>> {
    if (args.noteIds.length === 0) return ok({ material: [], foundIds: [] });
    const { data, error } = await db
        .from("training_turn_notes")
        .select("id, attempt, contrast, created_at")
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.traineeId)
        .in("id", [...args.noteIds]);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as { id: string; attempt: string; contrast: string | null; created_at: string }[];
    const sorted = rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return ok({ material: sorted.map(materialOf), foundIds: sorted.map((row) => row.id) });
}

/** POST /training/me/retakes: `{ org_id, topic_key, credential_ref? }`. */
export async function startRetake(
    db: Db,
    args: Person & { orgId: unknown; body: unknown; now?: number },
): Promise<ServiceResult<TrainingRetake>> {
    const access = await self(db, args.userId, args.orgId);
    if (!access.ok) return access;
    const orgId = args.orgId as string;
    const body = (args.body ?? {}) as { topic_key?: unknown; credential_ref?: unknown };
    if (typeof body.topic_key !== "string" || !topicKey(body.topic_key))
        return failure("validation", "Choose the topic to retake.");
    const key = topicKey(body.topic_key);
    const credential = parseCredentialRef(body.credential_ref);
    if (!credential.ok) return failure("validation", credential.detail);
    const now = args.now ?? Date.now();

    const before = await readRetakes(db, orgId, args.userId);
    if (!before.ok) return before;
    const settled = await settleStale(db, before.data, now);
    if (!settled.ok) return settled;
    // Read again: a stale `pending` that had a question went back to `open`
    // and still holds the person's single slot.
    const existing = await readRetakes(db, orgId, args.userId);
    if (!existing.ok) return existing;
    if (existing.data.some((row) => row.status === "pending" || row.status === "open"))
        return failure("conflict", IN_PROGRESS, RETAKE_IN_PROGRESS_CODE);

    const notes = await loadEvidenceNotes(db, { orgId, traineeId: args.userId });
    if (!notes.ok) return notes;
    const events = eventsOf(notes.data, existing.data);
    const topic = computeMap(events, now).find((candidate) => candidate.key === key);
    if (!topic || !topic.retake_due) return failure("conflict", NOT_DUE, RETAKE_NOT_DUE_CODE);
    const noteIds = events
        .filter((event) => event.key === key && event.note_id)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, RETAKE_MATERIAL_NOTES)
        .map((event) => event.note_id as string);
    const material = await materialFor(db, { orgId, traineeId: args.userId, noteIds });
    if (!material.ok) return material;
    if (material.data.material.length === 0) return failure("conflict", NOT_DUE, RETAKE_NOT_DUE_CODE);
    const sourceNoteIds = material.data.foundIds;
    // The label comes from the retake's own material, not from the topic's
    // last event: that one may sit in a matter the mentor cannot open, and
    // the mentor reads this label next to the retake.
    const sourceSet = new Set(sourceNoteIds);
    const label = labelFromNotes(notes.data.filter((note) => sourceSet.has(note.id)), key) ?? topic.label;

    // The person's own route, fixed on the row; no key, no retake.
    const route = await retakeRoute(db, { userId: args.userId, orgId, row: null, credentialRef: credential.value });
    if (!route.ok) return route;
    const resolved = route.data;

    // Claim the slot first: the partial unique index lets one request through.
    const { data: inserted, error: insertError } = await db
        .from("training_retakes")
        .insert({
            org_id: orgId,
            trainee_user_id: args.userId,
            topic_key: key,
            topic_label: label,
            status: "pending",
            // The notes the question is made from: the answer is contrasted
            // with these and the mentor's view depends on all of them.
            source_note_ids: sourceNoteIds,
            ...chatRouteColumns(resolved.route),
        })
        .select("*")
        .single();
    if (insertError) {
        if ((insertError as { code?: string }).code === "23505")
            return failure("conflict", IN_PROGRESS, RETAKE_IN_PROGRESS_CODE);
        return internalFailure(insertError);
    }
    const row = inserted as unknown as RetakeRow;

    let question: string | null = null;
    try {
        await recordChatEgress(db, {
            userId: args.userId,
            orgId,
            chatId: null,
            surface: "training_retake",
            resolved,
            extra: { retake_id: row.id, step: "question" },
        });
        const text = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: RETAKE_QUESTION_SYSTEM_PROMPT,
            user: buildRetakeQuestionPrompt(label, material.data.material, promptNonce()),
            maxTokens: RETAKE_MAX_TOKENS,
        });
        question = parseRetakeQuestion(text, material.data.material);
        if (!question) throw new Error("question without the required format");
    } catch (error) {
        // What the person wrote is learning data: log only the retake id.
        console.warn("[training] retake question failed", {
            retakeId: row.id,
            reason: error instanceof Error ? error.name : "error",
        });
    }

    const { data, error } = await db
        .from("training_retakes")
        .update(
            question
                ? { status: "open", question, updated_at: new Date().toISOString() }
                : { status: "failed", updated_at: new Date().toISOString() },
        )
        .eq("id", row.id)
        .eq("status", "pending")
        .select("*");
    if (error) return internalFailure(error);
    const final = ((data ?? []) as unknown as RetakeRow[])[0];
    if (!final) return internalFailure(new Error("retake settled elsewhere"));
    if (!question) return failure("unavailable", QUESTION_FAILED);
    await recordAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId,
        action: "training.retake_generated",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: args.userId, retake_id: row.id },
    });
    return ok(serializeRetake(final));
}

/** PUT /training/me/retakes/:id/answer: `{ answer, credential_ref? }`, judged once. */
export async function answerRetake(
    db: Db,
    args: Person & { retakeId: unknown; body: unknown },
): Promise<ServiceResult<TrainingRetake>> {
    const loaded = await loadOwnRetake(db, args);
    if (!loaded.ok) return loaded;
    if (!loaded.data) return retakeNotFound();
    const row = loaded.data;
    const access = await self(db, args.userId, row.org_id);
    if (!access.ok) return access;

    const body = (args.body ?? {}) as { answer?: unknown; credential_ref?: unknown };
    const now = Date.now();
    const status = effectiveRetakeStatus(row, now);
    if (status === "pending") return failure("conflict", IN_PROGRESS, RETAKE_IN_PROGRESS_CODE);
    // A stale pending that had a question reads as open: it waits for the answer again.
    if (status !== "open") return failure("conflict", NOT_OPEN, RETAKE_NOT_OPEN_CODE);
    const checked = checkRetakeAnswer(body.answer);
    if (!checked.ok) return failure("validation", checked.detail);
    const credential = parseCredentialRef(body.credential_ref);
    if (!credential.ok) return failure("validation", credential.detail);

    // The row's own route unless the person explicitly chose another of their keys.
    const route = await retakeRoute(db, {
        userId: args.userId,
        orgId: row.org_id,
        row,
        credentialRef: credential.value,
    });
    if (!route.ok) return route;
    const resolved = route.data;

    // The material is exactly the notes the question was made from, kept on
    // the row. Notes written on the topic since are NOT added (they may sit in
    // matters the mentor cannot open, and the mentor reads this contrast). If
    // some of those notes are gone the contrast uses the ones that remain;
    // with none left it fails closed: the retake is closed as failed (it must
    // not hold the person's single slot forever) and nothing is sent to a model.
    const sources = row.source_note_ids ?? [];
    const material = await materialFor(db, { orgId: row.org_id, traineeId: args.userId, noteIds: sources });
    if (!material.ok) return material;
    if (material.data.material.length === 0) {
        const { error: closeError } = await db
            .from("training_retakes")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("status", row.status)
            .eq("updated_at", row.updated_at);
        if (closeError) return internalFailure(closeError);
        return failure("conflict", SOURCE_GONE, RETAKE_SOURCE_GONE_CODE);
    }

    // Claim the retake: one judgment at a time.
    const { data: claimed, error: claimError } = await db
        .from("training_retakes")
        .update({ status: "pending", ...chatRouteColumns(resolved.route), updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
    if (claimError) return internalFailure(claimError);
    // Lost the claim: another request already took this retake. For the
    // person it is a double send of the same answer, not a second retake.
    if (((claimed ?? []) as unknown[]).length !== 1) return failure("conflict", NOT_OPEN, RETAKE_NOT_OPEN_CODE);

    const question = row.question as string;
    let result: ReturnType<typeof parseRetakeContrast> = null;
    try {
        await recordChatEgress(db, {
            userId: args.userId,
            orgId: row.org_id,
            chatId: null,
            surface: "training_retake",
            resolved,
            extra: { retake_id: row.id, step: "contrast" },
        });
        const text = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: RETAKE_CONTRAST_SYSTEM_PROMPT,
            user: buildRetakeContrastPrompt({ question, answer: checked.answer, material: material.data.material }, promptNonce()),
            maxTokens: RETAKE_CONTRAST_MAX_TOKENS,
        });
        result = parseRetakeContrast(text, [question, checked.answer, ...materialTexts(material.data.material)]);
        if (!result) throw new Error("contrast without the required format");
    } catch (error) {
        console.warn("[training] retake contrast failed", {
            retakeId: row.id,
            reason: error instanceof Error ? error.name : "error",
        });
    }

    const at = new Date().toISOString();
    const { data, error } = await db
        .from("training_retakes")
        .update(
            result
                ? {
                      status: "answered",
                      answer: checked.answer,
                      contrast: result.contrast,
                      verdict: result.verdict,
                      answered_at: at,
                      updated_at: at,
                  }
                : // The answer is not kept: the person still has the question and may try again.
                  { status: "open", updated_at: at },
        )
        .eq("id", row.id)
        .eq("status", "pending")
        .select("*");
    if (error) return internalFailure(error);
    const final = ((data ?? []) as unknown as RetakeRow[])[0];
    if (!final) return internalFailure(new Error("retake settled elsewhere"));
    if (!result) return failure("unavailable", ANSWER_FAILED);
    await recordAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId: row.org_id,
        action: "training.retake_answered",
        surface: "organization",
        detail: { org_id: row.org_id, target_user_id: args.userId, retake_id: row.id },
    });
    return ok(serializeRetake(final));
}
