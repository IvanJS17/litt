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
    args: {
        principal: McpPrincipal;
        tool: string;
        workspace: string | null;
        /** Ids of what the call touches (never names, text or arguments), as `authoriseAuditRefs` cut them down. */
        refs?: AuthorisedAuditRefs;
    },
): Promise<void> {
    await insertAuditEvent(db, {
        userId: args.principal.userId,
        orgId: args.workspace && args.workspace !== "personal" ? args.workspace : null,
        action: `mcp.${args.tool}`,
        surface: MCP_AUDIT_SURFACE,
        projectId: args.refs?.projectId ?? null,
        documentId: args.refs?.documentId ?? null,
        chatId: args.refs?.chatId ?? null,
        detail: {
            grant_id: args.principal.grantId,
            client_id: args.principal.clientId,
            workspace: args.workspace,
            mode: args.principal.mode,
            // Which kinds of reference were left out (never their ids).
            ...(args.refs?.dropped.length ? { refs_dropped: args.refs.dropped } : {}),
            ...(args.refs?.versionId ? { version_id: args.refs.versionId } : {}),
            ...(args.refs?.playbookId ? { playbook_id: args.refs.playbookId } : {}),
            ...(args.refs?.workflowId ? { workflow_id: args.refs.workflowId } : {}),
            ...(args.refs?.reviewId ? { review_id: args.refs.reviewId } : {}),
        },
    });
}

/** What a strict call refers to: ids only. */
export type McpAuditRefs = {
    projectId?: string | null;
    documentId?: string | null;
    chatId?: string | null;
    versionId?: string | null;
    playbookId?: string | null;
    workflowId?: string | null;
    reviewId?: string | null;
};

/**
 * Refs that `authoriseAuditRefs` (mcp.auditRefs.ts) has checked against the
 * person, the connection and the call's workspace. The mark is not exported,
 * so plain refs do not type-check as these: short of a cast, only that
 * function makes one.
 */
declare const authorised: unique symbol;
export type AuthorisedAuditRefs = McpAuditRefs & {
    readonly [authorised]: true;
    /** The kinds (`matter`, `document`, `conversation`) whose id was left out. */
    readonly dropped: readonly string[];
};

/**
 * Document text left LiTT for the client's AI (design §7.4): which document and
 * version, how many characters, to which client. It THROWS, and the tool
 * writes it before the text is returned, so text never leaves unrecorded.
 */
export async function recordMcpEgress(
    db: Db,
    args: {
        principal: McpPrincipal;
        workspace: string | null;
        documentId: string;
        versionId: string;
        characters: number;
    },
): Promise<void> {
    await insertAuditEvent(db, {
        userId: args.principal.userId,
        orgId: args.workspace && args.workspace !== "personal" ? args.workspace : null,
        action: "mcp.client_ai_egress",
        surface: MCP_AUDIT_SURFACE,
        documentId: args.documentId,
        detail: {
            grant_id: args.principal.grantId,
            client_id: args.principal.clientId,
            workspace: args.workspace,
            version_id: args.versionId,
            characters: args.characters,
        },
    });
}

/**
 * A reply of LiTT's assistant left LiTT for the client's AI (design §7.4):
 * which conversation and message, how many characters, to which client. It
 * THROWS, and the tool writes it before the text is returned.
 */
export async function recordMcpChatEgress(
    db: Db,
    args: {
        principal: McpPrincipal;
        workspace: string | null;
        chatId: string;
        messageId: string;
        characters: number;
    },
): Promise<void> {
    await insertAuditEvent(db, {
        userId: args.principal.userId,
        orgId: args.workspace && args.workspace !== "personal" ? args.workspace : null,
        action: "mcp.chat_egress",
        surface: MCP_AUDIT_SURFACE,
        chatId: args.chatId,
        detail: {
            grant_id: args.principal.grantId,
            client_id: args.principal.clientId,
            workspace: args.workspace,
            message_id: args.messageId,
            characters: args.characters,
        },
    });
}

export type RecentToolCall = {
    tool: string;
    at: string;
    workspace: string | null;
    outcome: McpCallOutcome;
};

/**
 * What a connection did lately, newest first: tool, time, workspace and how it
 * ended. The table holds nothing else, so there is no content to leave out.
 */
export async function listRecentToolCalls(
    db: Db,
    args: { grantId: string; userId: string; limit: number },
): Promise<RecentToolCall[]> {
    const { data, error } = await db
        .from("mcp_tool_calls")
        .select("tool, created_at, workspace, outcome")
        .eq("grant_id", args.grantId)
        .eq("user_id", args.userId)
        .order("created_at", { ascending: false })
        .limit(args.limit);
    if (error) throw new AppError("mcp.db_failed", "[mcp] recent calls failed", { cause: error });
    return ((data ?? []) as { tool: string; created_at: string; workspace: string | null; outcome: McpCallOutcome }[]).map(
        (row) => ({ tool: row.tool, at: row.created_at, workspace: row.workspace, outcome: row.outcome }),
    );
}
