// requireMcpAuth, part two: from a verified token to a live principal
// (design §6.5 steps 2-6, §7.1, §7.2).
//
// The grant records what the person CONSENTED to; it is not what they may do
// now. This reads the database on every request and answers who the caller is
// right now: which of the grant's workspaces they can still open, whether the
// firm manages their account, which stage of training they are in. Nothing
// here is cached, so a person removed from a firm, an account marked for
// deletion or a revoked grant stops working on the next call.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { getOrgRole } from "../../lib/access";
import { managedByCreatingOrg, PERSONAL_WORKSPACE_DISABLED_DETAIL } from "../../lib/managedAccounts";
import { readAuthorizationStamp } from "../../lib/authorizationEpoch";
import { isTrainingStage } from "../../lib/training";
import { MCP_SCOPES, type McpScope } from "./mcp.config";
import { grantIsLive, grantPredatesSignOut, loadGrant } from "./mcp.grants";

export const PERSONAL_WORKSPACE = "personal";

/** Who runs the model: LiTT (A) or the client's own AI (B). Apprentices only get A. */
export type McpMode = "A" | "B";

export type McpWorkspace = {
    /** `personal` or an organization id. */
    id: string;
    kind: "personal" | "organization";
    /** The mode this workspace allows (an apprentice's firm allows A only). */
    mode: McpMode;
    /**
     * The organization's authorization epoch read for this call: work queued
     * on this person's authority carries it (lib/authorizationEpoch.ts).
     */
    authorizationEpoch: number | null;
};

export type McpPrincipal = {
    userId: string;
    grantId: string;
    clientId: string;
    scopes: McpScope[];
    /** Only the grant's workspaces that the person can open right now. */
    workspaces: McpWorkspace[];
    /** The grant's default workspace while it is live, otherwise the first live one. */
    defaultWorkspace: string;
    /** `A` as soon as any live workspace belongs to an apprentice, otherwise `B`. */
    mode: McpMode;
    personalWorkspaceDisabled: boolean;
};

export type Denial = {
    ok: false;
    status: 401 | 403;
    code: string;
    detail: string;
};

export type Revalidation = { ok: true; principal: McpPrincipal } | Denial;

const deny = (status: 401 | 403, code: string, detail: string): Denial => ({
    ok: false,
    status,
    code,
    detail,
});

const dbFailure = (message: string, cause: unknown) =>
    new AppError("mcp.db_failed", `[mcp] ${message}`, { cause });

/** The organizations (of `orgIds`) in which this person is an apprentice. */
async function apprenticeOrgs(db: Db, userId: string, orgIds: string[]): Promise<Set<string>> {
    if (orgIds.length === 0) return new Set();
    const { data, error } = await db
        .from("training_stages")
        .select("org_id, stage")
        .eq("trainee_user_id", userId)
        .in("org_id", orgIds);
    if (error) throw dbFailure("training stage lookup failed", error);
    // Any stage, in any practice area, makes the workspace mode A: a client
    // cannot tell which practice area a later call will touch.
    return new Set(
        ((data ?? []) as { org_id: string; stage: string }[])
            .filter((row) => isTrainingStage(row.stage))
            .map((row) => row.org_id),
    );
}

/**
 * Everything the gate checks after the token itself, on every request. A read
 * failure throws (the caller answers a sanitized 500): an unreadable verdict
 * must never open a workspace.
 */
export async function revalidatePrincipal(db: Db, grantId: string): Promise<Revalidation> {
    // 1. The connection, read again: revoked or expired between the token
    //    check and now is still refused.
    const grant = await loadGrant(db, grantId);
    if (!grant || !grantIsLive(grant))
        return deny(401, "invalid_token", "The connection was revoked or has expired.");

    // 2. The account.
    const profile = await db
        .from("user_profiles")
        .select("account_deletion_requested_at, created_by_org_id, sessions_ended_at")
        .eq("user_id", grant.user_id)
        .maybeSingle();
    if (profile.error) throw dbFailure("account state lookup failed", profile.error);
    const account = profile.data as {
        account_deletion_requested_at?: string | null;
        created_by_org_id?: string | null;
        sessions_ended_at?: string | null;
    } | null;
    if (grantPredatesSignOut(grant, account?.sessions_ended_at))
        return deny(401, "invalid_token", "The connection was revoked or has expired.");
    if (account?.account_deletion_requested_at)
        return deny(401, "account_deletion_pending", "This account is being deleted.");

    // 3. A firm-managed account has no personal workspace.
    let personalWorkspaceDisabled: boolean;
    try {
        personalWorkspaceDisabled = await managedByCreatingOrg(
            db,
            grant.user_id,
            account?.created_by_org_id,
        );
    } catch (error) {
        throw dbFailure("managed account lookup failed", error);
    }

    // 4. Membership in each workspace of the grant, now.
    const requested = [...new Set(grant.workspaces)];
    const live: { id: string; kind: McpWorkspace["kind"] }[] = [];
    const orgChecks = await Promise.all(
        requested
            .filter((id) => id !== PERSONAL_WORKSPACE)
            .map(async (id) => ({ id, role: await getOrgRole(grant.user_id, id, db) })),
    );
    for (const id of requested) {
        if (id === PERSONAL_WORKSPACE) {
            if (!personalWorkspaceDisabled) live.push({ id, kind: "personal" });
        } else if (orgChecks.find((check) => check.id === id)?.role)
            live.push({ id, kind: "organization" });
    }
    if (live.length === 0) {
        const onlyPersonal = requested.every((id) => id === PERSONAL_WORKSPACE);
        return personalWorkspaceDisabled && requested.includes(PERSONAL_WORKSPACE) && onlyPersonal
            ? deny(403, "personal_workspace_disabled", PERSONAL_WORKSPACE_DISABLED_DETAIL)
            : deny(403, "workspace_not_found", "None of the workspaces of this connection are available to you anymore.");
    }

    // 5. Authorization epochs, and 6. training stage, of the live firms.
    const orgIds = live.filter((w) => w.kind === "organization").map((w) => w.id);
    const [stamps, apprentices] = await Promise.all([
        Promise.all(orgIds.map((id) => readAuthorizationStamp(db, id))),
        apprenticeOrgs(db, grant.user_id, orgIds),
    ]);
    const epochs = new Map(orgIds.map((id, i) => [id, stamps[i]?.epoch ?? null]));
    const workspaces: McpWorkspace[] = live.map((w) => ({
        id: w.id,
        kind: w.kind,
        mode: apprentices.has(w.id) ? "A" : "B",
        authorizationEpoch: epochs.get(w.id) ?? null,
    }));

    return {
        ok: true,
        principal: {
            userId: grant.user_id,
            grantId: grant.id,
            clientId: grant.client_id,
            scopes: grant.scopes.filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s)),
            workspaces,
            defaultWorkspace: workspaces.some((w) => w.id === grant.default_workspace)
                ? grant.default_workspace
                : workspaces[0].id,
            mode: workspaces.some((w) => w.mode === "A") ? "A" : "B",
            personalWorkspaceDisabled,
        },
    };
}

/** The mode a call in `workspaceId` may use (the workspace's own, not the strictest of the grant). */
export function modeOf(principal: McpPrincipal, workspaceId: string): McpMode {
    return principal.workspaces.find((w) => w.id === workspaceId)?.mode ?? "A";
}

/**
 * The address the person has CONFIRMED, lower-cased, or "" when they have none.
 * It is an authorization input (direct grants and invitations are matched
 * against it), exactly as `requireAuth` computes it for the web: an address
 * that is not confirmed matches nothing. Read from the auth service when a
 * tool needs it, not on every request.
 */
export async function loadConfirmedEmail(db: Db, userId: string): Promise<string> {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) throw dbFailure("account email lookup failed", error);
    const user = data?.user as { email?: string | null; email_confirmed_at?: string | null } | null | undefined;
    return user?.email && user.email_confirmed_at ? user.email.toLowerCase() : "";
}
