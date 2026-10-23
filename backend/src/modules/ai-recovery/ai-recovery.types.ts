/**
 * Shared shapes of the AI evidence module.
 *
 * Only the two values that cross every topic file live here: one execution's
 * evidence bundle and its canonical receipt. Both are defined by the reviewed
 * `lib/recovery` contracts; this module never redefines their fields.
 */

import type { CanonicalEvidenceReceipt } from "../../lib/recovery/evidence/appendOnlyEvidence";
import type { HumanReviewExecution } from "../../lib/recovery/review/humanReview";

export type EvidenceReceipt = CanonicalEvidenceReceipt;

export type AiExecutionEvidence = {
  execution: HumanReviewExecution;
  evidence_receipt: EvidenceReceipt;
};
