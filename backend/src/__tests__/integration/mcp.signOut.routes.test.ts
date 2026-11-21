import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// Connected applications and the person's sessions: what a person authorized
// for an app stops working when they sign out everywhere or recover their
// password with the sign-out option, and keeps working after a plain
// single-device sign-out. Real auth routes and real MCP endpoints, in-memory
// database, a stand-in for the auth service's client.
const h = vi.hoisted(() => ({
    caller: { id: "user-1", email: "ana@firm.example" },
    state: null as null | {
        db: unknown;
        tables: Record<string, Row[]>;
        failNext: (table: string, op: string, error: unknown) => void;
    },
    authCalls: [] as string[],
    // What the identity lookup answers; null is the signed-in caller.
    lookup: null as null | { data: { user: null }; error: unknown },
    // The stamp as it was when the identity service was asked to sign out.
    stampAtSignOut: undefined as unknown,
    signOutFails: false,
    // Runs once, at the first read of the consent request by a decision.
    onFirstRead: null as null | (() => Promise<void>),
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => {
        const db = h.state!.db as { from: (table: string) => Record<string, unknown> };
        return {
            ...db,
            from: (table: string) => {
                const builder = db.from(table);
                if (table !== "mcp_oauth_requests" || !h.onFirstRead) return builder;
                const proxy: unknown = new Proxy(builder, {
                    get: (target, prop) => {
                        const value = target[prop as string] as (...args: unknown[]) => unknown;
                        if (prop === "maybeSingle")
                            return async () => {
                                const run = h.onFirstRead;
                                h.onFirstRead = null;
                                await run?.();
                                return value.call(target);
                            };
                        return (...args: unknown[]) => {
                            const result = value.apply(target, args);
                            return result === target ? proxy : result;
                        };
                    },
                });
                return proxy;
            },
        };
    }),
}));
const fakeAuthClient = () => ({
    auth: {
        getUser: async () => h.lookup ?? { data: { user: { id: h.caller.id, email: h.caller.email } }, error: null },
        signOut: async ({ scope }: { scope: string }) => {
            h.authCalls.push(`signOut:${scope}`);
            h.stampAtSignOut = h.state!.tables.user_profiles[0].sessions_ended_at;
            if (h.signOutFails) return { error: Object.assign(new Error("boom"), { __isAuthError: true, name: "AuthRetryableFetchError", status: 503 }) };
            return { error: null };
        },
        updateUser: async () => ({ data: { user: { id: h.caller.id, email: h.caller.email } }, error: null }),
    },
});
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createRequestSupabase: vi.fn(() => fakeAuthClient()),
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
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = "web-session-token";
                res.locals.authSource = "cookie";
                res.locals.authClient = fakeAuthClient();
                next();
            }),
    };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";
const WEB = "http://localhost:3000";

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
const later = () => new Promise((resolve) => setTimeout(resolve, 15));

beforeEach(() => {
    h.state = memoryDb(
        {
            mcp_oauth_clients: [],
            mcp_oauth_requests: [],
            mcp_grants: [],
            mcp_oauth_codes: [],
            mcp_oauth_tokens: [],
            mcp_oauth_audit: [],
            org_members: [],
            organizations: [],
            training_stages: [],
            mcp_tool_calls: [],
            audit_events: [],
            user_profiles: [{ user_id: "user-1", account_deletion_requested_at: null, sessions_ended_at: null }],
        },
        { mcp_oauth_purge: () => null },
    );
    (h.state.db as { auth?: unknown }).auth = {
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    };
    h.caller = { id: "user-1", email: "ana@firm.example" };
    h.authCalls = [];
    h.lookup = null;
    h.stampAtSignOut = undefined;
    h.signOutFails = false;
    h.onFirstRead = null;
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", WEB);
});
afterEach(() => vi.unstubAllEnvs());

/** Register a client, approve the consent, and (unless `redeem` is false) redeem the code. */
async function connect(redeem = true, duringDecision?: () => Promise<void>) {
    const reg = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const clientId = reg.body.client_id as string;
    const v = verifier();
    const auth = await request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: REDIRECT,
            code_challenge: challengeOf(v),
            code_challenge_method: "S256",
            resource: RESOURCE,
            scope: "litt.read litt.chat",
            state: "st-1",
        })
        .redirects(0);
    const requestId = new URL(auth.headers.location).searchParams.get("request")!;
    if (duringDecision) h.onFirstRead = duringDecision;
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read", "litt.chat"] });
    expect(decision.status).toBe(200);
    const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
    const exchange = () =>
        request(app)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT, resource: RESOURCE });
    const token = redeem ? await exchange() : null;
    return { clientId, exchange, token };
}

const mcpCall = (access: string) =>
    request(app)
        .post("/mcp")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Authorization", `Bearer ${access}`)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
const refresh = (clientId: string, token: string) =>
    request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId, refresh_token: token });

const globalLogout = () => request(app).post("/auth/logout").set("Origin", WEB).send({ scope: "global" });
const recovery = () =>
    request(app).patch("/auth/password").set("Origin", WEB).send({ password: "Correct-Horse-Battery-9", signOut: true });

describe.each([
    ["signing out everywhere", globalLogout, 204],
    ["recovering the password with the sign-out option", recovery, 200],
] as const)("%s", (_name, endSessions, status) => {
    it("ends the person's connected applications: access token, refresh token and unredeemed code", async () => {
        const redeemed = await connect();
        const unredeemed = await connect(false);
        expect((await mcpCall(redeemed.token!.body.access_token)).status).toBe(200);

        await later();
        expect((await endSessions()).status).toBe(status);

        const call = await mcpCall(redeemed.token!.body.access_token);
        expect(call.status).toBe(401);
        expect(call.headers["www-authenticate"]).toContain('error="invalid_token"');
        const rotated = await refresh(redeemed.clientId, redeemed.token!.body.refresh_token);
        expect(rotated.status).toBe(400);
        expect(rotated.body.error).toBe("invalid_grant");
        const code = await unredeemed.exchange();
        expect(code.status).toBe(400);
        expect(code.body.error).toBe("invalid_grant");
        const list = await request(app).get("/mcp-connect/grants");
        expect(list.body.grants).toHaveLength(0);
    });

    it("lets the person connect an application again afterwards", async () => {
        await connect();
        await later();
        await endSessions();
        await later();
        const fresh = await connect();
        expect((await mcpCall(fresh.token!.body.access_token)).status).toBe(200);
        const rotated = await refresh(fresh.clientId, fresh.token!.body.refresh_token);
        expect(rotated.status).toBe(200);
    });
});

describe("signing out on one device", () => {
    it("leaves the connected applications working", async () => {
        const { clientId, token } = await connect();
        const res = await request(app).post("/auth/logout").set("Origin", WEB).send({ scope: "local" });
        expect(res.status).toBe(204);
        expect(h.authCalls).toEqual(["signOut:local"]);
        expect((await mcpCall(token!.body.access_token)).status).toBe(200);
        expect((await refresh(clientId, token!.body.refresh_token)).status).toBe(200);
    });

    it("leaves them working when the sign-out has no scope", async () => {
        const { token } = await connect();
        expect((await request(app).post("/auth/logout").set("Origin", WEB).send({})).status).toBe(204);
        expect((await mcpCall(token!.body.access_token)).status).toBe(200);
    });
});

const authError = (name: string, status: number) => Object.assign(new Error(name), { __isAuthError: true, name, status });
const SESSION_COOKIE = "mike-session=stale";
const stampOf = () => h.state!.tables.user_profiles[0].sessions_ended_at;

describe("when the person's identity cannot be read at a global sign-out", () => {
    it.each([
        ["the identity service is unreachable", authError("AuthRetryableFetchError", 0)],
        ["the identity service is overloaded", authError("AuthRetryableFetchError", 503)],
        ["the identity service fails on its own", authError("AuthRetryableFetchError", 500)],
        ["the identity service is limiting requests", authError("AuthApiError", 429)],
        ["the answer names neither a person nor an error", null],
    ])("%s: the sessions end, the cookies clear, and the failure is not hidden", async (_label, error) => {
        const { token } = await connect();
        h.lookup = { data: { user: null }, error };
        const res = await request(app).post("/auth/logout").set("Origin", WEB).set("Cookie", SESSION_COOKIE).send({ scope: "global" });
        expect(res.status).toBe(500);
        expect(h.authCalls).toEqual(["signOut:global"]);
        expect(String(res.headers["set-cookie"])).toContain("mike-session=;");
        expect(stampOf()).toBeNull();
        // Nothing was recorded, so the connection is not claimed to be over.
        expect((await mcpCall(token!.body.access_token)).status).toBe(200);
    });

    it.each([
        ["there is no session", authError("AuthSessionMissingError", 400)],
        ["the session is no longer valid", authError("AuthApiError", 401)],
    ])("%s: nothing to end, answered as always", async (_label, error) => {
        h.lookup = { data: { user: null }, error };
        const res = await request(app).post("/auth/logout").set("Origin", WEB).send({ scope: "global" });
        expect(res.status).toBe(204);
        expect(h.authCalls).toEqual(["signOut:global"]);
        expect(stampOf()).toBeNull();
    });
});

describe("when the sign-out stamp cannot be written", () => {
    it("password recovery still ends every session and clears the cookies, then answers 500", async () => {
        const { token } = await connect();
        h.state!.failNext("user_profiles", "update", new Error("db down"));
        const res = await request(app)
            .patch("/auth/password")
            .set("Origin", WEB)
            .set("Cookie", SESSION_COOKIE)
            .send({ password: "Correct-Horse-Battery-9", signOut: true });
        expect(res.status).toBe(500);
        expect(h.authCalls).toEqual(["signOut:global"]);
        expect(String(res.headers["set-cookie"])).toContain("mike-session=;");
        expect(stampOf()).toBeNull();
        expect((await mcpCall(token!.body.access_token)).status).toBe(200);
    });
});

describe.each([
    ["signing out everywhere", globalLogout, "signed_out_everywhere"],
    ["recovering the password with the sign-out option", recovery, "password_recovery_sign_out"],
] as const)("the records after %s", (_name, endSessions, reason) => {
    it("revokes each live connection and its tokens, with one audit event each, and leaves a later one alone", async () => {
        const first = await connect();
        const second = await connect();
        const tables = h.state!.tables;
        await later();
        expect((await endSessions()).status).toBeLessThan(300);

        const before = tables.mcp_grants.slice(0, 2);
        expect(before).toHaveLength(2);
        for (const grant of before) {
            expect(grant.revoked_at).toEqual(expect.any(String));
            expect(grant.revoked_reason).toBe(reason);
            for (const token of tables.mcp_oauth_tokens.filter((t) => t.grant_id === grant.id))
                expect(token.revoked_at).toEqual(expect.any(String));
        }
        const events = tables.mcp_oauth_audit.filter((e) => e.event === "grant_revoked");
        expect(events.map((e) => e.grant_id).sort()).toEqual(before.map((g) => g.id).sort());
        expect(events.every((e) => (e.detail as { reason: string }).reason === reason)).toBe(true);

        await later();
        const fresh = await connect();
        const freshGrant = tables.mcp_grants[2];
        expect(freshGrant.revoked_at ?? null).toBeNull();
        expect(tables.mcp_oauth_tokens.filter((t) => t.grant_id === freshGrant.id).every((t) => !t.revoked_at)).toBe(true);
        expect((await mcpCall(fresh.token!.body.access_token)).status).toBe(200);
        expect([first, second]).toHaveLength(2);
    });

    it("answers as always, and the old token stays refused by the stamp, when that bookkeeping fails", async () => {
        const { clientId, token } = await connect();
        h.state!.failNext("mcp_grants", "update", new Error("db hiccup"));
        await later();
        expect((await endSessions()).status).toBeLessThan(300);
        expect(h.state!.tables.mcp_grants[0].revoked_at ?? null).toBeNull();
        expect((await mcpCall(token!.body.access_token)).status).toBe(401);
        expect((await refresh(clientId, token!.body.refresh_token)).status).toBe(400);
    });
});

describe.each([
    ["signing out everywhere", globalLogout, 204],
    ["recovering the password with the sign-out option", recovery, 200],
] as const)("the order of %s", (_name, endSessions, failedStatus) => {
    it("stamps only once the identity service has ended the sessions", async () => {
        await connect();
        await later();
        expect((await endSessions()).status).toBeLessThan(300);
        expect(h.authCalls).toEqual(["signOut:global"]);
        expect(h.stampAtSignOut).toBeNull();
        expect(stampOf()).toEqual(expect.any(String));
    });

    it("stamps even when the identity service reports a failure, answering as it did before", async () => {
        const { token } = await connect();
        h.signOutFails = true;
        await later();
        const res = await endSessions();
        expect(h.stampAtSignOut).toBeNull();
        expect(stampOf()).toEqual(expect.any(String));
        expect((await mcpCall(token!.body.access_token)).status).toBe(401);
        expect(res.status).toBe(failedStatus);
    });
});

describe.each([
    ["signing out everywhere", globalLogout],
    ["recovering the password with the sign-out option", recovery],
] as const)("a connection approved while %s runs", (_name, endSessions) => {
    it("is refused when the request arrived before the sign-out, however late it is stored", async () => {
        await later();
        const pending = await connect(false, async () => {
            // The session check has passed; the sign-out now runs to the end.
            await later();
            expect((await endSessions()).status).toBeLessThan(300);
        });
        const code = await pending.exchange();
        expect(code.status).toBe(400);
        expect(code.body.error).toBe("invalid_grant");
        const grant = h.state!.tables.mcp_grants.at(-1)!;
        expect(Date.parse(grant.created_at as string)).toBeLessThanOrEqual(Date.parse(stampOf() as string));
    });
});
