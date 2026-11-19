// The /mcp endpoint, minus HTTP framework: the MCP server (its tools are in
// mcp.catalog.ts) and the bearer-token gate. The Express glue is in
// mcp.routes.ts.

import {
    OAuthError,
    OAuthErrorCode,
    McpServer,
    bearerAuthChallengeResponse,
    createMcpHandler,
    verifyBearerToken,
    type AuthInfo,
    type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Db } from "../../lib/supabase";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { MCP_SCOPES, mcpConfig } from "./mcp.config";
import { MCP_TOOLS } from "./mcp.catalog";
import { registerMcpPrompts } from "./mcp.prompts";
import { registerMcpResources } from "./mcp.resources";
import { LITT_MCP_ICON } from "./mcp.icon";
import { recordMcpToolCall } from "./mcp.calls";
import { revalidatePrincipal, type McpPrincipal } from "./mcp.principal";
import { preflightMcpRequest, registerMcpTools, type McpRefusal } from "./mcp.tools";
import { verifyAccessToken } from "./mcp.tokens";

/** Header values are ASCII: the SDK copies this text into WWW-Authenticate. */
const INVALID_TOKEN_TEXT = "The access token is invalid, expired or revoked.";

/** The caller is who the token says, but may not use any workspace of the grant now. */
export class McpDenied extends Error {
    constructor(
        readonly status: 403,
        readonly code: string,
        readonly detail: string,
        readonly who: { grantId: string; userId: string; clientId: string },
    ) {
        super(code);
        this.name = "McpDenied";
    }
}

/**
 * Token → live principal. The token and its grant are read from the database
 * (mcp.tokens.ts); then the person's standing is read again (mcp.principal.ts)
 * so that every request is judged on today's membership, account state and
 * training stage, not on what the grant said when it was consented to.
 */
export function tokenVerifier(db: Db): OAuthTokenVerifier {
    return {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
            const access = await verifyAccessToken(db, token);
            // A plain Error would answer 500 without a challenge, and clients
            // refresh on 401 only: an unknown token must be an OAuthError.
            if (!access)
                throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_TEXT);
            const { grant } = access;
            const live = await revalidatePrincipal(db, grant.id);
            if (!live.ok) {
                if (live.status === 401)
                    throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_TEXT);
                throw new McpDenied(live.status, live.code, live.detail, {
                    grantId: grant.id,
                    userId: grant.user_id,
                    clientId: grant.client_id,
                });
            }
            const { principal } = live;
            return {
                token,
                clientId: principal.clientId,
                scopes: principal.scopes,
                expiresAt: access.expiresAt,
                resource: new URL(grant.resource),
                extra: { principal },
            };
        },
    };
}

export type GateResult =
    | { ok: true; authInfo: AuthInfo; principal: McpPrincipal }
    | { ok: false; status: number; headers: Record<string, string>; body: string };

/** The 401/403 a client needs: with `resource_metadata` so it can find the authorization server. */
export async function authenticateMcpRequest(
    db: Db,
    authorizationHeader: string | undefined,
): Promise<GateResult> {
    const config = mcpConfig();
    const resourceMetadataUrl = config.protectedResourceMetadataUrl;
    try {
        const authInfo = await verifyBearerToken(authorizationHeader, {
            verifier: tokenVerifier(db),
            requiredScopes: ["litt.read"],
            resourceMetadataUrl,
            expectedResource: new URL(config.resource),
        });
        return { ok: true, authInfo, principal: principalOf(authInfo) };
    } catch (error) {
        if (error instanceof McpDenied) {
            await recordMcpToolCall(db, {
                tool: "(protocol)",
                ...error.who,
                outcome: "denied",
                errorCode: error.code,
            });
            return {
                ok: false,
                status: error.status,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ error: error.code, error_description: error.detail }),
            };
        }
        if (!(error instanceof OAuthError)) {
            reportError(error, { tags: { component: "mcp", operation: "mcp.authenticate" } });
        }
        // Claude asks for the scopes named in the challenge: advertise every
        // one (insufficient_scope names only the one that is missing).
        const insufficient =
            error instanceof OAuthError && error.code === OAuthErrorCode.InsufficientScope;
        const response = bearerAuthChallengeResponse(error, {
            resourceMetadataUrl,
            requiredScopes: insufficient ? ["litt.read"] : [...MCP_SCOPES],
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return { ok: false, status: response.status, headers, body: await response.text() };
    }
}

/** Second half of the gate, once the body is read: scope per tool and the grant's budget. */
export async function preflightMcp(
    db: Db,
    principal: McpPrincipal,
    body: unknown,
): Promise<McpRefusal | null> {
    const refusal = preflightMcpRequest(
        MCP_TOOLS,
        principal,
        body,
        mcpConfig().protectedResourceMetadataUrl,
    );
    if (refusal)
        await recordMcpToolCall(db, {
            tool: refusal.tool,
            grantId: principal.grantId,
            userId: principal.userId,
            clientId: principal.clientId,
            outcome: refusal.outcome,
            errorCode: refusal.errorCode,
        });
    return refusal;
}

function buildServer(principal: McpPrincipal): McpServer {
    const server = new McpServer(
        {
            name: "litt",
            title: "LiTT",
            version: "0.1.0",
            websiteUrl: mcpConfig().issuer,
            icons: [{ ...LITT_MCP_ICON, sizes: [...LITT_MCP_ICON.sizes] }],
        },
        { capabilities: { tools: {} } },
    );
    registerMcpTools(server, MCP_TOOLS, principal);
    registerMcpPrompts(server, principal);
    registerMcpResources(server, principal);
    return server;
}

/** The principal revalidate() put on the request; a request without one never reaches a tool. */
function principalOf(authInfo: AuthInfo | undefined): McpPrincipal {
    const principal = (authInfo?.extra as { principal?: McpPrincipal } | undefined)?.principal;
    if (!principal) throw new AppError("mcp.no_principal", "[mcp] request reached /mcp without a principal");
    return principal;
}

let nodeHandler: ReturnType<typeof toNodeHandler> | null = null;

/** The factory runs per request, for that request's principal (no state lives in the server object). */
export function mcpNodeHandler(): ReturnType<typeof toNodeHandler> {
    if (!nodeHandler) {
        const onerror = (error: unknown) =>
            reportError(error, { tags: { component: "mcp", operation: "mcp.transport" } });
        nodeHandler = toNodeHandler(
            createMcpHandler((ctx) => buildServer(principalOf(ctx.authInfo)), { onerror }),
            { onerror },
        );
    }
    return nodeHandler;
}
