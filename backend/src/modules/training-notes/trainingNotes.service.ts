// LiTT training notes: reading a pasante's private notes (docs/training.md).
//
// The notes are written next to the chat turn (lib/trainingNotes.ts); this
// module only exposes them. A note is readable by its author and by the
// author's CURRENT mentor (training_pupils), nobody else: not the chat's other
// participants, not an owner or admin, not a previous mentor. A mentor reads
// the notes of a chat inside a matter only while they can open that matter,
// as with the layer-2 reviews (lib/trainingWork.ts). Anyone else, and any id
// that is not a chat with such notes, gets the same 404.

import type { TrainingTurnNote, TrainingTurnNotes } from "@mike/contracts";
import {
    effectiveContrastStatus,
    TURN_NOTE_CHAT_COLUMN,
    type TurnNoteSurface,
} from "../../lib/trainingNotes";
import {
    effectiveVerdict,
    rightForTheWrongReason,
    type TrainingFoundation,
    type TrainingVerdict,
    type TrainingVerdictSource,
} from "../../lib/trainingVerdict";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { mayOpenWorkMatter, workPlace } from "../../lib/trainingWork";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";

const NOT_FOUND = "Training notes not found";

type NoteRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    message_id: string;
    attempt: string;
    contrast: string | null;
    contrast_status: string;
    created_at: string;
    // Layer 3; absent or null on older notes.
    confidence?: number | null;
    verdict?: TrainingVerdict | null;
    verdict_source?: TrainingVerdictSource | null;
    foundation?: TrainingFoundation | null;
    foundation_question?: string | null;
    topics?: string[] | null;
    answer_unverified?: boolean | null;
    mode?: string | null;
    step?: number | null;
} & Partial<Record<(typeof TURN_NOTE_CHAT_COLUMN)[TurnNoteSurface], string | null>>;

/** The notes of one chat the actor may read; 404 when there are none. */
export async function getChatTurnNotes(
    db: Db,
    args: { actorId: string; actorEmail?: string | null; chatId: string; messageId?: string | null },
): Promise<ServiceResult<TrainingTurnNotes>> {
    const { actorId, chatId } = args;
    if (!isUuid(chatId) || (args.messageId != null && !isUuid(args.messageId)))
        return failure("not_found", NOT_FOUND);

    const rows: NoteRow[] = [];
    let surface: TurnNoteSurface | null = null;
    for (const [candidate, column] of Object.entries(TURN_NOTE_CHAT_COLUMN) as [TurnNoteSurface, string][]) {
        let query = db
            .from("training_turn_notes")
            .select("*")
            .eq(column, chatId);
        if (args.messageId) query = query.eq("message_id", args.messageId);
        const { data, error } = await query;
        if (error) return internalFailure(error);
        const found = (data ?? []) as unknown as NoteRow[];
        if (found.length > 0) surface = candidate;
        rows.push(...found);
    }

    // Whose notes the actor mentors right now, per organization, and only
    // inside a matter the actor can open.
    const foreign = rows.filter((row) => row.trainee_user_id !== actorId);
    const mentored = new Set<string>();
    let matterOpen = true;
    if (foreign.length > 0 && surface) {
        const place = await workPlace(db, surface, chatId);
        if (!place.ok) return internalFailure(place.error);
        matterOpen =
            !!place.place &&
            (await mayOpenWorkMatter(db, {
                projectId: place.place.projectId,
                actorId,
                actorEmail: args.actorEmail ?? null,
            }));
    }
    if (foreign.length > 0 && matterOpen) {
        const { data, error } = await db
            .from("training_pupils")
            .select("org_id, trainee_user_id")
            .eq("mentor_user_id", actorId)
            .in("trainee_user_id", [...new Set(foreign.map((row) => row.trainee_user_id))]);
        if (error) return internalFailure(error);
        for (const pupil of (data ?? []) as { org_id: string; trainee_user_id: string }[])
            mentored.add(`${pupil.org_id}:${pupil.trainee_user_id}`);
    }

    const now = Date.now();
    const notes: TrainingTurnNote[] = rows
        .filter(
            (row) =>
                row.trainee_user_id === actorId ||
                mentored.has(`${row.org_id}:${row.trainee_user_id}`),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((row) => ({
            id: row.id,
            org_id: row.org_id,
            trainee_user_id: row.trainee_user_id,
            chat_id: chatId,
            message_id: row.message_id,
            attempt: row.attempt,
            contrast: row.contrast_status === "ready" ? row.contrast : null,
            contrast_status: effectiveContrastStatus(row.contrast_status, row.created_at, now),
            created_at: row.created_at,
            ...criterionFields(row),
        }));
    if (notes.length === 0) return failure("not_found", NOT_FOUND);
    return ok({ notes });
}

/**
 * The layer-3 fields of a note. A note of layers 1 and 2 has all of them
 * null and reads as before (they are simply absent from the response).
 */
function criterionFields(row: NoteRow): Partial<TrainingTurnNote> {
    if (
        row.confidence == null &&
        row.verdict == null &&
        row.foundation == null &&
        !row.answer_unverified &&
        !row.topics &&
        !row.mode
    )
        return {};
    const judged = {
        verdict: row.verdict ?? null,
        verdict_source: row.verdict_source ?? null,
        foundation: row.foundation ?? null,
    };
    return {
        confidence: (row.confidence as TrainingTurnNote["confidence"]) ?? null,
        ...judged,
        effective_verdict: effectiveVerdict(judged),
        right_for_wrong_reason: rightForTheWrongReason(judged),
        foundation_question: row.foundation_question ?? null,
        topics: row.topics ?? null,
        answer_unverified: row.answer_unverified === true,
        // Hints and counterpart turns (card 6).
        mode: (row.mode as TrainingTurnNote["mode"]) ?? null,
        step: (row.step as TrainingTurnNote["step"]) ?? null,
    };
}
