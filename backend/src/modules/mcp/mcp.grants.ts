// Grants: what a person consented to, and its revocation (design §6.6).

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { tryRecordMcpAudit } from "./mcp.audit";
import { nowIso, type GrantRow } from "./mcp.shared";

export const GRANT_COLUMNS =
    "id, user_id, client_id, resource, scopes, workspaces, default_workspace, mfa_verified_at, created_at, last_used_at, expires_at, revoked_at";

export function grantIsLive(grant: GrantRow): boolean {
    return !grant.revoked_at && Date.parse(grant.expires_at) > Date.now();
}

export async function loadGrant(db: Db, grantId: string): Promise<GrantRow | null> {
    const { data, error } = await db
        .from("mcp_grants")
        .select(GRANT_COLUMNS)
        .eq("id", grantId)
        .maybeSingle();
    if (error) throw new AppError("mcp.db_failed", "[mcp] grant lookup failed", { cause: error });
    return (data as GrantRow | null) ?? null;
}

/**
 * Revoke a grant and every token issued under it. Takes effect on the next
 * call: the access-token check reads the grant each time. Returns whether
 * this call did the revoking (a second call is a no-op).
 */
export async function revokeGrant(
    db: Db,
    args: { grantId: string; reason: string; userId?: string; clientId?: string | null },
): Promise<boolean> {
    const stamp = nowIso();
    let query = db
        .from("mcp_grants")
        .update({ revoked_at: stamp, revoked_reason: args.reason })
        .eq("id", args.grantId)
        .is("revoked_at", null);
    if (args.userId) query = query.eq("user_id", args.userId);
    const { data, error } = await query.select("id, user_id, client_id");
    if (error) throw new AppError("mcp.db_failed", "[mcp] grant revoke failed", { cause: error });
    const revoked = (data ?? []) as { id: string; user_id: string; client_id: string }[];
    if (revoked.length === 0) return false;

    const tokens = await db
        .from("mcp_oauth_tokens")
        .update({ revoked_at: stamp })
        .eq("grant_id", args.grantId)
        .is("revoked_at", null);
    if (tokens.error)
        throw new AppError("mcp.db_failed", "[mcp] token revoke failed", { cause: tokens.error });

    // The revocation already happened: a lost audit row is reported, never
    // turned into an error that would hide the revocation from the caller.
    await tryRecordMcpAudit(db, {
        event: "grant_revoked",
        userId: revoked[0].user_id,
        clientId: revoked[0].client_id,
        grantId: args.grantId,
        detail: { reason: args.reason },
    });
    return true;
}

export type GrantSummary = {
    id: string;
    client_id: string;
    client_name: string;
    scopes: string[];
    workspaces: string[];
    default_workspace: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string;
};

/** The person's live grants, newest first, for the connected-apps list. */
export async function listGrantsForUser(db: Db, userId: string): Promise<GrantSummary[]> {
    const { data, error } = await db
        .from("mcp_grants")
        .select(GRANT_COLUMNS)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
    if (error) throw new AppError("mcp.db_failed", "[mcp] grant list failed", { cause: error });
    const grants = ((data ?? []) as GrantRow[]).filter(grantIsLive);
    if (grants.length === 0) return [];
    const clients = await db
        .from("mcp_oauth_clients")
        .select("client_id, client_name")
        .in("client_id", [...new Set(grants.map((g) => g.client_id))]);
    if (clients.error)
        throw new AppError("mcp.db_failed", "[mcp] client names failed", { cause: clients.error });
    const names = new Map(
        ((clients.data ?? []) as { client_id: string; client_name: string }[]).map((c) => [
            c.client_id,
            c.client_name,
        ]),
    );
    return grants.map((g) => ({
        id: g.id,
        client_id: g.client_id,
        client_name: names.get(g.client_id) ?? g.client_id,
        scopes: g.scopes,
        workspaces: g.workspaces,
        default_workspace: g.default_workspace,
        created_at: g.created_at,
        last_used_at: g.last_used_at,
        expires_at: g.expires_at,
    }));
}
