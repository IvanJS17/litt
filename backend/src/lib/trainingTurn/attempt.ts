// "Tu turno primero": a pasante's turn carries their own approach first,
// unless an urgency pass lifts the requirement (docs/training.md).

import { checkTrainingTurn } from "../training";
import type { TrainingStage } from "@mike/contracts";
import type { TrainingTurnFailure } from "./types";

/**
 * The attempt a turn carries given the stage the turn check applies (none
 * while a pass is in force), or the 400 that refuses it.
 */
export function applyAttempt(
    effectiveStage: TrainingStage | null,
    attempt: unknown,
): { ok: true; attempt: string | null } | TrainingTurnFailure {
    return checkTrainingTurn(effectiveStage, attempt);
}
