// What the map and the calibration are computed from (docs/training.md,
// layer 3): the columns of the person's turn notes that carry a verdict, a
// mark, topics and the hint trail, and their answered retakes. Never the
// attempt or the contrast: those are read only for the few notes a retake
// rests on (trainingCriterion.retakes.ts).

import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "../../lib/trainingNotes";
import type { EvidenceNote } from "../../lib/trainingMap";
import { openableWorkMatters, WORK_SURFACES, workPlace } from "../../lib/trainingWork";

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

/**
 * Of `rows`, those of works in matters the actor may open (a Word chat, or a
 * chat outside a project, has no matter), and how many were left out. A
 * mentor reads a work done inside a matter only while they can open it.
 */
export async function visibleToMentor(
    db: Db,
    rows: readonly EvidenceRow[],
    actor: { actorId: string; actorEmail: string | null },
): Promise<ServiceResult<{ rows: EvidenceRow[]; withoutAccess: number }>> {
    const works = new Map<string, { surface: TurnNoteSurface; chatId: string }>();
    for (const row of rows) works.set(row.work, { surface: row.surface, chatId: row.chat_id });
    const projectOf = new Map<string, string | null | undefined>();
    for (const [key, work] of works) {
        const place = await workPlace(db, work.surface, work.chatId);
        if (!place.ok) return internalFailure(place.error);
        // undefined: the work's chat is gone; nothing to show.
        projectOf.set(key, place.place ? place.place.projectId : undefined);
    }
    const projectIds = [...new Set([...projectOf.values()].filter((id): id is string => typeof id === "string"))];
    let openable = new Set<string>();
    try {
        if (projectIds.length > 0)
            openable = await openableWorkMatters(db, { projectIds, actorId: actor.actorId, actorEmail: actor.actorEmail });
    } catch (error) {
        return internalFailure(error);
    }
    const visible = rows.filter((row) => {
        const project = projectOf.get(row.work);
        return project === null || (typeof project === "string" && openable.has(project));
    });
    return ok({ rows: visible, withoutAccess: rows.length - visible.length });
}
