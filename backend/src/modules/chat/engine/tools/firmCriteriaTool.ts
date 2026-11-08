// list_firm_criteria: the firm's own written positions on a subject
// (LiTT training layer 3, docs/training.md, "One mold of criterion").
//
// It is advertised only in a trainee's turn (the training plan names the
// organization), it reads with the caller's own membership, and it calls no
// model. The server emits the criteria EXACTLY as stored, with author and
// date, in a firm_criteria event the screen shows under the answer; so "who
// said so" never depends on what the model writes. A criterion is a position
// a person of the firm wrote: it carries no legal authority.

import type { FirmCriteriaEvent } from "@mike/contracts";
import { randomBytes } from "node:crypto";
import { getOrgRole } from "../../../../lib/access";
import {
    FIRM_CRITERIA_CONSULT_MAX,
    loadFirmCriteria,
    selectFirmCriteria,
    toFirmCriterionSnapshots,
} from "../../../../lib/firmCriteria";
import type { NormalizedToolCall } from "../../../../lib/llm";
import { safeError } from "../../../../lib/safeError";
import type { Db } from "../../../../lib/supabase";
import { spotlight } from "../contextBuilders";

export const FIRM_CRITERIA_TOOL_NAME = "list_firm_criteria";

export const FIRM_CRITERIA_TOOL = {
    type: "function",
    function: {
        name: FIRM_CRITERIA_TOOL_NAME,
        description:
            `List what people of the firm wrote as their position (criteria and dissenting opinions) on a practice area and topic. Returns at most ${FIRM_CRITERIA_CONSULT_MAX}, each with its author and date. Use it when the question touches a subject the firm may have a position on. Name the author when you use one; never present it as the only position or as binding law.`,
        parameters: {
            type: "object",
            properties: {
                practice: {
                    type: "string",
                    description: "The practice area, for example 'civil' or 'mercantil'. Optional.",
                },
                topic: {
                    type: "string",
                    description: "The subject, in a few words. Optional; without it the most recent come first.",
                },
            },
        },
    },
} as const;

const FAILED = "The firm's criteria could not be consulted.";

function argument(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

export async function runFirmCriteriaCall(
    call: NormalizedToolCall,
    ctx: { db: Db; userId: string; orgId: string; nonce?: string },
): Promise<{ content: string; event: FirmCriteriaEvent }> {
    const practice = argument(call.input.practice);
    const topic = argument(call.input.topic);
    const base = { type: "firm_criteria" as const, call_id: call.id, practice, topic };
    try {
        // The organization comes from the training plan; membership is still the caller's own.
        if (!(await getOrgRole(ctx.userId, ctx.orgId, ctx.db))) throw new Error("not a member");
        const picked = selectFirmCriteria(await loadFirmCriteria(ctx.db, ctx.orgId), { practice, topic });
        const criteria = await toFirmCriterionSnapshots(ctx.db, picked.rows);
        const nonce = ctx.nonce ?? randomBytes(16).toString("hex");
        const content = JSON.stringify({
            note: "Positions written by people of the firm, not law. Say who wrote each one you use.",
            criteria: criteria.map((criterion) => ({
                kind: criterion.kind,
                practice: criterion.practice,
                topic: criterion.topic,
                position: spotlight(criterion.position, nonce),
                author: criterion.author_name ?? "a user who no longer has an account",
                written: criterion.created_at.slice(0, 10),
                changed: criterion.updated_at.slice(0, 10),
                ...(criterion.rule_id ? { disagrees_with_playbook_rule: criterion.rule_id } : {}),
            })),
            ...(picked.truncated ? { more_exist: true } : {}),
            ...(criteria.length === 0 ? { result: "The firm has written nothing on this." } : {}),
        });
        return { content, event: { ...base, criteria, truncated: picked.truncated } };
    } catch (error) {
        console.warn("[run_tools] list_firm_criteria failed", safeError(error));
        return {
            content: JSON.stringify({ error: FAILED }),
            event: { ...base, criteria: [], truncated: false, error: FAILED },
        };
    }
}
