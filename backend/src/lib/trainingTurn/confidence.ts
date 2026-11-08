// The thermometer (docs/training.md): a pasante marks how sure they are of
// their approach before asking, on four named levels (1 «casi adivino» to
// 4 «seguro»). One mark per approach, not per conclusion: the approach is two
// or three lines and usually holds one thesis.
//
// The mark is required exactly when the turn owes an approach (a pasante
// without an urgency pass); anybody else's `confidence` is ignored, like
// their `attempt`. It is stored with the private note and never leaves it.

import type { TrainingBehavior, TrainingConfidence, TrainingTurnFailure } from "./types";

export const TRAINING_CONFIDENCE_REQUIRED_CODE = "training_confidence_required";

/** An integer from 1 to 4. A string, a float or a boolean is not a mark. */
export function readConfidence(value: unknown): TrainingConfidence | null {
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

const REQUIRED: TrainingTurnFailure = {
    ok: false,
    status: 400,
    code: TRAINING_CONFIDENCE_REQUIRED_CODE,
    detail: "Marca qué tan seguro estás de tu planteamiento antes de preguntar. Si no ves la escala, recarga la página.",
};

export const confidenceBehavior: TrainingBehavior = (resolved, plan) => {
    // No approach owed (no stage, a junior, an urgency pass): no mark either.
    // Turns that carry no approach to rate, such as a hint, will be exempt
    // here too once they exist.
    if (!plan.attempt) return plan;
    const confidence = readConfidence(resolved.body.confidence);
    return confidence ? { ...plan, confidence } : REQUIRED;
};
