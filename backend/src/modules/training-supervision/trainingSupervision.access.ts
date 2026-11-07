// LiTT training layer 2: the one gate in front of learning data
// (docs/training.md). Reviews, defenses and urgency passes are readable and
// writable only by the pupil and their CURRENT mentor; the database decides
// it (training_can_read_learning, 20261107_60_litt_training_supervision.sql)
// and every service of this module asks it before touching a row. No role
// grants it: not an owner, not an admin, not a previous mentor. Anyone else,
// and any malformed id, gets the same 404, so an answer never tells "does not
// exist" from "not yours".

import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";

export const LEARNING_NOT_FOUND = "Training data not found";

export async function assertLearningAccess(
    db: Db,
    args: { actorId: string; orgId: unknown; traineeId: unknown },
): Promise<ServiceResult<null>> {
    const { actorId, orgId, traineeId } = args;
    // actorId is the authenticated user's id.
    if (typeof orgId !== "string" || !isUuid(orgId) || typeof traineeId !== "string" || !isUuid(traineeId))
        return failure("not_found", LEARNING_NOT_FOUND);
    const { data, error } = await db.rpc("training_can_read_learning", {
        p_actor: actorId,
        p_org: orgId,
        p_trainee: traineeId,
    });
    if (error) return internalFailure(error);
    if (data !== true) return failure("not_found", LEARNING_NOT_FOUND);
    return ok(null);
}
