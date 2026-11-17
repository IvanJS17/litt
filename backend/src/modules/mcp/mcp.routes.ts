// HTTP layer of the LiTT MCP server.
//
//   mcpPublicRouter   mounted at the root, BEFORE the app's CORS, limiter and
//                     JSON parser: discovery documents, the OAuth endpoints
//                     (/oauth/*) and the /mcp endpoint. They have their own
//                     CORS and body parsing, and answer nothing (the request
//                     falls through to a 404) unless LITT_MCP_SERVER=enabled.
//   mcpConsentRouter  mounted at /mcp-connect with the rest of the web API:
//                     what the consent page of the web app calls, under the
//                     person's own session.

import express, {
    Router,
    type NextFunction,
    type Request,
    type RequestHandler,
    type Response,
} from "express";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { bindRequestPrincipal } from "../../lib/managedAccounts";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { sendServiceFailure } from "../../lib/serviceResult";
import { mcpConfig, mcpConfigurationProblem } from "./mcp.config";
import { startAuthorization } from "./mcp.authorize";
import { registerDcrClient } from "./mcp.clients";
import { decideConsent, getConsentView, hasMfaEnrolled } from "./mcp.consent";
import { loadGrant, listGrantsForUser, revokeGrant } from "./mcp.grants";
import { listRecentToolCalls } from "./mcp.calls";
import { listChatsCreatedByGrant } from "../chat/chat.service";
import { authorizationServerMetadata, protectedResourceMetadata } from "./mcp.metadata";
import { authenticateMcpRequest, mcpNodeHandler, preflightMcp } from "./mcp.endpoint";
import type { OAuthResult } from "./mcp.shared";
import { exchangeAuthorizationCode, refreshTokens, revokeByToken } from "./mcp.tokens";

const problem = mcpConfigurationProblem();
if (problem) console.warn(`[mcp] the MCP server stays disabled: ${problem}`);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hide every MCP route unless the server is switched on. */
const onlyWhenEnabled: RequestHandler = (_req, _res, next) => {
    if (mcpConfig().enabled) return next();
    return next("router");
};

/** Discovery and the token endpoints are public: any origin may read them. */
function openCors(req: Request, res: Response, next: NextFunction) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
}

function oauthError(res: Response, error: string, description: string, status = 400) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return res.status(status).json({ error, error_description: description });
}

function sendOAuthFailure(res: Response, failure: Extract<OAuthResult<unknown>, { ok: false }>) {
    return oauthError(res, failure.error, failure.description, failure.status ?? 400);
}

/** A failure we did not expect is reported and answered as `server_error`. */
function oauthRoute(
    handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
    return (req, res) => {
        handler(req, res).catch((error: unknown) => {
            const status = (error as { status?: number } | null)?.status ?? 0;
            if (!res.headersSent && status >= 400 && status < 500) {
                // A body that does not parse is the caller's mistake.
                if (req.path === "/mcp")
                    return void res.status(status === 413 ? 413 : 400).json({
                        jsonrpc: "2.0",
                        error: { code: -32700, message: "Parse error" },
                        id: null,
                    });
                return void oauthError(res, "invalid_request", "The request body could not be read.", status);
            }
            reportError(error, { tags: { component: "mcp", operation: "mcp.oauth" } });
            if (!res.headersSent)
                oauthError(res, "server_error", "The server could not complete the request.", 500);
        });
    };
}

function formString(body: unknown, key: string): string | undefined {
    const value = (body as Record<string, unknown> | undefined)?.[key];
    return typeof value === "string" ? value : undefined;
}

export const mcpPublicRouter = Router();

mcpPublicRouter.use(
    [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/oauth",
        "/mcp",
    ],
    onlyWhenEnabled,
);

// ---- Discovery ---------------------------------------------------------------

mcpPublicRouter.use(["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"], openCors);

// Claude falls back from the path-specific document to the root one.
mcpPublicRouter.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (_req, res) => {
        res.setHeader("Cache-Control", "public, max-age=300");
        res.json(protectedResourceMetadata());
    },
);
mcpPublicRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(authorizationServerMetadata());
});

// ---- OAuth endpoints -----------------------------------------------------------

mcpPublicRouter.get(
    "/oauth/authorize",
    oauthRoute(async (req, res) => {
        const outcome = await startAuthorization(createServerSupabase(), req.query);
        res.setHeader("Cache-Control", "no-store");
        if (outcome.kind === "page_error")
            return oauthError(res, outcome.error, outcome.description, outcome.status);
        return res.redirect(302, outcome.location);
    }),
);

mcpPublicRouter.use(["/oauth/token", "/oauth/register", "/oauth/revoke"], openCors);

mcpPublicRouter.post(
    "/oauth/register",
    express.json({ limit: "32kb" }),
    oauthRoute(async (req, res) => {
        const result = await registerDcrClient(createServerSupabase(), req.body);
        res.setHeader("Cache-Control", "no-store");
        if (!result.ok) return sendOAuthFailure(res, result);
        return res.status(201).json(result.data);
    }),
);

mcpPublicRouter.post(
    "/oauth/token",
    express.urlencoded({ extended: false, limit: "16kb" }),
    oauthRoute(async (req, res) => {
        const params = {
            client_id: formString(req.body, "client_id"),
            code: formString(req.body, "code"),
            code_verifier: formString(req.body, "code_verifier"),
            redirect_uri: formString(req.body, "redirect_uri"),
            refresh_token: formString(req.body, "refresh_token"),
            scope: formString(req.body, "scope"),
            resource: formString(req.body, "resource"),
        };
        const grantType = formString(req.body, "grant_type");
        const db = createServerSupabase();
        const result =
            grantType === "authorization_code"
                ? await exchangeAuthorizationCode(db, params)
                : grantType === "refresh_token"
                  ? await refreshTokens(db, params)
                  : null;
        if (!result)
            return oauthError(
                res,
                "unsupported_grant_type",
                "grant_type must be authorization_code or refresh_token.",
            );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        if (!result.ok) return sendOAuthFailure(res, result);
        return res.json(result.data);
    }),
);

mcpPublicRouter.post(
    "/oauth/revoke",
    express.urlencoded({ extended: false, limit: "16kb" }),
    oauthRoute(async (req, res) => {
        const token = formString(req.body, "token");
        if (!token) return oauthError(res, "invalid_request", "token is required.");
        await revokeByToken(createServerSupabase(), {
            token,
            clientId: formString(req.body, "client_id"),
        });
        // RFC 7009: the answer is the same whether or not the token existed.
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).end();
    }),
);

// ---- /mcp ------------------------------------------------------------------------

/**
 * Anthropic's connectors call from servers and send no Origin. A browser
 * page does, and may only reach /mcp from an origin the operator listed.
 */
function mcpOrigin(req: Request, res: Response, next: NextFunction) {
    const origin = req.get("origin");
    if (origin) {
        if (!mcpConfig().allowedOrigins.has(origin)) {
            res.status(403).json({ error: "forbidden_origin", error_description: "Origin not allowed." });
            return;
        }
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
        );
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
}

mcpPublicRouter.all(
    "/mcp",
    mcpOrigin,
    oauthRoute(async (req, res) => {
        const db = createServerSupabase();
        const gate = await authenticateMcpRequest(db, req.headers.authorization);
        if (!gate.ok) {
            for (const [name, value] of Object.entries(gate.headers)) {
                // The body is rewritten below: its length and type are ours.
                if (!/^content-(length|type)$/i.test(name)) res.setHeader(name, value);
            }
            res.setHeader("Content-Type", "application/json");
            return res.status(gate.status).send(gate.body);
        }
        // The SDK reads the verified principal from req.auth.
        Object.assign(req, { auth: gate.authInfo });
        await new Promise<void>((resolve, reject) =>
            express.json({ limit: "1mb" })(req, res, (error?: unknown) =>
                error ? reject(error) : resolve(),
            ),
        );
        // Whatever the person may do is judged per request, on the live
        // principal: the same lookups every web request makes.
        bindRequestPrincipal({
            userId: gate.principal.userId,
            personalWorkspaceDisabled: gate.principal.personalWorkspaceDisabled,
        });
        const refusal = await preflightMcp(db, gate.principal, req.body);
        if (refusal) {
            for (const [name, value] of Object.entries(refusal.headers)) res.setHeader(name, value);
            res.setHeader("Cache-Control", "no-store");
            return res.status(refusal.status).json(refusal.body);
        }
        await mcpNodeHandler()(req, res, req.body);
    }),
);

// A body that does not parse is the caller's mistake, not a server failure.
mcpPublicRouter.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const status = (error as { status?: number; statusCode?: number })?.status ?? 0;
    if (res.headersSent || !(status >= 400 && status < 500)) return next(error);
    if (req.path === "/mcp")
        return void res.status(status === 413 ? 413 : 400).json({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
        });
    return oauthError(res, "invalid_request", "The request body could not be read.", status);
});

// ---- Consent page API ---------------------------------------------------------------

export const mcpConsentRouter = Router();
mcpConsentRouter.use(onlyWhenEnabled);

const workspaceChoices = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : undefined;

mcpConsentRouter.get(
    "/authorizations/:requestId",
    requireAuth,
    requireMfaIfEnrolled,
    asyncRoute(async (req, res) => {
        const result = await getConsentView(createServerSupabase(), {
            requestId: String(req.params.requestId),
            userId: res.locals.userId as string,
            personalWorkspaceDisabled: res.locals.personalWorkspaceDisabled === true,
        });
        if (!result.ok) return sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

mcpConsentRouter.post(
    "/authorizations/:requestId/decision",
    requireAuth,
    requireMfaIfEnrolled,
    asyncRoute(async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (body.decision !== "approve" && body.decision !== "deny")
            return void res
                .status(400)
                .json({ code: "validation_failed", detail: "decision must be approve or deny." });
        const db = createServerSupabase();
        const result = await decideConsent(db, {
            requestId: String(req.params.requestId),
            userId: res.locals.userId as string,
            personalWorkspaceDisabled: res.locals.personalWorkspaceDisabled === true,
            mfaVerified: body.decision === "approve" ? await hasMfaEnrolled(db, res.locals.token as string) : false,
            decision: body.decision,
            workspaces: workspaceChoices(body.workspaces),
            scopes: workspaceChoices(body.scopes),
            defaultWorkspace:
                typeof body.default_workspace === "string" ? body.default_workspace : undefined,
        });
        if (!result.ok) return sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// The person's connected apps: list and revoke (design §6.6).
mcpConsentRouter.get(
    "/grants",
    requireAuth,
    asyncRoute(async (_req, res) => {
        res.json({ grants: await listGrantsForUser(createServerSupabase(), res.locals.userId as string) });
    }),
);

// What one connection did lately and the conversations it started (design
// §5): tool, time, workspace and outcome of its calls, never their content.
mcpConsentRouter.get(
    "/grants/:grantId/activity",
    requireAuth,
    asyncRoute(async (req, res) => {
        const grantId = String(req.params.grantId);
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const grant = UUID_PATTERN.test(grantId) ? await loadGrant(db, grantId) : null;
        if (!grant || grant.user_id !== userId)
            return void res.status(404).json({ code: "grant_not_found", detail: "Connection not found." });
        const [calls, chats] = await Promise.all([
            listRecentToolCalls(db, { grantId, userId, limit: 20 }),
            listChatsCreatedByGrant(db, {
                userId,
                userEmail: (res.locals.userEmail as string | undefined) || undefined,
                grantId,
                limit: 20,
            }),
        ]);
        if (!chats.ok) throw new AppError("mcp.db_failed", "[mcp] grant chats failed", { cause: chats.error });
        res.setHeader("Cache-Control", "no-store");
        res.json({
            calls,
            chats: chats.data.map((chat) => ({
                id: chat.id,
                title: chat.title,
                project_id: chat.project_id,
                workspace: chat.org_id ?? "personal",
                created_at: chat.created_at,
            })),
        });
    }),
);

mcpConsentRouter.delete(
    "/grants/:grantId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const grantId = String(req.params.grantId);
        if (!UUID_PATTERN.test(grantId))
            return void res.status(404).json({ code: "grant_not_found", detail: "Connection not found." });
        const revoked = await revokeGrant(createServerSupabase(), {
            grantId,
            userId: res.locals.userId as string,
            reason: "user_revoked",
        });
        if (!revoked)
            return void res.status(404).json({ code: "grant_not_found", detail: "Connection not found." });
        res.status(204).end();
    }),
);

mcpConsentRouter.use(routerErrorHandler("[mcp-connect]"));
