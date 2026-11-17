// The /mcp endpoint, minus HTTP framework: the MCP server (one `whoami`
// tool for now) and the bearer-token gate. The Express glue is in
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
import { z } from "zod";
import type { Db } from "../../lib/supabase";
import { reportError } from "../../lib/observability/report";
import { MCP_SCOPES, mcpConfig } from "./mcp.config";
import { verifyAccessToken } from "./mcp.tokens";

/** Header values are ASCII: the SDK copies this text into WWW-Authenticate. */
const INVALID_TOKEN_TEXT = "The access token is invalid, expired or revoked.";

export function tokenVerifier(db: Db): OAuthTokenVerifier {
    return {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
            const access = await verifyAccessToken(db, token);
            // A plain Error would answer 500 without a challenge, and clients
            // refresh on 401 only: an unknown token must be an OAuthError.
            if (!access)
                throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_TEXT);
            const { grant } = access;
            return {
                token,
                clientId: grant.client_id,
                scopes: grant.scopes,
                expiresAt: access.expiresAt,
                resource: new URL(grant.resource),
                extra: {
                    user_id: grant.user_id,
                    grant_id: grant.id,
                    workspaces: grant.workspaces,
                    default_workspace: grant.default_workspace,
                },
            };
        },
    };
}

export type GateResult =
    | { ok: true; authInfo: AuthInfo }
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
        return { ok: true, authInfo };
    } catch (error) {
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

function buildServer(): McpServer {
    const server = new McpServer(
        { name: "litt", version: "0.1.0" },
        { capabilities: { tools: {} } },
    );
    server.registerTool(
        "whoami",
        {
            title: "Who am I",
            description:
                "Shows which LiTT account, workspaces and permissions this connection is using.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
        },
        async (_args, ctx) => {
            const auth = ctx.http?.authInfo;
            const extra = (auth?.extra ?? {}) as Record<string, unknown>;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({
                            user_id: extra.user_id ?? null,
                            client_id: auth?.clientId ?? null,
                            scopes: auth?.scopes ?? [],
                            workspaces: extra.workspaces ?? [],
                            default_workspace: extra.default_workspace ?? null,
                        }),
                    },
                ],
            };
        },
    );
    return server;
}

let nodeHandler: ReturnType<typeof toNodeHandler> | null = null;

/** The factory runs per request (no state lives in the server object). */
export function mcpNodeHandler(): ReturnType<typeof toNodeHandler> {
    if (!nodeHandler) {
        const onerror = (error: unknown) =>
            reportError(error, { tags: { component: "mcp", operation: "mcp.transport" } });
        nodeHandler = toNodeHandler(createMcpHandler(() => buildServer(), { onerror }), { onerror });
    }
    return nodeHandler;
}
