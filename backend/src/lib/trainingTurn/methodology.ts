// A junior's turn is offered the methodology calculator (compute_methodology):
// the model does no legal-financial arithmetic in prose for someone who is
// already working unsealed. It changes what the model can call, never what
// the person can open, so it is a tool policy and not a permission.

import type { TrainingTurnPlan } from "./types";

/** Offered to the junior stage only; a pasante, an unstaged turn and any other author get nothing. */
export function methodologyBehavior(
    resolved: { stage: TrainingTurnPlan["stage"]; passActive: boolean },
    plan: TrainingTurnPlan,
): TrainingTurnPlan {
    if (resolved.stage !== "junior" || resolved.passActive) return plan;
    return { ...plan, toolPolicy: { ...plan.toolPolicy, methodology: true } };
}
