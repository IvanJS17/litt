// Client registry: dynamic registration (RFC 7591), metadata-document
// clients (CIMD) and the lookup /authorize and /token use.

import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { reportMessage } from "../../lib/observability/report";
import { mcpConfig } from "./mcp.config";
import { newSecret } from "./mcp.crypto";
import { tryRecordMcpAudit } from "./mcp.audit";
import {
    fetchClientMetadataDocument,
    isMetadataDocumentUrl,
    type CimdTransport,
} from "./mcp.cimd";
import { validRedirectUris } from "./mcp.redirects";
import {
    cleanLabel,
    nowIso,
    oauthFail,
    oauthOk,
    toClient,
    type ClientRow,
    type McpClient,
    type OAuthResult,
} from "./mcp.shared";

const CIMD_CACHE_SECONDS = 3600;
const CLIENT_COLUMNS =
    "client_id, kind, client_name, redirect_uris, client_uri, logo_uri, expires_at";
const SUPPORTED_GRANTS = ["authorization_code", "refresh_token"];

function dbFailure(message: string, cause: unknown): AppError {
    return new AppError("mcp.db_failed", `[mcp] ${message}`, { cause });
}

const CAP_REPORT_OPERATIONS = {
    dcr: "mcp.client_cap.registration",
    cimd: "mcp.client_cap.metadata_document",
} as const;
const capReported = new Set<string>();

/**
 * True when the client rows no grant has ever referred to have reached
 * LITT_MCP_UNAPPROVED_CLIENTS_MAX: a request that would create another one is
 * refused. One bounded read (at most `max` rows come back); a client that
 * already has a row never goes through here. Reported once per process and
 * kind, without the client or the caller.
 */
async function unapprovedClientCapReached(db: Db, kind: "dcr" | "cimd"): Promise<boolean> {
    const max = mcpConfig().unapprovedClientsMax;
    const { data, error } = await db
        .from("mcp_oauth_clients")
        .select("client_id, mcp_grants!left(id)")
        .in("kind", ["dcr", "cimd"])
        .is("mcp_grants", null)
        .limit(max);
    if (error) throw dbFailure("client count failed", error);
    if ((data ?? []).length < max) return false;
    if (!capReported.has(kind)) {
        capReported.add(kind);
        reportMessage("mcp_unapproved_clients_cap_reached", {
            level: "warning",
            tags: { operation: CAP_REPORT_OPERATIONS[kind] },
        });
    }
    return true;
}

const capReachedFailure = () =>
    oauthFail(
        "temporarily_unavailable",
        "This server cannot accept new client registrations right now. Please try again later.",
        // 429, like the registration limiter's refusal: a 5xx body is replaced on its way out.
        429,
    );

export type DcrResponse = {
    client_id: string;
    client_id_issued_at: number;
    client_name: string;
    redirect_uris: string[];
    token_endpoint_auth_method: "none";
    grant_types: string[];
    response_types: ["code"];
};

/** POST /oauth/register: public clients only. */
export async function registerDcrClient(
    db: Db,
    body: unknown,
): Promise<OAuthResult<DcrResponse>> {
    if (!body || typeof body !== "object" || Array.isArray(body))
        return oauthFail("invalid_client_metadata", "The request body must be a JSON object.");
    const input = body as Record<string, unknown>;

    const redirectUris = validRedirectUris(input.redirect_uris);
    if (!redirectUris)
        return oauthFail(
            "invalid_redirect_uri",
            "redirect_uris must list one to ten https URLs, or http URLs on localhost or 127.0.0.1, without fragments.",
        );
    const method = input.token_endpoint_auth_method;
    if (method !== undefined && method !== "none")
        return oauthFail(
            "invalid_client_metadata",
            "Only public clients are supported: token_endpoint_auth_method must be none.",
        );
    const grants = input.grant_types;
    if (grants !== undefined) {
        if (
            !Array.isArray(grants) ||
            grants.length === 0 ||
            !grants.every((g) => typeof g === "string" && SUPPORTED_GRANTS.includes(g))
        )
            return oauthFail(
                "invalid_client_metadata",
                "grant_types may only be authorization_code and refresh_token.",
            );
    }
    const responses = input.response_types;
    if (
        responses !== undefined &&
        !(Array.isArray(responses) && responses.length > 0 && responses.every((r) => r === "code"))
    )
        return oauthFail("invalid_client_metadata", "response_types must be [\"code\"].");

    const https = (value: unknown): string | null => {
        if (typeof value !== "string" || value.length > 2048) return null;
        try {
            return new URL(value).protocol === "https:" ? value : null;
        } catch {
            return null;
        }
    };
    const name = cleanLabel(input.client_name, 100) ?? "MCP client";
    const clientId = `litt_dcr_${newSecret(18)}`;

    // Unused registrations are purged; doing it here keeps the table bounded
    // without a scheduler (the endpoint is rate limited).
    const purge = await db.rpc("mcp_oauth_purge");
    if (purge.error) throw dbFailure("purge failed", purge.error);
    if (await unapprovedClientCapReached(db, "dcr")) return capReachedFailure();

    const { error } = await db.from("mcp_oauth_clients").insert({
        client_id: clientId,
        kind: "dcr",
        client_name: name,
        redirect_uris: redirectUris,
        client_uri: https(input.client_uri),
        logo_uri: https(input.logo_uri),
    });
    if (error) throw dbFailure("client insert failed", error);
    await tryRecordMcpAudit(db, {
        event: "client_registered",
        clientId,
        detail: { kind: "dcr", redirect_hosts: redirectUris.map((u) => new URL(u).host) },
    });
    return oauthOk({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: Array.isArray(grants) ? (grants as string[]) : SUPPORTED_GRANTS,
        response_types: ["code"],
    });
}

async function cachedClient(db: Db, clientId: string): Promise<ClientRow | null> {
    const { data, error } = await db
        .from("mcp_oauth_clients")
        .select(CLIENT_COLUMNS)
        .eq("client_id", clientId)
        .maybeSingle();
    if (error) throw dbFailure("client lookup failed", error);
    return (data as ClientRow | null) ?? null;
}

/**
 * Find the client a request names. A URL is a metadata-document client and is
 * fetched (or served from a one-hour cache); anything else must be registered.
 * `touch` marks the client as in use, which is what keeps it from the purge.
 */
export async function resolveClient(
    db: Db,
    clientId: string,
    options: { transport?: CimdTransport; touch?: boolean } = {},
): Promise<OAuthResult<McpClient>> {
    if (!clientId || clientId.length > 512)
        return oauthFail("invalid_client", "Unknown client.", 400);

    const row = await cachedClient(db, clientId);

    if (!row && clientId.startsWith("https://")) {
        if (!mcpConfig().cimdEnabled || !isMetadataDocumentUrl(clientId))
            return oauthFail("invalid_client", "Unknown client.", 400);
        if (await unapprovedClientCapReached(db, "cimd")) return capReachedFailure();
        return fetchCimdClient(db, clientId, options.transport);
    }
    if (!row) return oauthFail("invalid_client", "Unknown client.", 400);

    if (row.kind === "cimd" && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) {
        if (!mcpConfig().cimdEnabled) return oauthFail("invalid_client", "Unknown client.", 400);
        return fetchCimdClient(db, clientId, options.transport);
    }
    if (options.touch) {
        const { error } = await db
            .from("mcp_oauth_clients")
            .update({ last_used_at: nowIso() })
            .eq("client_id", clientId);
        if (error) throw dbFailure("client touch failed", error);
    }
    return oauthOk(toClient(row));
}

async function fetchCimdClient(
    db: Db,
    clientId: string,
    transport?: CimdTransport,
): Promise<OAuthResult<McpClient>> {
    const result = await fetchClientMetadataDocument(clientId, transport);
    if (!result.ok) {
        await tryRecordMcpAudit(db, {
            event: "cimd_rejected",
            detail: { reason: result.reason, host: new URL(clientId).host },
        });
        return oauthFail(
            "invalid_client",
            "The client metadata document could not be used.",
            400,
        );
    }
    const doc = result.document;
    const values = {
        kind: "cimd" as const,
        client_name: doc.clientName,
        redirect_uris: doc.redirectUris,
        client_uri: doc.clientUri,
        logo_uri: doc.logoUri,
        fetched_at: nowIso(),
        expires_at: nowIso(CIMD_CACHE_SECONDS),
        last_used_at: nowIso(),
    };
    const existing = await cachedClient(db, clientId);
    if (existing) {
        const { error } = await db
            .from("mcp_oauth_clients")
            .update(values)
            .eq("client_id", clientId);
        if (error) throw dbFailure("client refresh failed", error);
    } else {
        const { error } = await db
            .from("mcp_oauth_clients")
            .insert({ client_id: clientId, ...values });
        // A concurrent request stored the same document first: use theirs.
        if (error && error.code !== "23505") throw dbFailure("client insert failed", error);
        if (!error)
            await tryRecordMcpAudit(db, {
                event: "cimd_fetched",
                clientId,
                detail: { redirect_hosts: doc.redirectUris.map((u) => new URL(u).host) },
            });
    }
    return oauthOk({
        clientId,
        kind: "cimd",
        name: doc.clientName,
        redirectUris: doc.redirectUris,
        clientUri: doc.clientUri,
        logoUri: doc.logoUri,
    });
}
