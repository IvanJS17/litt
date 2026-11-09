// What the map and the calibration are computed from (docs/training.md,
// layer 3): the columns of the person's turn notes that carry a verdict, a
// mark, topics and the hint trail, and their answered retakes. Never the
// attempt or the contrast: those are read only for the few notes a retake
// rests on (trainingCriterion.retakes.ts).

import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import type { TurnNoteSurface } from "../../lib/trainingNotes";
import { openableWorkMatters, workPlace } from "../../lib/trainingWork";
import type { EvidenceRow } from "../../lib/trainingEvidenceNotes";

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
