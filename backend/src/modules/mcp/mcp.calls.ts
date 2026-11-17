// The record of tool calls: public.mcp_tool_calls (insert-only; the database
// refuses UPDATE and DELETE) and, for calls that write, spend or take text out
// of a document, one public.audit_events row with surface = 'mcp' (design §7.4).
//
// A row holds the tool's name, the connection, the person, the workspace, the
// outcome, an error code and the time it took. It has no field for the
// arguments or the result, so there is nowhere for a document, a key or a
// token to go.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { insertAuditEvent } from "../../lib/audit";
import { reportError } from "../../lib/observability/report";
import type { McpMode, McpPrincipal } from "./mcp.principal";

export const MCP_AUDIT_SURFACE = "mcp";

export type McpCallOutcome = "ok" | "error" | "denied" | "rate_limited";

export type McpCallRecord = {
    tool: string;
    grantId?: string | null;
    userId?: string | null;
    clientId?: string | null;
    workspace?: string | null;
    mode?: McpMode | null;
    outcome: McpCallOutcome;
    errorCode?: string | null;
    latencyMs?: number | null;
};

/** Never throws: a lost row is reported, and never changes the answer. */
export async function recordMcpToolCall(db: Db, call: McpCallRecord): Promise<void> {
    try {
        const { error } = await db.from("mcp_tool_calls").insert({
            tool: call.tool.slice(0, 120),
            grant_id: call.grantId ?? null,
            user_id: call.userId ?? null,
            client_id: call.clientId ?? null,
            workspace: call.workspace ?? null,
            mode: call.mode ?? null,
            outcome: call.outcome,
            error_code: call.errorCode?.slice(0, 80) ?? null,
            latency_ms: call.latencyMs === null || call.latencyMs === undefined ? null : Math.round(call.latencyMs),
        });
        if (error) throw new AppError("mcp.audit_write_failed", "[mcp] tool call insert failed", { cause: error });
    } catch (error) {
        reportError(error, { tags: { component: "mcp", operation: "mcp.tool_call_audit" } });
    }
}

/**
 * The audit_events row of a call that writes, spends or reads document text.
 * It THROWS: the caller writes it before running the tool, and with no way
 * to record the call the tool does not run (fail closed).
 */
export async function recordMcpAuditEvent(
    db: Db,
    args: { principal: McpPrincipal; tool: string; workspace: string | null },
): Promise<void> {
    await insertAuditEvent(db, {
        userId: args.principal.userId,
        orgId: args.workspace && args.workspace !== "personal" ? args.workspace : null,
        action: `mcp.${args.tool}`,
        surface: MCP_AUDIT_SURFACE,
        detail: {
            grant_id: args.principal.grantId,
            client_id: args.principal.clientId,
            workspace: args.workspace,
            mode: args.principal.mode,
        },
    });
}
