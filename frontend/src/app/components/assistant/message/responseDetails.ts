import { modelDisplayName } from "@mike/client";
import { REASONING_LEVEL_LABEL_KEYS, REASONING_LEVELS } from "@mike/ui";
import type { DateFormatter } from "@/app/lib/dateText";
import type { AppTranslate } from "@/i18n/Translate";
import type { AssistantEvent } from "../../shared/types";

/**
 * What a run used, as "Model (reasoning): tokens", shown under a response and
 * in a subagent's details when Settings > Features > Response details is on.
 * A subagent adds the token budget its effort allowed.
 */

type Usage = { input_tokens: number; output_tokens: number };
type ResponseDetailsEvent = Extract<AssistantEvent, { type: "response_details" }>;
type DelegationEvent = Extract<AssistantEvent, { type: "delegation" }>;

/** The language and the number format of the screen the text is shown in. */
type Text = { t: AppTranslate; format: DateFormatter };

const compact = ({ format }: Text, value: number) =>
    format.number(value, { notation: "compact" });

function reasoningLabel(text: Text, level: string | undefined): string | null {
    const known = REASONING_LEVELS.find((l) => l === level);
    if (!known) return null;
    return known === "none"
        ? text.t("assistant.responseDetails.noReasoning")
        : text.t(REASONING_LEVEL_LABEL_KEYS[known]);
}

function runText(text: Text, run: {
    model?: string;
    reasoning?: string;
    usage?: Usage;
    budget?: number;
}): string {
    if (!run.model) return "";
    const reasoning = reasoningLabel(text, run.reasoning);
    // Non-breaking spaces keep "304K tokens" and "(2.5M budget allocated)"
    // whole, so a narrow line wraps between the parts rather than inside one.
    const tokens = run.usage
        ? text.t("assistant.responseDetails.tokens", {
              count: compact(text, run.usage.input_tokens + run.usage.output_tokens),
          })
        : "";
    const budget = run.budget
        ? text.t("assistant.responseDetails.budgetAllocated", {
              count: compact(text, run.budget),
          })
        : "";
    return `${modelDisplayName(run.model)}${reasoning ? ` (${reasoning})` : ""}${tokens}${budget}`;
}

/**
 * Mike's own answer: "Gemini 3.8 Flash (High): 190K tokens". With subagents,
 * what they used between them follows as its own total, since they may have
 * run on other models: "Main: Gemini 3.8 Flash (High): 190K tokens.
 * Subagents total: 608K tokens."
 */
export function responseDetailsText(
    text: Text,
    event: ResponseDetailsEvent,
    subagents?: Usage | null,
): string {
    if (!subagents) return runText(text, event);
    const total = compact(text, subagents.input_tokens + subagents.output_tokens);
    return text.t("assistant.responseDetails.mainAndSubagents", {
        main: runText(text, event),
        total,
    });
}

/** The tokens every subagent in an answer used, or null when none reported any. */
export function subagentUsage(events: AssistantEvent[]): Usage | null {
    const reported = events.flatMap((event) =>
        event.type === "delegation" && event.usage ? [event.usage] : [],
    );
    if (reported.length === 0) return null;
    return {
        input_tokens: reported.reduce((sum, usage) => sum + usage.input_tokens, 0),
        output_tokens: reported.reduce((sum, usage) => sum + usage.output_tokens, 0),
    };
}

/** A subagent: "Claude Haiku 4.5 (Low): 30K tokens (600K budget allocated)". */
export function subagentDetailsText(text: Text, event: DelegationEvent): string {
    return runText(text, { ...event, budget: event.token_budget });
}
