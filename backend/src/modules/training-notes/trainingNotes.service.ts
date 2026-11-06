// LiTT training notes: reading a pasante's private notes (docs/training.md).
//
// The notes are written next to the chat turn (lib/trainingNotes.ts); this
// module only exposes them. A note is readable by its author and by the
// author's CURRENT mentor (training_pupils), nobody else: not the chat's other
// participants, not an owner or admin, not a previous mentor. Anyone else, and
// any id that is not a chat with such notes, gets the same 404.

import type { TrainingTurnNote, TrainingTurnNotes } from "@mike/contracts";
import {
    effectiveContrastStatus,
    TURN_NOTE_CHAT_COLUMN,
    type TurnNoteSurface,
} from "../../lib/trainingNotes";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
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
} & Partial<Record<(typeof TURN_NOTE_CHAT_COLUMN)[TurnNoteSurface], string | null>>;

/** The notes of one chat the actor may read; 404 when there are none. */
export async function getChatTurnNotes(
    db: Db,
    args: { actorId: string; chatId: string; messageId?: string | null },
): Promise<ServiceResult<TrainingTurnNotes>> {
    const { actorId, chatId } = args;
    if (!isUuid(chatId) || (args.messageId != null && !isUuid(args.messageId)))
        return failure("not_found", NOT_FOUND);

    const rows: NoteRow[] = [];
    for (const column of Object.values(TURN_NOTE_CHAT_COLUMN)) {
        let query = db
            .from("training_turn_notes")
            .select("*")
            .eq(column, chatId);
        if (args.messageId) query = query.eq("message_id", args.messageId);
        const { data, error } = await query;
        if (error) return internalFailure(error);
        rows.push(...((data ?? []) as unknown as NoteRow[]));
    }

    // Whose notes the actor mentors right now, per organization.
    const foreign = rows.filter((row) => row.trainee_user_id !== actorId);
    const mentored = new Set<string>();
    if (foreign.length > 0) {
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
        }));
    if (notes.length === 0) return failure("not_found", NOT_FOUND);
    return ok({ notes });
}
