import type { TrainingBody } from "./types";

/**
 * What a request body says about training. The body may be anything: only the
 * fields this module knows are read, the rest is ignored.
 */
export function readTrainingBody(body: unknown): TrainingBody {
    const record =
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
    return {
        attempt: record.attempt,
        confidence: record.confidence,
        mode: record.training_mode,
        criteriaRoutes: record.criteria_routes,
        criteriaExplanation: record.criteria_explanation,
        divergence: null,
    };
}
