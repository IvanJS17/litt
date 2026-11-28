import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// The token endpoint's use of a client's last_used_at, over HTTP, against
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
        user_profiles: [],
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
const OLD = "2026-01-01T00:00:00.000Z";

async function register() {
    const res = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    expect(res.status).toBe(201);
    return res.body.client_id as string;
}

const authorize = (clientId: string, challenge: string) =>
    request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: REDIRECT,
            code_challenge: challenge,
            code_challenge_method: "S256",
            resource: RESOURCE,
            scope: "litt.read litt.chat",
            state: "st-1",
        })
        .redirects(0);

/** An approved client: registered, consented, one code issued (not yet exchanged). */
async function approvedWithCode() {
    const clientId = await register();
    const v = verifier();
    const auth = await authorize(clientId, challengeOf(v));
    const requestId = new URL(auth.headers.location).searchParams.get("request")!;
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read", "litt.chat"] });
    const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
    return { clientId, v, code };
}

const exchange = (body: Record<string, string>) =>
    request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", redirect_uri: REDIRECT, ...body });
const refresh = (clientId: string, token: string) =>
    request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId, refresh_token: token });

const stamp = (clientId: string) => {
    const row = tables().mcp_oauth_clients.find((r) => r.client_id === clientId)!;
    row.last_used_at = OLD;
    return () => row.last_used_at;
};

describe("a client is marked as in use only by a successful exchange", () => {
    it("leaves an unapproved client untouched when the code is unknown", async () => {
        const clientId = await register();
        const lastUsed = stamp(clientId);
        const res = await exchange({ client_id: clientId, code: "made-up", code_verifier: verifier() });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_grant");
        expect(lastUsed()).toBe(OLD);
    });

    it("leaves an unapproved client untouched when the refresh token is unknown", async () => {
        const clientId = await register();
        const lastUsed = stamp(clientId);
        const res = await refresh(clientId, "made-up");
        expect(res.body.error).toBe("invalid_grant");
        expect(lastUsed()).toBe(OLD);
    });

    it("leaves an approved client untouched by a wrong verifier, a wrong redirect and a replayed code", async () => {
        const { clientId, v, code } = await approvedWithCode();
        const lastUsed = stamp(clientId);
        const wrong = await exchange({ client_id: clientId, code, code_verifier: verifier() });
        expect(wrong.body.error).toBe("invalid_grant");
        expect(lastUsed()).toBe(OLD);
        const replay = await exchange({ client_id: clientId, code, code_verifier: v });
        expect(replay.body.error).toBe("invalid_grant");
        expect(lastUsed()).toBe(OLD);
        const second = await approvedWithCode();
        const second_stamp = stamp(second.clientId);
        const redirect = await request(app)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "authorization_code", client_id: second.clientId, code: second.code, code_verifier: second.v, redirect_uri: "https://claude.example/other" });
        expect(redirect.body.error).toBe("invalid_grant");
        expect(second_stamp()).toBe(OLD);
    });

    it("leaves an approved client untouched by an unknown, replayed or another client's refresh token", async () => {
        const { clientId, v, code } = await approvedWithCode();
        const ok = await exchange({ client_id: clientId, code, code_verifier: v });
        expect(ok.status).toBe(200);
        const other = await register();
        const lastUsed = stamp(clientId);
        const otherUsed = stamp(other);
        expect((await refresh(clientId, "made-up")).body.error).toBe("invalid_grant");
        expect((await refresh(other, ok.body.refresh_token)).body.error).toBe("invalid_grant");
        expect(lastUsed()).toBe(OLD);
        expect(otherUsed()).toBe(OLD);
        expect((await refresh(clientId, ok.body.refresh_token)).status).toBe(200);
        // The grant is now revoked by nothing: replay it.
        const lastAfter = stamp(clientId);
        expect((await refresh(clientId, ok.body.refresh_token)).body.error).toBe("invalid_grant");
        expect(lastAfter()).toBe(OLD);
    });

    it("marks the client when a code is exchanged and when a refresh token is rotated", async () => {
        const { clientId, v, code } = await approvedWithCode();
        const lastUsed = stamp(clientId);
        const ok = await exchange({ client_id: clientId, code, code_verifier: v });
        expect(ok.status).toBe(200);
        expect(lastUsed()).not.toBe(OLD);
        const row = tables().mcp_oauth_clients.find((r) => r.client_id === clientId)!;
        row.last_used_at = OLD;
        const next = await refresh(clientId, ok.body.refresh_token);
        expect(next.status).toBe(200);
        expect(lastUsed()).not.toBe(OLD);
    });
});
