// The consent step: what the web page shows, and what happens when the
// person approves or denies. Runs under the person's own web session; the
// route has already required it (and `aal2` when they have MFA).

import { randomUUID } from "node:crypto";
import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import { listMyOrgs } from "../orgs/orgs.service";
import { MCP_SCOPES, mcpConfig } from "./mcp.config";
import { newSecret, sha256Hex } from "./mcp.crypto";
import { recordMcpAudit } from "./mcp.audit";
import { clientRedirect } from "./mcp.authorize";
import { revokeGrant } from "./mcp.grants";
import { isLoopbackRedirect, redirectDisplayHost } from "./mcp.redirects";
import { nowIso, toClient, type ClientRow } from "./mcp.shared";

const PERSONAL = "personal";

type RequestRow = {
    id_hash: string;
    client_id: string;
    redirect_uri: string;
    state: string | null;
    code_challenge: string;
    scopes: string[];
    resource: string;
    expires_at: string;
    decided_at: string | null;
};

const REQUEST_COLUMNS =
    "id_hash, client_id, redirect_uri, state, code_challenge, scopes, resource, expires_at, decided_at";

export type ConsentWorkspace = {
    id: string;
    name: string | null;
    kind: "personal" | "organization";
};

export type ConsentView = {
    client: {
        id: string;
        name: string;
        kind: "dcr" | "cimd" | "preregistered";
        uri: string | null;
        redirect_uri: string;
        redirect_host: string;
        /** Every registered redirect is on the visitor's own machine. */
        loopback_only: boolean;
    };
    scopes: string[];
    workspaces: ConsentWorkspace[];
    default_workspace: string | null;
};

async function openRequest(
    db: Db,
    requestId: string,
): Promise<{ row: RequestRow } | { row: null }> {
    const { data, error } = await db
        .from("mcp_oauth_requests")
        .select(REQUEST_COLUMNS)
        .eq("id_hash", sha256Hex(requestId))
        .maybeSingle();
    if (error)
        throw new AppError("mcp.db_failed", "[mcp] request lookup failed", { cause: error });
    const row = data as RequestRow | null;
    if (!row || row.decided_at || Date.parse(row.expires_at) <= Date.now()) return { row: null };
    return { row };
}

/** Where this person may let a client work: Personal (unless their firm manages the account) and each firm. */
async function allowedWorkspaces(
    db: Db,
    userId: string,
    personalWorkspaceDisabled: boolean,
): Promise<ConsentWorkspace[]> {
    const mine = await listMyOrgs(db, userId);
    if (!mine.ok)
        throw new AppError("mcp.db_failed", "[mcp] workspace list failed", { cause: mine });
    const workspaces: ConsentWorkspace[] = personalWorkspaceDisabled
        ? []
        : [{ id: PERSONAL, name: null, kind: "personal" }];
    for (const org of mine.orgs as { id: string; name?: string }[])
        workspaces.push({ id: org.id, name: org.name ?? null, kind: "organization" });
    return workspaces;
}

export async function getConsentView(
    db: Db,
    args: { requestId: string; userId: string; personalWorkspaceDisabled: boolean },
): Promise<ServiceResult<ConsentView>> {
    try {
        const { row } = await openRequest(db, args.requestId);
        if (!row) return failure("not_found", "This connection request has expired.", "mcp_request_expired");
        const clientQuery = await db
            .from("mcp_oauth_clients")
            .select("client_id, kind, client_name, redirect_uris, client_uri, logo_uri, expires_at")
            .eq("client_id", row.client_id)
            .maybeSingle();
        if (clientQuery.error)
            throw new AppError("mcp.db_failed", "[mcp] client lookup failed", {
                cause: clientQuery.error,
            });
        if (!clientQuery.data)
            return failure("not_found", "This connection request has expired.", "mcp_request_expired");
        const client = toClient(clientQuery.data as ClientRow);
        const workspaces = await allowedWorkspaces(db, args.userId, args.personalWorkspaceDisabled);
        return ok({
            client: {
                id: client.clientId,
                name: client.name,
                kind: client.kind,
                uri: client.clientUri,
                redirect_uri: row.redirect_uri,
                redirect_host: redirectDisplayHost(row.redirect_uri),
                loopback_only: client.redirectUris.every(isLoopbackRedirect),
            },
            scopes: row.scopes,
            workspaces,
            default_workspace: workspaces[0]?.id ?? null,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

export type ConsentDecision = {
    requestId: string;
    userId: string;
    personalWorkspaceDisabled: boolean;
    /** When the request arrived, before the session was checked; the connection is dated from it. */
    arrivedAt: string;
    /** The person approved with MFA (`aal2`) while having it enrolled. */
    mfaVerified: boolean;
    decision: "approve" | "deny";
    workspaces?: string[];
    scopes?: string[];
    defaultWorkspace?: string;
};

export async function decideConsent(
    db: Db,
    args: ConsentDecision,
): Promise<ServiceResult<{ redirect_url: string }>> {
    try {
        const config = mcpConfig();
        const { row } = await openRequest(db, args.requestId);
        if (!row) return failure("not_found", "This connection request has expired.", "mcp_request_expired");

        let scopes: string[] = [];
        let workspaces: string[] = [];
        if (args.decision === "approve") {
            scopes = [...new Set(args.scopes ?? [])];
            if (
                scopes.length === 0 ||
                !scopes.every((s) => row.scopes.includes(s) && (MCP_SCOPES as readonly string[]).includes(s))
            )
                return failure("validation", "Choose at least one of the requested permissions.", "mcp_invalid_scopes");
            const allowed = await allowedWorkspaces(db, args.userId, args.personalWorkspaceDisabled);
            workspaces = [...new Set(args.workspaces ?? [])];
            if (
                workspaces.length === 0 ||
                !workspaces.every((w) => allowed.some((a) => a.id === w))
            )
                return failure("validation", "Choose at least one workspace you belong to.", "mcp_invalid_workspaces");
        }

        // One decision per request, even with two tabs open.
        const claimed = await db
            .from("mcp_oauth_requests")
            .update({ decided_at: nowIso() })
            .eq("id_hash", row.id_hash)
            .is("decided_at", null)
            .select("id_hash");
        if (claimed.error)
            throw new AppError("mcp.db_failed", "[mcp] request claim failed", { cause: claimed.error });
        if (((claimed.data ?? []) as unknown[]).length === 0)
            return failure("not_found", "This connection request has expired.", "mcp_request_expired");

        const state = row.state ?? undefined;
        if (args.decision === "deny") {
            await recordMcpAudit(db, {
                event: "consent_denied",
                userId: args.userId,
                clientId: row.client_id,
            });
            return ok({
                redirect_url: clientRedirect(row.redirect_uri, {
                    error: "access_denied",
                    error_description: "The user denied the request.",
                    state,
                }),
            });
        }

        const defaultWorkspace =
            args.defaultWorkspace && workspaces.includes(args.defaultWorkspace)
                ? args.defaultWorkspace
                : workspaces.includes(PERSONAL)
                  ? PERSONAL
                  : workspaces[0];
        const grantId = randomUUID();
        const grantInsert = await db.from("mcp_grants").insert({
            id: grantId,
            user_id: args.userId,
            client_id: row.client_id,
            resource: row.resource,
            scopes,
            workspaces,
            default_workspace: defaultWorkspace,
            mfa_verified_at: args.mfaVerified ? nowIso() : null,
            created_at: args.arrivedAt,
            expires_at: nowIso(config.grantMaxAgeSeconds),
        });
        if (grantInsert.error)
            throw new AppError("mcp.db_failed", "[mcp] grant insert failed", { cause: grantInsert.error });
        try {
            await recordMcpAudit(db, {
                event: "consent_granted",
                userId: args.userId,
                clientId: row.client_id,
                grantId,
                detail: { scopes, workspaces, mfa: args.mfaVerified },
            });
        } catch (error) {
            // Failing closed: no record of the decision, no grant.
            await revokeGrant(db, { grantId, reason: "audit_unavailable" }).catch(() => undefined);
            throw error;
        }

        const code = newSecret();
        const codeInsert = await db.from("mcp_oauth_codes").insert({
            code_hash: sha256Hex(code),
            grant_id: grantId,
            redirect_uri: row.redirect_uri,
            code_challenge: row.code_challenge,
            expires_at: nowIso(config.codeTtlSeconds),
        });
        if (codeInsert.error)
            throw new AppError("mcp.db_failed", "[mcp] code insert failed", { cause: codeInsert.error });
        return ok({ redirect_url: clientRedirect(row.redirect_uri, { code, state }) });
    } catch (error) {
        return internalFailure(error);
    }
}

/**
 * Whether the person has a second factor enrolled (the next level is `aal2`).
 * The route has already required `aal2` of them in that case, so this is what
 * "MFA was verified at consent" means.
 */
export async function hasMfaEnrolled(db: Db, accessToken: string): Promise<boolean> {
    const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (error)
        throw new AppError("mcp.mfa_lookup_failed", "[mcp] assurance lookup failed", { cause: error });
    return data.nextLevel === "aal2";
}
