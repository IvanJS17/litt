// GET /training/me/supervision: what the caller's mentor sees of them in one
// organization (transparency, docs/training.md). Layer 2 fills the lists as
// its reviews, defenses and passes land; the gate is already the shared one.

import type { TrainingSupervision } from "@mike/contracts";
import { ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { assertLearningAccess } from "./trainingSupervision.access";
import { readUrgencyPasses } from "./trainingSupervision.passes";

export async function getMySupervision(
    db: Db,
    args: { userId: string; orgId: unknown },
): Promise<ServiceResult<TrainingSupervision>> {
    const access = await assertLearningAccess(db, {
        actorId: args.userId,
        orgId: args.orgId,
        traineeId: args.userId,
    });
    if (!access.ok) return access;
    const passes = await readUrgencyPasses(db, args.orgId as string, args.userId);
    if (!passes.ok) return passes;
    return ok({
        org_id: args.orgId as string,
        work_reviews: [],
        defenses: [],
        urgency_passes: passes.data,
    });
}
