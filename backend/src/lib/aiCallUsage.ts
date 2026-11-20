// Tokens and engine of every AI call the retainer flows make (Donna triage,
// slice T1; docs/ai-call-usage.md). One insert-only row per call in
// `ai_call_usage`: who, where, which route and how many tokens. No prompt, no
// answer, no quote, no key.
//
// Recording is never part of the call: a failed write leaves one static
// `[report]` line and the answer goes on unchanged.
import { AppError } from "./appError";
import type { CompletionUsage } from "./llm/types";
import { reportError } from "./observability/report";
import type { Db } from "./supabase";

export type AiEngine = "byok" | "jev";

/**
 * Price of one million tokens, per provider and model, in US dollars. The
 * repo holds no such table for language models, so cost stays null for BYOK
 * calls; add an entry here (and only here) when one is published and checked.
 * Jev's price is fixed and public: US$0.042 per million INPUT tokens, output
 * free (https://docs.typesafe.ai/models.md).
 */
const JEV_USD_PER_MILLION_INPUT = 0.042;

export function estimateCostUsd(
    engine: AiEngine,
    usage: CompletionUsage,
): number | null {
    if (engine !== "jev" || usage.inputTokens === null) return null;
    return Math.round(usage.inputTokens * JEV_USD_PER_MILLION_INPUT * 100) / 100_000_000;
}

export type AiCallScope = {
    surface: string;
    engine?: AiEngine;
    userId: string | null;
    orgId: string | null;
    matterId?: string | null;
    projectId?: string | null;
    provider: string;
    model: string;
};

function count(value: number | null): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Write the row. Never throws. */
export async function recordAiCallUsage(
    db: Db,
    scope: AiCallScope,
    usage: CompletionUsage,
): Promise<void> {
    const engine = scope.engine ?? "byok";
    try {
        const { error } = await db.from("ai_call_usage").insert({
            org_id: scope.orgId,
            user_id: scope.userId,
            matter_id: scope.matterId ?? null,
            project_id: scope.projectId ?? null,
            surface: scope.surface,
            engine,
            provider: scope.provider,
            model: scope.model,
            input_tokens: count(usage.inputTokens),
            output_tokens: count(usage.outputTokens),
            cost_usd: estimateCostUsd(engine, usage),
        });
        if (error) throw error;
    } catch {
        reportError(new AppError("ai_call_usage.write_failed", "[ai-usage] could not record a call"), {
            tags: { operation: "ai_call_usage.record" },
            level: "warning",
        });
    }
}

type Completion<P extends { onUsage?: (usage: CompletionUsage) => void }> = (params: P) => Promise<string>;

/**
 * `complete` with the call's usage recorded once it answered. A call that
 * fails records nothing (the provider reported nothing to record). The
 * returned function takes the same parameters.
 */
export function meteredCompletion<P extends { onUsage?: (usage: CompletionUsage) => void }>(
    db: Db,
    scope: AiCallScope,
    complete: Completion<P>,
): Completion<P> {
    return async (params) => {
        let usage: CompletionUsage = { inputTokens: null, outputTokens: null };
        const answer = await complete({
            ...params,
            onUsage: (reported) => {
                usage = reported;
            },
        });
        await recordAiCallUsage(db, scope, usage);
        return answer;
    };
}
