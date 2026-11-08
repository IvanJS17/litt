// The person's turn notes with the columns the map and the promotion evidence
// read (docs/training.md, layer 3): verdict, mark, topics and the hint trail,
// never the attempt or the contrast. One loader for the criterion module and
// for training-supervision; it lives in `lib/` (it reads the database and
// imports no module) so neither module imports the other.

import { internalFailure, ok, type ServiceResult } from "./serviceResult";
import type { Db } from "./supabase";
import type { EvidenceNote } from "./trainingMap";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "./trainingNotes";
import { WORK_SURFACES } from "./trainingWork";

/** The newest notes read; a person is nowhere near this many in practice. */
export const EVIDENCE_NOTES_LIMIT = 1000;

const COLUMNS =
    "id, chat_id, word_chat_id, tabular_chat_id, created_at, contrast_status, confidence, verdict, verdict_source, foundation, topics, answer_unverified, mode, step";

type StoredNote = {
    id: string;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
    created_at: string;
    contrast_status: string;
    confidence: number | null;
    verdict: EvidenceNote["verdict"];
    verdict_source: EvidenceNote["verdict_source"];
    foundation: EvidenceNote["foundation"];
    topics: string[] | null;
    answer_unverified: boolean | null;
    mode: string | null;
    step: number | null;
};

export type EvidenceRow = EvidenceNote & {
    surface: TurnNoteSurface;
    chat_id: string;
    step: number | null;
};

/** The person's notes in one organization with the columns the map reads, oldest first. */
export async function loadEvidenceNotes(
    db: Db,
    args: { orgId: string; traineeId: string },
): Promise<ServiceResult<EvidenceRow[]>> {
    const { data, error } = await db
        .from("training_turn_notes")
        .select(COLUMNS)
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.traineeId)
        .order("created_at", { ascending: false })
        .limit(EVIDENCE_NOTES_LIMIT);
    if (error) return internalFailure(error);
    const rows: EvidenceRow[] = [];
    for (const note of (data ?? []) as unknown as StoredNote[]) {
        const surface = WORK_SURFACES.find((candidate) => note[TURN_NOTE_CHAT_COLUMN[candidate] as "chat_id"] != null);
        if (!surface) continue;
        const chatId = note[TURN_NOTE_CHAT_COLUMN[surface] as "chat_id"] as string;
        rows.push({
            id: note.id,
            surface,
            chat_id: chatId,
            work: `${surface}:${chatId}`,
            created_at: note.created_at,
            contrast_status: note.contrast_status,
            confidence: note.confidence ?? null,
            verdict: note.verdict ?? null,
            verdict_source: note.verdict_source ?? null,
            foundation: note.foundation ?? null,
            topics: note.topics ?? null,
            answer_unverified: note.answer_unverified === true,
            mode: note.mode ?? null,
            step: note.step ?? null,
        });
    }
    return ok(rows.reverse());
}
