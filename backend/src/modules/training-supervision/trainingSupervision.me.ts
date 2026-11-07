// GET /training/me/supervision: what the caller's mentor sees of them in one
// organization (transparency, docs/training.md): their work reviews today;
// defenses and urgency passes join as their cards land. Same gate as the
// mentor's routes.

import type { TrainingSupervision } from "@mike/contracts";
import { ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { assertLearningAccess } from "./trainingSupervision.access";
import { readUrgencyPasses } from "./trainingSupervision.passes";
import { listOwnReviews } from "./trainingSupervision.reviews";

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
    const orgId = args.orgId as string;
    const reviews = await listOwnReviews(db, { orgId, traineeId: args.userId });
    if (!reviews.ok) return reviews;
    const passes = await readUrgencyPasses(db, orgId, args.userId);
    if (!passes.ok) return passes;
    return ok({
        org_id: orgId,
        work_reviews: reviews.data,
        defenses: [],
        urgency_passes: passes.data,
    });
}
