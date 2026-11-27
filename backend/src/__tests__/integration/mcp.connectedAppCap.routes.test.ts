import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// How many client rows requests without a session may create for connected
// applications, over HTTP, against an in-memory database (the harness of
// mcp.oauth.routes.test.ts). Its own file: the refusal report is once per
// process and kind, and the first refusal of each kind is asserted below.
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

const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
const CAP = 3;
const DOC_URL = "https://app.example/oauth/client.json";
const LOCAL = "http://127.0.0.1:1234/callback";

/** memoryDb does not know PostgREST's embedded filter: `mcp_grants is null` keeps the clients no grant row refers to. */
function dbWithGrantFilter(rows: Record<string, Row[]>) {
    const state = memoryDb(rows, { mcp_oauth_purge: () => null });
    type Builder = Record<string, (...args: unknown[]) => unknown>;
    const db = state.db as unknown as { from: (table: string) => Builder };
    const realFrom = db.from;
    db.from = (table: string) => {
        const builder = realFrom(table);
        if (table !== "mcp_oauth_clients") return builder;
        const realIs = builder.is;
        builder.is = (column: unknown, value: unknown) => {
            if (column !== "mcp_grants") return realIs(column, value);
            let chained: unknown = builder;
            for (const grant of rows.mcp_grants) chained = builder.neq("client_id", grant.client_id);
            return chained;
        };
        return builder;
    };
    return state;
}

beforeEach(() => {
    const rows: Record<string, Row[]> = {
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
    h.state = dbWithGrantFilter(rows);
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
    vi.stubEnv("LITT_MCP_UNAPPROVED_CLIENTS_MAX", String(CAP));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const tables = () => h.state!.tables;
const snapshot = () => JSON.stringify([tables().mcp_oauth_clients, tables().mcp_oauth_audit, tables().mcp_oauth_requests]);
const registerRaw = () =>
    request(app).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
const authorize = (clientId: string, redirect = REDIRECT, challenge = challengeOf("x".repeat(43))) =>
    request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirect,
            code_challenge: challenge,
            code_challenge_method: "S256",
            resource: RESOURCE,
            state: "st-1",
        })
        .redirects(0);
const doc = (clientId = DOC_URL) => () =>
    new Response(JSON.stringify({ client_id: clientId, client_name: "Hermes", redirect_uris: [LOCAL] }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
/** Client rows no person ever approved. */
function seedUnapproved(count: number, kind = "dcr") {
    for (let i = 0; i < count; i++)
        tables().mcp_oauth_clients.push({
            client_id: `seed_${kind}_${tables().mcp_oauth_clients.length}`,
            kind,
            client_name: "Seeded",
            redirect_uris: [REDIRECT],
            created_at: "2026-11-01T00:00:00.000Z",
        });
}
const reportLines = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter((call) => call[0] === "[report]").map((call) => String(call[1]));

describe("at the cap on client rows nobody approved", () => {
    it("refuses a registration with the try-later answer and writes nothing; reports once, without the client", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        seedUnapproved(CAP);
        const before = snapshot();
        for (let i = 0; i < 2; i++) {
            const res = await registerRaw();
            expect(res.status).toBe(429);
            expect(res.body.error).toBe("temporarily_unavailable");
        }
        expect(snapshot()).toBe(before);
        const lines = reportLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain("seed_");
        expect(lines[0]).not.toContain("litt_dcr_");
    });

    it("refuses a first-seen metadata-document client without fetching it, and reports once, without the client", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        h.documents.set(DOC_URL, doc());
        seedUnapproved(CAP);
        const before = snapshot();
        for (let i = 0; i < 2; i++) {
            const res = await authorize(DOC_URL, LOCAL);
            expect(res.status).toBe(429);
            expect(res.body.error).toBe("temporarily_unavailable");
        }
        expect(h.fetched).toEqual([]);
        expect(snapshot()).toBe(before);
        const lines = reportLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain("app.example");
    });

    it("still serves a client that already has a row, and refreshes an expired metadata document", async () => {
        h.documents.set(DOC_URL, doc());
        seedUnapproved(CAP - 1);
        const registered = (await registerRaw()).body.client_id as string;
        tables().mcp_oauth_clients.push({
            client_id: DOC_URL, kind: "cimd", client_name: "Old", redirect_uris: [LOCAL],
            expires_at: "2000-01-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z",
        });
        expect((await registerRaw()).status).toBe(429);
        expect((await authorize(registered)).status).toBe(302);
        const refreshed = await authorize(DOC_URL, LOCAL);
        expect(refreshed.status).toBe(302);
        expect(h.fetched).toEqual([DOC_URL]);
        expect(tables().mcp_oauth_clients.find((c) => c.client_id === DOC_URL)).toMatchObject({ client_name: "Hermes" });
        expect(tables().mcp_oauth_clients).toHaveLength(CAP + 1);
    });

    it("does not count an approved client, and removes nothing", async () => {
        const approvedId = (await registerRaw()).body.client_id as string;
        const decision = async () => {
            const auth = await authorize(approvedId);
            const id = new URL(auth.headers.location).searchParams.get("request")!;
            return request(app)
                .post(`/mcp-connect/authorizations/${id}/decision`)
                .send({ decision: "approve", workspaces: ["personal"], scopes: ["litt.read"] });
        };
        expect((await decision()).status).toBe(200);
        expect(tables().mcp_grants).toHaveLength(1);
        seedUnapproved(CAP - 1);
        // the approved client plus CAP - 1 unapproved ones: still room for one
        expect((await registerRaw()).status).toBe(201);
        // now CAP unapproved ones: refused
        const before = tables().mcp_oauth_clients.length;
        expect((await registerRaw()).status).toBe(429);
        expect(tables().mcp_oauth_clients).toHaveLength(before);
        expect(tables().mcp_oauth_clients.some((c) => c.client_id === approvedId)).toBe(true);
    });
});

describe("under the cap", () => {
    it("registers and fetches first-seen metadata documents as before", async () => {
        h.documents.set(DOC_URL, doc());
        seedUnapproved(CAP - 2);
        const reg = await registerRaw();
        expect(reg.status).toBe(201);
        const res = await authorize(DOC_URL, LOCAL);
        expect(res.status).toBe(302);
        expect(h.fetched).toEqual([DOC_URL]);
        expect(tables().mcp_oauth_clients.map((c) => c.kind)).toEqual(["dcr", "dcr", "cimd"]);
        expect(tables().mcp_oauth_audit.map((r) => r.event)).toEqual(["client_registered", "cimd_fetched", "authorization_requested"]);
        expect(tables().mcp_oauth_requests).toHaveLength(1);
    });
});
