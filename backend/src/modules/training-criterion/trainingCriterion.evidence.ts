// What the map and the calibration are computed from (docs/training.md,
// layer 3): the columns of the person's turn notes that carry a verdict, a
// mark, topics and the hint trail, and their answered retakes. Never the
// attempt or the contrast: those are read only for the few notes a retake
// rests on (trainingCriterion.retakes.ts).

import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { judgeWorks, type WorkReader } from "../../lib/trainingWork";
import type { EvidenceRow } from "../../lib/trainingEvidenceNotes";

/**
 * Of `rows`, those of works the reader may see now (a matter they can open;
 * for a Word chat, sources they can open: lib/trainingWork decides), and how
 * many were left out. It serves the mentor and the person alike.
 */
export async function visibleEvidence(
    db: Db,
    rows: readonly EvidenceRow[],
    reader: WorkReader,
): Promise<ServiceResult<{ rows: EvidenceRow[]; withoutAccess: number }>> {
    let sights: Awaited<ReturnType<typeof judgeWorks>>;
    try {
        sights = await judgeWorks(db, rows.map((row) => ({ surface: row.surface, chatId: row.chat_id })), reader);
    } catch (error) {
        return internalFailure(error);
    }
    const visible = rows.filter((row) => sights.get(row.work)?.open === true);
    return ok({ rows: visible, withoutAccess: rows.length - visible.length });
}
