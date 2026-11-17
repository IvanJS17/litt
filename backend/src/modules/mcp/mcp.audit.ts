// Insert-only record of the authorization server's decisions
// (public.mcp_oauth_audit; the database refuses UPDATE and DELETE).
//
// Details are small, source-authored facts. They never carry a token, a
// code, a PKCE value, a state or a document.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";

export type McpAuditEvent = {
    event:
        | "client_registered"
        | "cimd_fetched"
        | "cimd_rejected"
        | "authorization_requested"
        | "consent_granted"
        | "consent_denied"
        | "token_issued"
        | "token_refreshed"
        | "refresh_reuse_detected"
        | "code_reuse_detected"
        | "grant_revoked";
    userId?: string | null;
    clientId?: string | null;
    grantId?: string | null;
    detail?: Record<string, unknown> | null;
};

/** The raw insert: throws, so a decision that must be recorded fails closed. */
export async function recordMcpAudit(db: Db, entry: McpAuditEvent): Promise<void> {
    const { error } = await db.from("mcp_oauth_audit").insert({
        event: entry.event,
        user_id: entry.userId ?? null,
        client_id: entry.clientId ?? null,
        grant_id: entry.grantId ?? null,
        detail: entry.detail ?? null,
    });
    if (error)
        throw new AppError("mcp.audit_write_failed", "[mcp] audit insert failed", {
            cause: error,
        });
}

/** For refusals: a lost row is reported but never changes the answer. */
export async function tryRecordMcpAudit(db: Db, entry: McpAuditEvent): Promise<void> {
    try {
        await recordMcpAudit(db, entry);
    } catch (error) {
        reportError(error, { tags: { component: "mcp", operation: "mcp.audit" } });
    }
}
