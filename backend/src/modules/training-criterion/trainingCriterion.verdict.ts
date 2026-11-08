// LiTT training layer 3 «Criterio»: the mentor corrects the verdict of a turn
// (docs/training.md).
//
// The contrast of a turn compares the pasante's approach with the AI's own
// answer, which may be wrong, so the pupil's CURRENT mentor can overrule its
// verdict, turn by turn. What the mentor sets is stored as the mentor's
// (verdict_source = 'mentor', verdict_by) and counts as written. Only the
// current mentor, only for a turn of a work in a matter they can open, and
// every other case, including a note that does not exist, is the same 404 as
// the rest of the learning data. The audit gets who and which chat, never the
// verdict: that is learning data and stays with the pupil's note.

import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "../../lib/trainingNotes";
import { mayOpenWorkMatter, workPlace } from "../../lib/trainingWork";
import { effectiveVerdict, isTrainingVerdict, type TrainingVerdict } from "../../lib/trainingVerdict";
import { isUuid } from "../../lib/uuid";
import { assertCurrentMentor, LEARNING_NOT_FOUND } from "../training-supervision/trainingSupervision.service";

export const NOTE_NOT_JUDGEABLE_CODE = "training_note_not_judgeable";
const NOT_JUDGEABLE = "This turn has nothing to judge.";

type NoteRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    contrast_status: string;
    mode: string | null;
    foundation: "solid" | "weak" | "wrong" | null;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
};

export type VerdictOverrideResult = {
    id: string;
    verdict: TrainingVerdict;
    verdict_source: "mentor";
    effective_verdict: TrainingVerdict;
};

export async function overrideNoteVerdict(
    db: Db,
    args: {
        actorId: string;
        actorEmail?: string | null;
        orgId: unknown;
        traineeId: unknown;
        noteId: unknown;
        body: unknown;
    },
): Promise<ServiceResult<VerdictOverrideResult>> {
    const mentor = await assertCurrentMentor(db, args);
    if (!mentor.ok) return mentor;
    const { orgId, traineeId } = mentor.data;
    const notFound = () => failure("not_found", LEARNING_NOT_FOUND);
    if (typeof args.noteId !== "string" || !isUuid(args.noteId)) return notFound();

    const { data, error } = await db
        .from("training_turn_notes")
        .select("id, org_id, trainee_user_id, contrast_status, mode, foundation, chat_id, word_chat_id, tabular_chat_id")
        .eq("id", args.noteId)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const note = data as NoteRow | null;
    if (!note) return notFound();

    // The mentor reads a work done inside a matter only while they can open it.
    const surface = (Object.keys(TURN_NOTE_CHAT_COLUMN) as TurnNoteSurface[]).find(
        (candidate) => note[TURN_NOTE_CHAT_COLUMN[candidate] as "chat_id"] != null,
    );
    const chatId = surface ? (note[TURN_NOTE_CHAT_COLUMN[surface] as "chat_id"] as string) : null;
    if (!surface || !chatId) return notFound();
    const place = await workPlace(db, surface, chatId);
    if (!place.ok) return internalFailure(place.error);
    if (
        !place.place ||
        !(await mayOpenWorkMatter(db, {
            projectId: place.place.projectId,
            actorId: args.actorId,
            actorEmail: args.actorEmail ?? null,
        }))
    )
        return notFound();

    const verdict = (args.body as { verdict?: unknown } | null | undefined)?.verdict;
    if (!isTrainingVerdict(verdict))
        return failure("validation", "verdict must be coincide, parcial or no_coincide.");
    // A hint has no answer to compare with.
    if (note.contrast_status === "skipped" || note.mode === "hint")
        return failure("conflict", NOT_JUDGEABLE, NOTE_NOT_JUDGEABLE_CODE);

    const { data: updated, error: updateError } = await db
        .from("training_turn_notes")
        .update({ verdict, verdict_source: "mentor", verdict_by: args.actorId })
        .eq("id", note.id)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .select("id");
    if (updateError) return internalFailure(updateError);
    if (((updated ?? []) as unknown[]).length === 0) return notFound();

    await recordAudit(db, {
        userId: args.actorId,
        userEmail: args.actorEmail ?? null,
        orgId,
        action: "training.verdict_overridden",
        surface: "organization",
        chatId,
        detail: { org_id: orgId, target_user_id: traineeId },
    });
    return ok({
        id: note.id,
        verdict,
        verdict_source: "mentor",
        effective_verdict: effectiveVerdict({ verdict, verdict_source: "mentor", foundation: note.foundation })!,
    });
}
