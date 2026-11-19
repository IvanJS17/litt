/**
 * People in training cannot request or decide AI rule suggestions (S8a) or AI
 * rule proposals (S8b): deciding which legal terms apply to a client is the
 * judgment of a responsible lawyer (docs/obligation-rules.md, docs/training.md).
 * They still see the radar and the results, read-only.
 *
 * "In training" is the one definition of the training module:
 * resolveTrainingStage returns a stage (pasante or junior) for the person in
 * the organization and project. There is no second definition here.
 */

import { resolveTrainingStage } from "../../lib/training";
import { failure, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

export const RULE_SUGGESTIONS_TRAINEE_CODE = "rule_suggestions_trainee";

/** True when the person has a training stage in that organization and project. A read failure throws. */
export async function isTraineeIn(db: Db, userId: string, orgId: string, projectId: string): Promise<boolean> {
  return (await resolveTrainingStage(db, userId, { orgId, projectId })) !== null;
}

/**
 * The refusal for a trainee, or null. Called right after the access check and
 * before any route, record or model call.
 */
export async function refuseTrainee(
  db: Db,
  userId: string,
  orgId: string,
  projectId: string,
): Promise<ServiceResult<never> | null> {
  if (!(await isTraineeIn(db, userId, orgId, projectId))) return null;
  return failure("forbidden", "People in training cannot request or decide rule suggestions.", RULE_SUGGESTIONS_TRAINEE_CODE);
}
