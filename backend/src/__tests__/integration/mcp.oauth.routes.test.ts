import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// The MCP server's authorization server and /mcp endpoint, over HTTP, against
// an in-memory database. The consent page's own session is the stubbed
// requireAuth; everything the OAuth endpoints do is real.
const h = vi.hoisted(() => ({
    caller: { id: "user-1", email: "ana@firm.example" },
    personalDisabled: false,
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
    documents: new Map<string, () => Response>(),
    fetched: [] as string[],
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => h.state!.db),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.caller.id;
                res.locals.userEmail = h.caller.email;
                res.locals.personalWorkspaceDisabled = h.personalDisabled;
                res.locals.token = "web-session-token";
                next();
            }),
    };
});
// CIMD documents come from a fixture table; any other URL goes through the
// REAL guard (which is what the SSRF cases exercise).
vi.mock("../../lib/mcp/client", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../lib/mcp/client")>();
    return {
        ...original,
        guardedFetch: vi.fn(async (input: string, init?: RequestInit, options?: object) => {
            const fixture = h.documents.get(String(input));
            if (fixture) {
                h.fetched.push(String(input));
                return fixture();
            }
            return original.guardedFetch(input, init, options);
        }),
    };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { LEGAL_VERSION } from "../../modules/user/user.service";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";
const WEB = "http://localhost:3000";

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        mcp_oauth_clients: [],
        mcp_oauth_requests: [],
        mcp_grants: [],
        mcp_oauth_codes: [],
        mcp_oauth_tokens: [],
        mcp_oauth_audit: [],
        org_members: [{ org_id: "11111111-1111-4111-8111-111111111111", user_id: "user-1", role: "member" }],
        organizations: [{ id: "11111111-1111-4111-8111-111111111111", name: "Firm A", kind: "firm", deleted_at: null, authorization_epoch: 4 }],
        training_stages: [],
        mcp_tool_calls: [],
        audit_events: [],
        user_profiles: [{ user_id: "user-1", terms_accepted_version: LEGAL_VERSION }],
    };
    h.state = memoryDb(tables, { mcp_oauth_purge: () => null });
    (h.state.db as { auth?: unknown }).auth = {
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    };
    h.caller = { id: "user-1", email: "ana@firm.example" };
    h.personalDisabled = false;
    h.documents.clear();
    h.fetched = [];
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", WEB);
});
afterEach(() => vi.unstubAllEnvs());

const tables = () => h.state!.tables;

async function register(redirect = REDIRECT) {
    const res = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none" });
    expect(res.status).toBe(201);
    return res.body.client_id as string;
}

type Authorize = { clientId: string; redirect?: string; extra?: Record<string, string>; challenge?: string };
const authorize = ({ clientId, redirect = REDIRECT, extra = {}, challenge }: Authorize) =>
    request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirect,
            code_challenge: challenge ?? challengeOf("x".repeat(43)),
            code_challenge_method: "S256",
            resource: RESOURCE,
            scope: "litt.read litt.chat",
            state: "st-1",
            ...extra,
        })
        .redirects(0);

const requestIdOf = (location: string) => new URL(location).searchParams.get("request")!;

/** DCR → authorize → consent → code → token. */
async function connect(opts: { redirect?: string; clientId?: string; workspaces?: string[]; scopes?: string[] } = {}) {
    const clientId = opts.clientId ?? (await register(opts.redirect));
    const v = verifier();
    const redirect = opts.redirect ?? REDIRECT;
    const auth = await authorize({ clientId, redirect, challenge: challengeOf(v) });
    expect(auth.status).toBe(302);
    const requestId = requestIdOf(auth.headers.location);
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: opts.workspaces ?? ["personal"], scopes: opts.scopes ?? ["litt.read", "litt.chat"] });
    expect(decision.status).toBe(200);
    const back = new URL(decision.body.redirect_url);
    const code = back.searchParams.get("code")!;
    const token = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: redirect, resource: RESOURCE });
    return { clientId, v, code, back, token, requestId };
}

const rpc = (method: string, token?: string, params: object = {}, id = 1) => {
    const req = request(app)
        .post("/mcp")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", "2025-11-25")
        .send({ jsonrpc: "2.0", id, method, params });
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
};

describe("the feature flag", () => {
    it("answers nothing while LITT_MCP_SERVER is not enabled", async () => {
        vi.stubEnv("LITT_MCP_SERVER", "disabled");
        for (const path of [
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-authorization-server",
            "/oauth/authorize",
            "/mcp-connect/grants",
        ])
            expect((await request(app).get(path)).status, path).toBe(404);
        expect((await request(app).post("/oauth/token").type("form").send({})).status).toBe(404);
        expect((await request(app).post("/oauth/register").send({})).status).toBe(404);
        expect((await rpc("tools/list")).status).toBe(404);
    });

    it("stays disabled in production without a public https URL", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("LITT_MCP_PUBLIC_URL", "");
        expect((await request(app).get("/.well-known/oauth-authorization-server")).status).toBe(404);
    });
});

describe("discovery", () => {
    it("publishes the protected resource, exact and with the root fallback", async () => {
        for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
            const res = await request(app).get(path);
            expect(res.status).toBe(200);
            expect(res.body.resource).toBe(RESOURCE);
            expect(res.body.authorization_servers).toEqual([ISSUER]);
            expect(res.body.scopes_supported).toEqual(["litt.read", "litt.run", "litt.write", "litt.chat"]);
            expect(res.headers["access-control-allow-origin"]).toBe("*");
        }
    });

    it("publishes the authorization server with PKCE S256, CIMD, iss and public clients", async () => {
        const res = await request(app).get("/.well-known/oauth-authorization-server");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/oauth/authorize`,
            token_endpoint: `${ISSUER}/oauth/token`,
            registration_endpoint: `${ISSUER}/oauth/register`,
            revocation_endpoint: `${ISSUER}/oauth/revoke`,
            code_challenge_methods_supported: ["S256"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            client_id_metadata_document_supported: true,
            authorization_response_iss_parameter_supported: true,
        });
    });

    it("answers a CORS preflight on the discovery and token endpoints", async () => {
        const res = await request(app).options("/oauth/token").set("Origin", "https://inspector.example");
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBe("*");
    });
});

describe("POST /oauth/register (DCR)", () => {
    it("registers a public client and stores nothing secret", async () => {
        const res = await request(app)
            .post("/oauth/register")
            .send({ client_name: "Hermes", redirect_uris: ["http://127.0.0.1:27890/callback"] });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            client_name: "Hermes",
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
        });
        expect(res.body.client_secret).toBeUndefined();
        expect(tables().mcp_oauth_clients).toHaveLength(1);
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toEqual(["client_registered"]);
    });

    it.each([
        ["http (non-loopback) redirect", { redirect_uris: ["http://evil.example/cb"] }],
        ["javascript redirect", { redirect_uris: ["javascript:alert(1)"] }],
        ["redirect with a fragment", { redirect_uris: ["https://a.example/cb#x"] }],
        ["no redirects", { redirect_uris: [] }],
        ["a confidential client", { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }],
        ["an unsupported grant", { redirect_uris: [REDIRECT], grant_types: ["client_credentials"] }],
    ])("refuses %s", async (_name, body) => {
        const res = await request(app).post("/oauth/register").send(body);
        expect(res.status).toBe(400);
        expect(["invalid_redirect_uri", "invalid_client_metadata"]).toContain(res.body.error);
        expect(tables().mcp_oauth_clients).toHaveLength(0);
    });

    it("purges stale registrations on each registration", async () => {
        const purge = vi.fn(() => null);
        h.state = memoryDb(tables(), { mcp_oauth_purge: purge });
        await register();
        expect(purge).toHaveBeenCalledTimes(1);
    });
});

describe("GET /oauth/authorize", () => {
    it("sends a valid request to the consent page with an unguessable request id", async () => {
        const clientId = await register();
        const res = await authorize({ clientId });
        expect(res.status).toBe(302);
        const location = new URL(res.headers.location);
        expect(`${location.origin}${location.pathname}`).toBe(`${WEB}/connect/authorize`);
        const id = location.searchParams.get("request")!;
        expect(id.length).toBeGreaterThanOrEqual(40);
        // Only the hash is stored.
        expect(JSON.stringify(tables().mcp_oauth_requests)).not.toContain(id);
        expect(tables().mcp_oauth_requests[0]).toMatchObject({ scopes: ["litt.read", "litt.chat"], resource: RESOURCE });
    });

    it("requires PKCE S256 and reports it to the client, with iss", async () => {
        const clientId = await register();
        for (const extra of [{ code_challenge_method: "plain" }, { code_challenge: "" }] as Record<string, string>[]) {
            const res = await authorize({ clientId, extra });
            expect(res.status).toBe(302);
            const back = new URL(res.headers.location);
            expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
            expect(back.searchParams.get("error")).toBe("invalid_request");
            expect(back.searchParams.get("state")).toBe("st-1");
            expect(back.searchParams.get("iss")).toBe(ISSUER);
        }
        const none = await request(app)
            .get("/oauth/authorize")
            .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE })
            .redirects(0);
        expect(new URL(none.headers.location).searchParams.get("error")).toBe("invalid_request");
        expect(tables().mcp_oauth_requests).toHaveLength(0);
    });

    it("never redirects to a redirect_uri the client did not register", async () => {
        const clientId = await register();
        const res = await authorize({ clientId, redirect: "https://evil.example/cb" });
        expect(res.status).toBe(400);
        expect(res.headers.location).toBeUndefined();
        expect(res.body.error).toBe("invalid_request");
    });

    it("does not reveal whether a client exists", async () => {
        const res = await authorize({ clientId: "litt_dcr_nope" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_client");
    });

    it("refuses another resource with invalid_target", async () => {
        const clientId = await register();
        const res = await authorize({ clientId, extra: { resource: "https://other.example/mcp" } });
        expect(new URL(res.headers.location).searchParams.get("error")).toBe("invalid_target");
    });

    it("refuses a response_type other than code and unknown scopes", async () => {
        const clientId = await register();
        expect(new URL((await authorize({ clientId, extra: { response_type: "token" } })).headers.location).searchParams.get("error")).toBe("unsupported_response_type");
        expect(new URL((await authorize({ clientId, extra: { scope: "admin" } })).headers.location).searchParams.get("error")).toBe("invalid_scope");
    });

    it("defaults to the read scope and to this server's resource", async () => {
        const clientId = await register();
        const res = await request(app)
            .get("/oauth/authorize")
            .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf("y".repeat(43)), code_challenge_method: "S256" })
            .redirects(0);
        expect(res.status).toBe(302);
        expect(tables().mcp_oauth_requests[0]).toMatchObject({ scopes: ["litt.read"], resource: RESOURCE });
    });

    it("matches a loopback redirect on any port, by exact path", async () => {
        const clientId = await register("http://127.0.0.1/callback");
        expect((await authorize({ clientId, redirect: "http://127.0.0.1:51234/callback" })).status).toBe(302);
        expect((await authorize({ clientId, redirect: "http://127.0.0.1:51234/other" })).status).toBe(400);
        expect((await authorize({ clientId, redirect: "http://localhost:51234/callback" })).status).toBe(400);
    });
});

describe("the consent page API", () => {
    it("shows the client, the redirect host, the scopes and the person's workspaces", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.status).toBe(200);
        expect(res.body.client).toMatchObject({
            name: "Claude",
            redirect_host: "claude.example",
            loopback_only: false,
        });
        expect(res.body.scopes).toEqual(["litt.read", "litt.chat"]);
        expect(res.body.workspaces).toEqual([
            { id: "personal", name: null, kind: "personal" },
            { id: "11111111-1111-4111-8111-111111111111", name: "Firm A", kind: "organization" },
        ]);
    });

    it("warns when every redirect is on the visitor's own machine", async () => {
        const clientId = await register("http://localhost/callback");
        const requestId = requestIdOf((await authorize({ clientId, redirect: "http://localhost:4000/callback" })).headers.location);
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.body.client.loopback_only).toBe(true);
        expect(res.body.client.redirect_host).toBe("localhost");
    });

    it("does not offer Personal to a managed account", async () => {
        h.personalDisabled = true;
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.body.workspaces.map((w: { id: string }) => w.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
        const refused = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        expect(refused.status).toBe(400);
    });

    it("refuses a workspace the person does not belong to, and leaves the request open", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const bad = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["22222222-2222-4222-8222-222222222222"], scopes: ["litt.read"] });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe("mcp_invalid_workspaces");
        const ok = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        expect(ok.status).toBe(200);
    });

    it("refuses a scope that was not requested", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const bad = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.write"] });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe("mcp_invalid_scopes");
    });

    it("takes one decision per request", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const send = () =>
            request(app)
                .post(`/mcp-connect/authorizations/${requestId}/decision`)
                .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        expect((await send()).status).toBe(200);
        expect((await send()).status).toBe(404);
        expect(tables().mcp_grants).toHaveLength(1);
    });

    it("answers an expired request as expired", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        tables().mcp_oauth_requests[0].expires_at = "2000-01-01T00:00:00.000Z";
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("mcp_request_expired");
    });

    it("sends access_denied back to the client, with state and iss, when the person denies", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        const res = await request(app).post(`/mcp-connect/authorizations/${requestId}/decision`).send({ decision: "deny" });
        expect(res.status).toBe(200);
        const back = new URL(res.body.redirect_url);
        expect(back.searchParams.get("error")).toBe("access_denied");
        expect(back.searchParams.get("state")).toBe("st-1");
        expect(back.searchParams.get("iss")).toBe(ISSUER);
        expect(tables().mcp_grants).toHaveLength(0);
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toContain("consent_denied");
    });

    it("records MFA at consent when the person has it enrolled", async () => {
        (h.state!.db as { auth: { mfa: { getAuthenticatorAssuranceLevel: unknown } } }).auth.mfa.getAuthenticatorAssuranceLevel = async () => ({
            data: { currentLevel: "aal2", nextLevel: "aal2" },
            error: null,
        });
        await connect();
        expect(tables().mcp_grants[0].mfa_verified_at).toEqual(expect.any(String));
    });
});

describe("opening the approval screen marks the client as in use", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const seedOld = () => {
        tables().mcp_oauth_clients.push({
            client_id: "litt_dcr_old",
            kind: "dcr",
            client_name: "Old",
            redirect_uris: [REDIRECT],
            created_at: new Date(Date.now() - 8 * DAY).toISOString(),
            last_used_at: null,
        });
    };
    const client = () => tables().mcp_oauth_clients.find((c) => c.client_id === "litt_dcr_old")!;
    /** What the clean-up reads: the later of last use and creation, against seven days. */
    const idleForSevenDays = (c: Record<string, unknown>) =>
        Date.parse(String(c.last_used_at ?? c.created_at)) < Date.now() - 7 * DAY;
    const openRequestFor = async () => requestIdOf((await authorize({ clientId: "litt_dcr_old" })).headers.location);

    it("marks it, so the clean-up keeps the client and its open request", async () => {
        seedOld();
        const requestId = await openRequestFor();
        expect(client().last_used_at ?? null).toBeNull();
        expect(idleForSevenDays(client())).toBe(true);
        const before = Date.now();
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.status).toBe(200);
        expect(Date.parse(String(client().last_used_at))).toBeGreaterThanOrEqual(before - 1000);
        expect(idleForSevenDays(client())).toBe(false);
        expect(tables().mcp_oauth_requests).toHaveLength(1);
    });

    it("marks only the client of the request the person opened", async () => {
        seedOld();
        tables().mcp_oauth_clients.push({
            client_id: "litt_dcr_other_old",
            kind: "dcr",
            client_name: "Other",
            redirect_uris: [REDIRECT],
            created_at: new Date(Date.now() - 8 * DAY).toISOString(),
            last_used_at: null,
        });
        const requestId = await openRequestFor();
        expect((await request(app).get(`/mcp-connect/authorizations/${requestId}`)).status).toBe(200);
        expect(client().last_used_at ?? null).not.toBeNull();
        const other = tables().mcp_oauth_clients.find((c) => c.client_id === "litt_dcr_other_old")!;
        expect(other.last_used_at ?? null).toBeNull();
    });

    it("is not done by the authorization request without a session", async () => {
        seedOld();
        const res = await authorize({ clientId: "litt_dcr_old" });
        expect(res.status).toBe(302);
        expect(client().last_used_at ?? null).toBeNull();
        expect(idleForSevenDays(client())).toBe(true);
    });

    it("shows nothing and answers the generic failure when the mark cannot be written, naming no person or client in the log", async () => {
        seedOld();
        const requestId = await openRequestFor();
        const logged: string[] = [];
        for (const method of ["error", "warn", "log"] as const)
            vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
                logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
            });
        h.state!.failNext("mcp_oauth_clients", "update", { message: "write unavailable" });
        const res = await request(app).get(`/mcp-connect/authorizations/${requestId}`);
        expect(res.status).toBe(500);
        expect(res.body.client).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain("write unavailable");
        expect(client().last_used_at ?? null).toBeNull();
        const text = logged.join("\n");
        expect(text).toContain("mcp.db_failed");
        for (const secret of ["user-1", "ana@firm.example", "litt_dcr_old", "web-session-token"]) expect(text).not.toContain(secret);
        vi.restoreAllMocks();
    });

    it("still lets the person approve after opening the screen", async () => {
        seedOld();
        const requestId = await openRequestFor();
        expect((await request(app).get(`/mcp-connect/authorizations/${requestId}`)).status).toBe(200);
        const res = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        expect(res.status).toBe(200);
        expect(new URL(res.body.redirect_url).searchParams.get("code")).toBeTruthy();
        expect(tables().mcp_grants).toHaveLength(1);
        expect(idleForSevenDays(client())).toBe(false);
    });

    it("still lets the person refuse after opening the screen", async () => {
        seedOld();
        const requestId = await openRequestFor();
        expect((await request(app).get(`/mcp-connect/authorizations/${requestId}`)).status).toBe(200);
        const res = await request(app).post(`/mcp-connect/authorizations/${requestId}/decision`).send({ decision: "deny" });
        expect(res.status).toBe(200);
        expect(new URL(res.body.redirect_url).searchParams.get("error")).toBe("access_denied");
        expect(tables().mcp_grants).toHaveLength(0);
    });
});

describe("authorization code → tokens", () => {
    it("issues opaque tokens bound to the user, client, workspaces and resource, stored hashed", async () => {
        const { token, back, code } = await connect({ workspaces: ["personal", "11111111-1111-4111-8111-111111111111"] });
        expect(back.searchParams.get("iss")).toBe(ISSUER);
        expect(back.searchParams.get("state")).toBe("st-1");
        expect(token.status).toBe(200);
        expect(token.headers["cache-control"]).toBe("no-store");
        expect(token.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "litt.read litt.chat" });
        const grant = tables().mcp_grants[0];
        expect(grant).toMatchObject({
            user_id: "user-1",
            resource: RESOURCE,
            scopes: ["litt.read", "litt.chat"],
            workspaces: ["personal", "11111111-1111-4111-8111-111111111111"],
            default_workspace: "personal",
        });
        const stored = JSON.stringify(tables());
        for (const secret of [token.body.access_token, token.body.refresh_token, code])
            expect(stored).not.toContain(secret);
        expect(tables().mcp_oauth_tokens).toHaveLength(2);
    });

    it("refuses a wrong code_verifier", async () => {
        const clientId = await register();
        const v = verifier();
        const requestId = requestIdOf((await authorize({ clientId, challenge: challengeOf(v) })).headers.location);
        const decision = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
        const res = await request(app)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier(), redirect_uri: REDIRECT });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_grant");
        expect(tables().mcp_oauth_tokens).toHaveLength(0);
        // The code is spent even by a failed attempt.
        const retry = await request(app)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT });
        expect(retry.body.error).toBe("invalid_grant");
    });

    it("refuses another redirect_uri, another client and a malformed verifier", async () => {
        const clientId = await register();
        const other = await register();
        const v = verifier();
        const grant = async () => {
            const requestId = requestIdOf((await authorize({ clientId, challenge: challengeOf(v) })).headers.location);
            const decision = await request(app)
                .post(`/mcp-connect/authorizations/${requestId}/decision`)
                .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
            return new URL(decision.body.redirect_url).searchParams.get("code")!;
        };
        const exchange = (body: Record<string, string>) =>
            request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", redirect_uri: REDIRECT, code_verifier: v, client_id: clientId, ...body });
        expect((await exchange({ code: await grant(), redirect_uri: "https://claude.example/other" })).body.error).toBe("invalid_grant");
        expect((await exchange({ code: await grant(), client_id: other })).body.error).toBe("invalid_grant");
        expect((await exchange({ code: await grant(), code_verifier: "short" })).body.error).toBe("invalid_grant");
        expect((await exchange({ code: await grant(), resource: "https://other.example/mcp" })).body.error).toBe("invalid_target");
    });

    it("revokes the grant when a used code comes back", async () => {
        const { clientId, v, code, token } = await connect();
        const replay = await request(app)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT });
        expect(replay.status).toBe(400);
        expect(replay.body.error).toBe("invalid_grant");
        expect(tables().mcp_grants[0].revoked_at).toEqual(expect.any(String));
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toContain("code_reuse_detected");
    });

    it("answers an unknown grant_type and a missing field in OAuth terms", async () => {
        const grant = await request(app).post("/oauth/token").type("form").send({ grant_type: "password" });
        expect(grant.status).toBe(400);
        expect(grant.body.error).toBe("unsupported_grant_type");
        const missing = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code" });
        expect(missing.body.error).toBe("invalid_request");
    });
});

describe("refresh token rotation", () => {
    const refresh = (clientId: string, token: string, extra: Record<string, string> = {}) =>
        request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, ...extra });

    it("returns a new pair in the same response and retires the old refresh token", async () => {
        const { clientId, token } = await connect();
        const next = await refresh(clientId, token.body.refresh_token);
        expect(next.status).toBe(200);
        expect(next.body.refresh_token).not.toBe(token.body.refresh_token);
        expect(next.body.access_token).not.toBe(token.body.access_token);
        expect((await rpc("tools/list", next.body.access_token)).status).toBe(200);
    });

    it("treats a reused refresh token as theft: the whole grant dies", async () => {
        const { clientId, token } = await connect();
        const first = await refresh(clientId, token.body.refresh_token);
        expect(first.status).toBe(200);
        const replay = await refresh(clientId, token.body.refresh_token);
        expect(replay.status).toBe(400);
        expect(replay.body.error).toBe("invalid_grant");
        expect(tables().mcp_grants[0]).toMatchObject({ revoked_reason: "refresh_reuse" });
        // Even the newest pair no longer works.
        expect((await refresh(clientId, first.body.refresh_token)).body.error).toBe("invalid_grant");
        expect((await rpc("tools/list", first.body.access_token)).status).toBe(401);
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toContain("refresh_reuse_detected");
    });

    it("does not honour another client's refresh token", async () => {
        const { token } = await connect();
        const intruder = await register();
        const res = await refresh(intruder, token.body.refresh_token);
        expect(res.body.error).toBe("invalid_grant");
        expect(tables().mcp_grants[0].revoked_at ?? null).toBeNull();
    });

    it("never widens the scope", async () => {
        const { clientId, token } = await connect();
        expect((await refresh(clientId, token.body.refresh_token, { scope: "litt.read litt.write" })).body.error).toBe("invalid_scope");
    });

    it("refuses an expired refresh token", async () => {
        const { clientId, token } = await connect();
        for (const row of tables().mcp_oauth_tokens) row.expires_at = "2000-01-01T00:00:00.000Z";
        expect((await refresh(clientId, token.body.refresh_token)).body.error).toBe("invalid_grant");
    });

    it("reports the access token's real life when the grant ends sooner", async () => {
        const { clientId, token } = await connect();
        tables().mcp_grants[0].expires_at = new Date(Date.now() + 600_000).toISOString();
        const res = await refresh(clientId, token.body.refresh_token);
        expect(res.status).toBe(200);
        expect(res.body.expires_in).toBeGreaterThan(590);
        expect(res.body.expires_in).toBeLessThanOrEqual(600);
    });

    it("stops at the grant's absolute lifetime", async () => {
        const { clientId, token } = await connect();
        tables().mcp_grants[0].expires_at = "2000-01-01T00:00:00.000Z";
        expect((await refresh(clientId, token.body.refresh_token)).body.error).toBe("invalid_grant");
    });
});

describe("revocation", () => {
    it("RFC 7009: revoking a refresh token kills the grant, and an unknown token is still a 200", async () => {
        const { clientId, token } = await connect();
        const res = await request(app).post("/oauth/revoke").type("form").send({ token: token.body.refresh_token, client_id: clientId });
        expect(res.status).toBe(200);
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
        expect((await request(app).post("/oauth/revoke").type("form").send({ token: "nothing-like-it" })).status).toBe(200);
        expect(tables().mcp_oauth_audit.filter((r) => r.event === "grant_revoked")).toHaveLength(1);
    });

    it("still answers 200 when the audit row of a done revocation cannot be written", async () => {
        const { clientId, token } = await connect();
        h.state!.failNext("mcp_oauth_audit", "insert", { message: "down" });
        const res = await request(app).post("/oauth/revoke").type("form").send({ token: token.body.refresh_token, client_id: clientId });
        expect(res.status).toBe(200);
        expect(tables().mcp_grants[0].revoked_at).toBeTruthy();
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
    });

    it("ignores a revocation sent in another client's name", async () => {
        const { token } = await connect();
        const intruder = await register();
        await request(app).post("/oauth/revoke").type("form").send({ token: token.body.access_token, client_id: intruder });
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(200);
    });

    it("lets the person list and revoke their connected apps, and nobody else's", async () => {
        const { token } = await connect();
        const list = await request(app).get("/mcp-connect/grants");
        expect(list.body.server_url).toBe(RESOURCE);
        expect(list.body.grants).toHaveLength(1);
        expect(list.body.grants[0]).toMatchObject({ client_name: "Claude", scopes: ["litt.read", "litt.chat"] });
        const id = list.body.grants[0].id as string;

        h.caller = { id: "user-2", email: "bea@firm.example" };
        expect((await request(app).delete(`/mcp-connect/grants/${id}`)).status).toBe(404);
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(200);

        h.caller = { id: "user-1", email: "ana@firm.example" };
        expect((await request(app).delete(`/mcp-connect/grants/${id}`)).status).toBe(204);
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
        expect((await request(app).get("/mcp-connect/grants")).body.grants).toHaveLength(0);
    });
});

describe("client ID metadata documents (CIMD)", () => {
    const CLIENT = "https://app.example/oauth/client.json";
    const doc = (over: Record<string, unknown> = {}) => () =>
        new Response(JSON.stringify({ client_id: CLIENT, client_name: "Hermes", redirect_uris: ["http://127.0.0.1/callback"], ...over }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
        });

    it("fetches the document, caches the client and runs the whole flow", async () => {
        h.documents.set(CLIENT, doc());
        const { token } = await connect({ clientId: CLIENT, redirect: "http://127.0.0.1:27890/callback" });
        expect(token.status).toBe(200);
        expect(h.fetched).toEqual([CLIENT]);
        expect(tables().mcp_oauth_clients[0]).toMatchObject({ client_id: CLIENT, kind: "cimd", client_name: "Hermes" });
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toContain("cimd_fetched");
    });

    it("does not fetch again while the cached copy is fresh", async () => {
        h.documents.set(CLIENT, doc());
        await authorize({ clientId: CLIENT, redirect: "http://127.0.0.1:1234/callback" });
        await authorize({ clientId: CLIENT, redirect: "http://127.0.0.1:1234/callback" });
        expect(h.fetched).toHaveLength(1);
        tables().mcp_oauth_clients[0].expires_at = "2000-01-01T00:00:00.000Z";
        await authorize({ clientId: CLIENT, redirect: "http://127.0.0.1:1234/callback" });
        expect(h.fetched).toHaveLength(2);
    });

    it.each([
        ["a client_id that differs from the URL", doc({ client_id: "https://other.example/c.json" }), "client_id_mismatch"],
        ["a document with a client secret", doc({ client_secret: "s3cr3t" }), "client_secret_present"],
        ["a document with no usable redirects", doc({ redirect_uris: ["http://evil.example/cb"] }), "invalid_redirect_uris"],
        ["a redirect (never followed)", () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }), "redirected"],
        ["an HTML page", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), "bad_content_type"],
        ["a document that is not JSON", () => new Response("{nope", { status: 200, headers: { "content-type": "application/json" } }), "invalid_json"],
        ["a huge document", () => new Response("x".repeat(70_000), { status: 200, headers: { "content-type": "application/json" } }), "too_large"],
        ["a 404", () => new Response("", { status: 404 }), "bad_status"],
    ])("rejects %s", async (_name, fixture, reason) => {
        h.documents.set(CLIENT, fixture);
        const res = await authorize({ clientId: CLIENT, redirect: "http://127.0.0.1:1234/callback" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_client");
        expect(tables().mcp_oauth_clients).toHaveLength(0);
        expect(tables().mcp_oauth_audit.find((r) => r.event === "cimd_rejected")?.detail).toMatchObject({ reason });
    });

    it.each([
        "https://127.0.0.1/client.json",
        "https://localhost/client.json",
        "https://[::1]/client.json",
        "https://169.254.169.254/latest/meta-data/client.json",
        "https://10.0.0.5/client.json",
        "https://192.168.1.10/client.json",
        "https://100.64.0.1/client.json",
    ])("blocks a client_id that points inside: %s", async (clientId) => {
        const res = await authorize({ clientId, redirect: "http://127.0.0.1:1234/callback" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_client");
        expect(tables().mcp_oauth_clients).toHaveLength(0);
        expect(tables().mcp_oauth_audit.find((r) => r.event === "cimd_rejected")?.detail).toMatchObject({ reason: "blocked_destination" });
    });

    it.each(["http://app.example/client.json", "https://app.example/", "https://user:pw@app.example/c.json", "https://app.example/c.json#frag"])(
        "does not treat %s as a metadata document",
        async (clientId) => {
            const res = await authorize({ clientId, redirect: "http://127.0.0.1:1234/callback" });
            expect(res.status).toBe(400);
            expect(h.fetched).toEqual([]);
        },
    );

    it("is not offered when disabled", async () => {
        vi.stubEnv("LITT_MCP_CIMD", "disabled");
        expect((await request(app).get("/.well-known/oauth-authorization-server")).body.client_id_metadata_document_supported).toBe(false);
        h.documents.set(CLIENT, doc());
        expect((await authorize({ clientId: CLIENT, redirect: "http://127.0.0.1:1234/callback" })).status).toBe(400);
        expect(h.fetched).toEqual([]);
    });
});

describe("/mcp", () => {
    it("answers 401 with resource_metadata and every scope when there is no token", async () => {
        const res = await rpc("tools/list");
        expect(res.status).toBe(401);
        const challenge = res.headers["www-authenticate"];
        expect(challenge).toContain("Bearer");
        expect(challenge).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`);
        expect(challenge).toContain('scope="litt.read litt.run litt.write litt.chat"');
    });

    it("answers 401 invalid_token (not 500) for an unknown, malformed or expired token", async () => {
        const { token } = await connect();
        for (const bad of ["nothing", "a".repeat(5000), token.body.refresh_token]) {
            const res = await rpc("tools/list", bad);
            expect(res.status).toBe(401);
            expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
            expect(res.headers["www-authenticate"]).toContain("resource_metadata=");
        }
        for (const row of tables().mcp_oauth_tokens) row.expires_at = "2000-01-01T00:00:00.000Z";
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
    });

    it("lists the tools of the read scope with a valid token, and none that write", async () => {
        const { token } = await connect();
        const res = await rpc("tools/list", token.body.access_token);
        expect(res.status).toBe(200);
        const body = res.body.result ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1]);
        const names = body.result.tools.map((t: { name: string }) => t.name);
        expect(names).toContain("whoami");
        expect(names).toContain("find_matters");
        // The default connection holds litt.read only: no tool that adds a document is offered.
        expect(names).not.toContain("request_document_upload");
    });

    it("answers whoami with the grant's principal", async () => {
        const { token } = await connect({ workspaces: ["personal", "11111111-1111-4111-8111-111111111111"] });
        const res = await rpc("tools/call", token.body.access_token, { name: "whoami", arguments: {} });
        expect(res.status).toBe(200);
        const body = res.body.result ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1]);
        expect(JSON.parse(body.result.content[0].text)).toEqual({
            user_id: "user-1",
            client_id: expect.stringMatching(/^litt_dcr_/),
            scopes: ["litt.read", "litt.chat"],
            workspaces: ["personal", "11111111-1111-4111-8111-111111111111"],
            default_workspace: "personal",
            mode: "B",
            workspace_modes: { personal: "B", "11111111-1111-4111-8111-111111111111": "B" },
        });
    });

    it("is not opened by a web session or a token for another resource", async () => {
        const { token } = await connect();
        tables().mcp_grants[0].resource = "https://elsewhere.example/mcp";
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
    });

    it("answers 403 insufficient_scope when the grant has no read scope", async () => {
        const { token } = await connect({ scopes: ["litt.chat"] });
        const res = await rpc("tools/list", token.body.access_token);
        expect(res.status).toBe(403);
        expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
    });

    it("stops answering when the account is being deleted", async () => {
        const { token } = await connect();
        Object.assign(tables().user_profiles[0], { account_deletion_requested_at: "2026-11-16T00:00:00.000Z" });
        expect((await rpc("tools/list", token.body.access_token)).status).toBe(401);
    });

    it("refuses an unlisted browser Origin and allows a listed one", async () => {
        const { token } = await connect();
        const denied = await rpc("tools/list", token.body.access_token).set("Origin", "https://evil.example");
        expect(denied.status).toBe(403);
        vi.stubEnv("LITT_MCP_ALLOWED_ORIGINS", "https://inspector.example");
        const allowed = await rpc("tools/list", token.body.access_token).set("Origin", "https://inspector.example");
        expect(allowed.status).toBe(200);
        expect(allowed.headers["access-control-allow-origin"]).toBe("https://inspector.example");
    });

    it("answers a body that is not JSON with a JSON-RPC parse error", async () => {
        const { token } = await connect();
        const res = await request(app)
            .post("/mcp")
            .set("Authorization", `Bearer ${token.body.access_token}`)
            .set("Content-Type", "application/json")
            .send("{nope");
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(-32700);
    });
});

describe("audit", () => {
    it("records the flow without any credential in it", async () => {
        const { token, code, v, requestId } = await connect();
        await request(app).post("/oauth/revoke").type("form").send({ token: token.body.access_token });
        const events = tables().mcp_oauth_audit.map((r) => r.event);
        expect(events).toEqual(["client_registered", "authorization_requested", "consent_granted", "token_issued", "grant_revoked"]);
        const text = JSON.stringify(tables().mcp_oauth_audit);
        for (const secret of [token.body.access_token, token.body.refresh_token, code, v, requestId]) expect(text).not.toContain(secret);
    });

    it("fails closed: with no way to record the consent there is no grant", async () => {
        const clientId = await register();
        const requestId = requestIdOf((await authorize({ clientId })).headers.location);
        h.state!.failNext("mcp_oauth_audit", "insert", { message: "down" });
        const res = await request(app)
            .post(`/mcp-connect/authorizations/${requestId}/decision`)
            .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        expect(res.status).toBe(500);
        expect(tables().mcp_grants.every((g) => g.revoked_at)).toBe(true);
        expect(tables().mcp_oauth_codes).toHaveLength(0);
    });
});
