// The mentor's side of the periodic full reading (docs/training.md, layer 3):
// the pupil's CURRENT mentor reads the pupil's readings (assertCurrentMentor;
// anyone else, an owner and an admin included, gets the uniform 404). A
// reading of a document in a matter the mentor cannot open is only counted,
// never shown: the findings come from the client's document, so they keep that
// matter's confidentiality (the same rule as a work's notes).

import type { TrainingPupilReadings } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { openableWorkMatters } from "../../lib/trainingWork";
import { assertCurrentMentor } from "../training-supervision/trainingSupervision.service";
import { readReadings, serializeReading } from "./trainingFullReading.rows";

/** GET /orgs/:orgId/training/pupils/:userId/readings */
export async function listPupilReadings(
    db: Db,
    actor: { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown },
): Promise<ServiceResult<TrainingPupilReadings>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const rows = await readReadings(db, orgId, traineeId);
    if (!rows.ok) return rows;
    const projectIds = [...new Set(rows.data.map((row) => row.project_id).filter((id): id is string => !!id))];
    let openable = new Set<string>();
    try {
        if (projectIds.length > 0)
            openable = await openableWorkMatters(db, { projectIds, actorId: actor.actorId, actorEmail: actor.actorEmail });
    } catch (error) {
        return internalFailure(error);
    }
    const visible = rows.data.filter((row) => !row.project_id || openable.has(row.project_id));
    const now = Date.now();
    return ok({
        org_id: orgId,
        trainee_user_id: traineeId,
        readings: visible.map((row) => serializeReading(row, now)),
        readings_without_access: rows.data.length - visible.length,
    });
}
