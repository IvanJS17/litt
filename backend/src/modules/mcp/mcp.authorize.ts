// GET /oauth/authorize: validate the request, store it, and send the browser
// to the consent page. Nothing is granted here; the person approves on the
// web app, with their own session.
//
// Until the client and redirect_uri are known to be valid the answer cannot
// go to the redirect_uri (it could be an open redirect): those failures are
// shown to the visitor. Every later failure goes back to the client, with
// `iss` (RFC 9207) like a success.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { MCP_DEFAULT_SCOPE, MCP_SCOPES, mcpConfig } from "./mcp.config";
import { isWellFormedChallenge, newSecret, sha256Hex } from "./mcp.crypto";
import { tryRecordMcpAudit } from "./mcp.audit";
import { resolveClient } from "./mcp.clients";
import type { CimdTransport } from "./mcp.cimd";
import { redirectUriAllowed } from "./mcp.redirects";
import { nowIso } from "./mcp.shared";

export type AuthorizeOutcome =
    /** Cannot be sent to the client: show it to the visitor. */
    | { kind: "page_error"; status: number; error: string; description: string }
    /** Redirect to the consent page. */
    | { kind: "consent"; location: string }
    /** Redirect back to the client with an error. */
    | { kind: "client_error"; location: string };

/** The URL a client is sent back to, with `iss` always present. */
export function clientRedirect(
    redirectUri: string,
    params: Record<string, string | null | undefined>,
): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    url.searchParams.set("iss", mcpConfig().issuer);
    return url.href;
}

function single(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export async function startAuthorization(
    db: Db,
    query: Record<string, unknown>,
    options: { transport?: CimdTransport } = {},
): Promise<AuthorizeOutcome> {
    const config = mcpConfig();
    const clientId = single(query.client_id);
    const redirectUri = single(query.redirect_uri);
    if (!clientId || !redirectUri)
        return {
            kind: "page_error",
            status: 400,
            error: "invalid_request",
            description: "client_id and redirect_uri are required.",
        };

    const resolved = await resolveClient(db, clientId, { transport: options.transport });
    if (!resolved.ok)
        return {
            kind: "page_error",
            status: 400,
            error: resolved.error,
            description: resolved.description,
        };
    const client = resolved.data;
    if (!redirectUriAllowed(client.redirectUris, redirectUri))
        return {
            kind: "page_error",
            status: 400,
            error: "invalid_request",
            description: "redirect_uri is not registered for this client.",
        };

    const state = single(query.state);
    const fail = (error: string, description: string): AuthorizeOutcome => ({
        kind: "client_error",
        location: clientRedirect(redirectUri, {
            error,
            error_description: description,
            state: state && state.length <= 1024 ? state : undefined,
        }),
    });

    if (query.response_type !== "code")
        return fail("unsupported_response_type", "Only response_type=code is supported.");
    const challenge = single(query.code_challenge);
    if (query.code_challenge_method !== "S256" || !challenge || !isWellFormedChallenge(challenge))
        return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
    if (state && state.length > 1024) return fail("invalid_request", "state is too long.");

    // MCP clients send the resource they will call (RFC 8707). The 2025-03-26
    // clients did not; they get this server's resource.
    const resource = single(query.resource);
    if (resource !== undefined && resource !== config.resource)
        return fail("invalid_target", "resource must be the MCP endpoint URL of this server.");

    const requested = (single(query.scope) ?? "").split(/\s+/).filter(Boolean);
    const known = requested.filter((s) => (MCP_SCOPES as readonly string[]).includes(s));
    if (requested.length > 0 && known.length === 0)
        return fail("invalid_scope", "None of the requested scopes is supported.");
    const scopes = requested.length === 0 ? [MCP_DEFAULT_SCOPE] : [...new Set(known)];

    const requestId = newSecret();
    const { error } = await db.from("mcp_oauth_requests").insert({
        id_hash: sha256Hex(requestId),
        client_id: client.clientId,
        redirect_uri: redirectUri,
        state: state ?? null,
        code_challenge: challenge,
        scopes,
        resource: config.resource,
        expires_at: nowIso(config.requestTtlSeconds),
    });
    if (error)
        throw new AppError("mcp.db_failed", "[mcp] authorization request insert failed", {
            cause: error,
        });
    await tryRecordMcpAudit(db, {
        event: "authorization_requested",
        clientId: client.clientId,
        detail: { scopes },
    });

    const location = new URL(config.consentUrl);
    location.searchParams.set("request", requestId);
    return { kind: "consent", location: location.href };
}
