// The /oauth/token and /oauth/revoke logic, and the access-token check the
// /mcp endpoint uses.
//
// Tokens are opaque 256-bit values stored as SHA-256 only. A refresh token is
// single use: presenting a used one means a copy leaked, and the whole grant
// (every token under it) is revoked. An authorization code is single use for
// the same reason.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { mcpConfig } from "./mcp.config";
import { newSecret, sha256Hex, verifyPkceS256 } from "./mcp.crypto";
import { recordMcpAudit, tryRecordMcpAudit } from "./mcp.audit";
import { resolveClient } from "./mcp.clients";
import { grantIsLive, loadGrant, revokeGrant } from "./mcp.grants";
import { nowIso, oauthFail, oauthOk, type GrantRow, type OAuthResult } from "./mcp.shared";

export type TokenResponse = {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    refresh_token: string;
    scope: string;
};

type CodeRow = {
    code_hash: string;
    grant_id: string;
    redirect_uri: string;
    code_challenge: string;
    expires_at: string;
    used_at: string | null;
};
type TokenRow = {
    id: string;
    grant_id: string;
    kind: "access" | "refresh";
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
};

const dbFailure = (message: string, cause: unknown) =>
    new AppError("mcp.db_failed", `[mcp] ${message}`, { cause });

/** Create an access + refresh pair for a grant (one statement: both or none). */
export async function issueTokens(db: Db, grant: GrantRow): Promise<TokenResponse> {
    const config = mcpConfig();
    const access = newSecret();
    const refresh = newSecret();
    const refreshLifetime = Math.min(
        config.refreshTtlSeconds,
        Math.floor((Date.parse(grant.expires_at) - Date.now()) / 1000),
    );
    const { error } = await db.from("mcp_oauth_tokens").insert([
        {
            grant_id: grant.id,
            kind: "access",
            token_hash: sha256Hex(access),
            expires_at: nowIso(Math.min(config.accessTtlSeconds, Math.max(refreshLifetime, 1))),
        },
        {
            grant_id: grant.id,
            kind: "refresh",
            token_hash: sha256Hex(refresh),
            expires_at: nowIso(Math.max(refreshLifetime, 1)),
        },
    ]);
    if (error) throw dbFailure("token insert failed", error);
    return {
        access_token: access,
        token_type: "Bearer",
        expires_in: config.accessTtlSeconds,
        refresh_token: refresh,
        scope: grant.scopes.join(" "),
    };
}

const invalidGrant = (description: string) => oauthFail("invalid_grant", description);

export async function exchangeAuthorizationCode(
    db: Db,
    params: Record<string, string | undefined>,
): Promise<OAuthResult<TokenResponse>> {
    const { client_id, code, code_verifier, redirect_uri, resource } = params;
    if (!client_id || !code || !code_verifier || !redirect_uri)
        return oauthFail(
            "invalid_request",
            "client_id, code, code_verifier and redirect_uri are required.",
        );
    const client = await resolveClient(db, client_id, { touch: true });
    if (!client.ok) return client;

    const hash = sha256Hex(code);
    const claimed = await db
        .from("mcp_oauth_codes")
        .update({ used_at: nowIso() })
        .eq("code_hash", hash)
        .is("used_at", null)
        .select("code_hash, grant_id, redirect_uri, code_challenge, expires_at, used_at");
    if (claimed.error) throw dbFailure("code claim failed", claimed.error);
    const row = ((claimed.data ?? []) as CodeRow[])[0];

    if (!row) {
        // A code that was already used: whoever holds the tokens it produced
        // must lose them.
        const prior = await db
            .from("mcp_oauth_codes")
            .select("grant_id, used_at")
            .eq("code_hash", hash)
            .maybeSingle();
        if (prior.error) throw dbFailure("code lookup failed", prior.error);
        const reused = prior.data as { grant_id: string; used_at: string | null } | null;
        if (reused?.used_at) {
            await tryRecordMcpAudit(db, {
                event: "code_reuse_detected",
                clientId: client_id,
                grantId: reused.grant_id,
            });
            await revokeGrant(db, { grantId: reused.grant_id, reason: "code_reuse" });
        }
        return invalidGrant("The authorization code is invalid, expired or already used.");
    }

    const grant = await loadGrant(db, row.grant_id);
    if (
        !grant ||
        !grantIsLive(grant) ||
        grant.client_id !== client_id ||
        Date.parse(row.expires_at) <= Date.now() ||
        row.redirect_uri !== redirect_uri
    )
        return invalidGrant("The authorization code is invalid, expired or already used.");
    if (!verifyPkceS256(code_verifier, row.code_challenge))
        return invalidGrant("The PKCE code_verifier does not match the code_challenge.");
    if (resource && resource !== grant.resource)
        return oauthFail("invalid_target", "resource does not match the authorization.");

    const tokens = await issueTokens(db, grant);
    await recordMcpAudit(db, {
        event: "token_issued",
        userId: grant.user_id,
        clientId: grant.client_id,
        grantId: grant.id,
    });
    return oauthOk(tokens);
}

export async function refreshTokens(
    db: Db,
    params: Record<string, string | undefined>,
): Promise<OAuthResult<TokenResponse>> {
    const { client_id, refresh_token, scope, resource } = params;
    if (!client_id || !refresh_token)
        return oauthFail("invalid_request", "client_id and refresh_token are required.");
    const client = await resolveClient(db, client_id, { touch: true });
    if (!client.ok) return client;

    const hash = sha256Hex(refresh_token);
    const found = await db
        .from("mcp_oauth_tokens")
        .select("id, grant_id, kind, expires_at, used_at, revoked_at")
        .eq("token_hash", hash)
        .eq("kind", "refresh")
        .maybeSingle();
    if (found.error) throw dbFailure("refresh lookup failed", found.error);
    const token = found.data as TokenRow | null;
    if (!token) return invalidGrant("The refresh token is invalid, expired or revoked.");

    const grant = await loadGrant(db, token.grant_id);
    // Another client's token reads as an unknown one.
    if (!grant || grant.client_id !== client_id)
        return invalidGrant("The refresh token is invalid, expired or revoked.");

    const claimed = await db
        .from("mcp_oauth_tokens")
        .update({ used_at: nowIso() })
        .eq("id", token.id)
        .is("used_at", null)
        .is("revoked_at", null)
        .select("id");
    if (claimed.error) throw dbFailure("refresh claim failed", claimed.error);
    if (((claimed.data ?? []) as unknown[]).length === 0) {
        if (token.used_at && !token.revoked_at) {
            await tryRecordMcpAudit(db, {
                event: "refresh_reuse_detected",
                userId: grant.user_id,
                clientId: client_id,
                grantId: grant.id,
            });
            await revokeGrant(db, { grantId: grant.id, reason: "refresh_reuse" });
        }
        return invalidGrant("The refresh token is invalid, expired or revoked.");
    }

    if (!grantIsLive(grant) || Date.parse(token.expires_at) <= Date.now())
        return invalidGrant("The refresh token is invalid, expired or revoked.");
    if (scope) {
        const wanted = scope.split(/\s+/).filter(Boolean);
        if (!wanted.every((s) => grant.scopes.includes(s)))
            return oauthFail("invalid_scope", "The requested scope exceeds the grant.");
    }
    if (resource && resource !== grant.resource)
        return oauthFail("invalid_target", "resource does not match the authorization.");

    const tokens = await issueTokens(db, grant);
    await tryRecordMcpAudit(db, {
        event: "token_refreshed",
        userId: grant.user_id,
        clientId: grant.client_id,
        grantId: grant.id,
    });
    return oauthOk(tokens);
}

/** RFC 7009. Always succeeds from the caller's point of view. */
export async function revokeByToken(
    db: Db,
    args: { token: string; clientId?: string },
): Promise<void> {
    const found = await db
        .from("mcp_oauth_tokens")
        .select("id, grant_id")
        .eq("token_hash", sha256Hex(args.token))
        .maybeSingle();
    if (found.error) throw dbFailure("revocation lookup failed", found.error);
    const token = found.data as { id: string; grant_id: string } | null;
    if (!token) return;
    const grant = await loadGrant(db, token.grant_id);
    if (!grant || (args.clientId && args.clientId !== grant.client_id)) return;
    await revokeGrant(db, { grantId: grant.id, reason: "client_revocation" });
}

export type VerifiedAccess = {
    grant: GrantRow;
    expiresAt: number;
};

const LAST_USED_REFRESH_MS = 60_000;

/**
 * The /mcp gate: the token must be a live access token of a live grant bound
 * to this server's resource, for a person whose account is not being deleted.
 * Read on every call, so a revocation applies to the next one.
 */
export async function verifyAccessToken(db: Db, token: string): Promise<VerifiedAccess | null> {
    const found = await db
        .from("mcp_oauth_tokens")
        .select("id, grant_id, kind, expires_at, used_at, revoked_at")
        .eq("token_hash", sha256Hex(token))
        .eq("kind", "access")
        .maybeSingle();
    if (found.error) throw dbFailure("access lookup failed", found.error);
    const row = found.data as TokenRow | null;
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;

    const grant = await loadGrant(db, row.grant_id);
    if (!grant || !grantIsLive(grant) || grant.resource !== mcpConfig().resource) return null;

    const profile = await db
        .from("user_profiles")
        .select("account_deletion_requested_at")
        .eq("user_id", grant.user_id)
        .maybeSingle();
    if (profile.error) throw dbFailure("account state lookup failed", profile.error);
    if ((profile.data as { account_deletion_requested_at?: string | null } | null)
        ?.account_deletion_requested_at)
        return null;

    if (!grant.last_used_at || Date.now() - Date.parse(grant.last_used_at) > LAST_USED_REFRESH_MS) {
        // Display data only: never worth failing a call over.
        await db.from("mcp_grants").update({ last_used_at: nowIso() }).eq("id", grant.id);
    }
    return { grant, expiresAt: Math.floor(Date.parse(row.expires_at) / 1000) };
}
