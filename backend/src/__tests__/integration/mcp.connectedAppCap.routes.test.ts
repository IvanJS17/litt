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
    /** The database gateway's row limit: answers with rows are silently shortened to it. */
    maxRows: undefined as number | undefined,
    /** How the count read of unapproved clients fails, if it does. */
    countRead: "ok" as "ok" | "error" | "missing",
    /** How many times the clean-up function was called, and which client rows it treats as idle (it removes those). */
    purgeCalls: 0,
    idle: new Set<string>(),
    /** When set, the clean-up's answer waits for it. */
    purgeGate: null as null | Promise<void>,
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
    const state = memoryDb(rows, {
        mcp_oauth_purge: (_args, all) => {
            h.purgeCalls++;
            const clients = all.mcp_oauth_clients;
            for (let i = clients.length - 1; i >= 0; i--)
                if (h.idle.has(String(clients[i].client_id))) clients.splice(i, 1);
            return null;
        },
    }, {
        get maxRows() {
            return h.maxRows;
        },
    });
    type Builder = Record<string, (...args: unknown[]) => unknown>;
    const db = state.db as unknown as { from: (table: string) => Builder; rpc: (...args: unknown[]) => Promise<unknown> };
    const realRpc = db.rpc;
    db.rpc = async (...args: unknown[]) => {
        const answer = realRpc(...args);
        if (h.purgeGate) await h.purgeGate;
        return answer;
    };
    const realFrom = db.from;
    db.from = (table: string) => {
        const builder = realFrom(table);
        if (table !== "mcp_oauth_clients") return builder;
        const realIs = builder.is;
        const realSelect = builder.select;
        // A read that only counts (`head: true`) can fail, or answer without a number.
        builder.select = (list?: unknown, options?: unknown) => {
            const head = (options as { head?: boolean } | undefined)?.head;
            if (head && h.countRead === "error")
                state.failNext(table, "select", { message: "count unavailable" });
            if (head && h.countRead === "missing") {
                (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({ data: null, error: null, count: null }).then(resolve);
            }
            return realSelect(list, options);
        };
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
    h.maxRows = undefined;
    h.countRead = "ok";
    h.purgeCalls = 0;
    h.idle.clear();
    h.purgeGate = null;
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
/** Client rows no connection refers to. */
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

const clientIds = () => tables().mcp_oauth_clients.map((c) => c.client_id);
const tokenRequest = (fields: Record<string, string>) =>
    request(app).post("/oauth/token").type("form").send(fields);

describe("the count does not depend on the database gateway's row limit", () => {
    const NUMBER = 5;
    beforeEach(() => {
        h.maxRows = 3; // answers with rows are cut to 3, below the number
        vi.stubEnv("LITT_MCP_UNAPPROVED_CLIENTS_MAX", String(NUMBER));
    });

    it("refuses a registration at the number, writing nothing", async () => {
        seedUnapproved(NUMBER);
        const before = snapshot();
        const res = await registerRaw();
        expect(res.status).toBe(429);
        expect(res.body.error).toBe("temporarily_unavailable");
        expect(snapshot()).toBe(before);
    });

    it("refuses a first-seen metadata-document client at the number, fetching and writing nothing", async () => {
        h.documents.set(DOC_URL, doc());
        seedUnapproved(NUMBER);
        const before = snapshot();
        const res = await authorize(DOC_URL, LOCAL);
        expect(res.status).toBe(429);
        expect(h.fetched).toEqual([]);
        expect(snapshot()).toBe(before);
    });

    it("still creates one below the number", async () => {
        seedUnapproved(NUMBER - 1);
        expect((await registerRaw()).status).toBe(201);
        expect((await registerRaw()).status).toBe(429);
    });

    it.each(["error", "missing"] as const)("refuses the creation when the count answers %s, writing nothing", async (mode) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        h.documents.set(DOC_URL, doc());
        seedUnapproved(1);
        h.countRead = mode;
        const before = snapshot();
        const reg = await registerRaw();
        expect(reg.status).toBeGreaterThanOrEqual(400);
        expect(reg.status).not.toBe(201);
        const cimd = await authorize(DOC_URL, LOCAL);
        expect(cimd.status).not.toBe(302);
        expect(h.fetched).toEqual([]);
        expect(snapshot()).toBe(before);
    });
});

describe("the token endpoint never creates a client", () => {
    const code = { grant_type: "authorization_code", client_id: DOC_URL, code: "c".repeat(43), code_verifier: "v".repeat(43), redirect_uri: LOCAL };
    const refresh = { grant_type: "refresh_token", client_id: DOC_URL, refresh_token: "r".repeat(43) };

    it.each([["authorization code", code], ["refresh", refresh]] as const)(
        "answers the unknown-client error for a first-seen metadata-document client (%s grant), fetching and writing nothing",
        async (_name, fields) => {
            h.documents.set(DOC_URL, doc());
            const before = snapshot();
            const res = await tokenRequest({ ...fields });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe("invalid_client");
            expect(h.fetched).toEqual([]);
            expect(clientIds()).toEqual([]);
            expect(tables().mcp_oauth_audit).toEqual([]);
            expect(snapshot()).toBe(before);
        },
    );

    it.each([["authorization code", code], ["refresh", refresh]] as const)(
        "still refreshes the expired document of a client that has a row (%s grant)",
        async (_name, fields) => {
            h.documents.set(DOC_URL, doc());
            tables().mcp_oauth_clients.push({
                client_id: DOC_URL, kind: "cimd", client_name: "Old", redirect_uris: [LOCAL],
                expires_at: "2000-01-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z",
            });
            const res = await tokenRequest({ ...fields });
            expect(res.body.error).toBe("invalid_grant");
            expect(h.fetched).toEqual([DOC_URL]);
            expect(clientIds()).toEqual([DOC_URL]);
            expect(tables().mcp_oauth_clients[0]).toMatchObject({ client_name: "Hermes" });
        },
    );
});

describe("the clean-up when a first-seen metadata-document client meets the number", () => {
    // A fresh copy of the app per test: the clean-up time and the report
    // memory live in the module. The clock is faked (the date only).
    let fresh: typeof app;
    let clock: number;
    const advance = (ms: number) => {
        clock += ms;
        vi.setSystemTime(clock);
    };
    const authorizeFresh = (clientId: string) =>
        request(fresh)
            .get("/oauth/authorize")
            .query({
                response_type: "code",
                client_id: clientId,
                redirect_uri: LOCAL,
                code_challenge: challengeOf("x".repeat(43)),
                code_challenge_method: "S256",
                resource: RESOURCE,
                state: "st-1",
            })
            .redirects(0);
    const registerFresh = () =>
        request(fresh).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const markIdle = (count: number) => {
        for (const c of tables().mcp_oauth_clients.slice(0, count)) h.idle.add(String(c.client_id));
    };

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        clock = Date.parse("2026-11-27T12:00:00.000Z");
        vi.setSystemTime(clock);
        vi.resetModules();
        fresh = (await import("../../app.js")).app;
        h.documents.set(DOC_URL, doc());
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("cleans up once, then fetches and creates the client when the clean-up made room", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        seedUnapproved(CAP);
        markIdle(2);
        const res = await authorizeFresh(DOC_URL);
        expect(res.status).toBe(302);
        expect(h.purgeCalls).toBe(1);
        expect(h.fetched).toEqual([DOC_URL]);
        expect(clientIds()).toContain(DOC_URL);
        expect(clientIds()).toHaveLength(CAP - 2 + 1);
        expect(reportLines(warn)).toEqual([]);
    });

    it("does not clean up again inside the minute after a clean-up that made room", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const other = "https://other.example/oauth/client.json";
        h.documents.set(other, doc(other));
        seedUnapproved(CAP);
        markIdle(2);
        expect((await authorizeFresh(DOC_URL)).status).toBe(302);
        expect(h.purgeCalls).toBe(1);
        // back at the number, with rows a clean-up could remove
        seedUnapproved(1);
        markIdle(1);
        advance(30_000);
        expect((await authorizeFresh(other)).status).toBe(429);
        expect(h.purgeCalls).toBe(1);
        expect(h.fetched).toEqual([DOC_URL]);
        expect(clientIds()).not.toContain(other);
    });

    it("refuses when nothing could be removed, with no second clean-up inside a minute and one after it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        seedUnapproved(CAP);
        const before = snapshot();
        expect((await authorizeFresh(DOC_URL)).status).toBe(429);
        expect(h.purgeCalls).toBe(1);
        advance(59_000);
        expect((await authorizeFresh(DOC_URL)).status).toBe(429);
        expect(h.purgeCalls).toBe(1);
        advance(2_000);
        expect((await authorizeFresh(DOC_URL)).status).toBe(429);
        expect(h.purgeCalls).toBe(2);
        expect(h.fetched).toEqual([]);
        expect(snapshot()).toBe(before);
        const lines = reportLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain("app.example");
    });

    it("runs one clean-up for two first-seen metadata-document requests started together", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const other = "https://other.example/oauth/client.json";
        h.documents.set(other, doc(other));
        seedUnapproved(CAP);
        let release!: () => void;
        h.purgeGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const both = Promise.all([authorizeFresh(DOC_URL), authorizeFresh(other)]);
        for (let i = 0; i < 100 && h.purgeCalls === 0; i++) await new Promise((r) => setTimeout(r, 10));
        // the second request has had time to reach the check while the first waits for the clean-up
        await new Promise((r) => setTimeout(r, 200));
        release();
        const answers = await both;
        expect(answers.map((a) => a.status)).toEqual([429, 429]);
        expect(h.purgeCalls).toBe(1);
    });

    it("does not clean up below the number", async () => {
        seedUnapproved(CAP - 1);
        expect((await authorizeFresh(DOC_URL)).status).toBe(302);
        expect(h.purgeCalls).toBe(0);
    });

    it("refuses with the generic error when the clean-up fails, fetching and writing nothing, and does not try again inside the minute", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        seedUnapproved(CAP);
        markIdle(2);
        const before = snapshot();
        h.state!.failNext("mcp_oauth_purge", "rpc", { message: "purge unavailable" });
        const first = await authorizeFresh(DOC_URL);
        expect(first.status).toBeGreaterThanOrEqual(400);
        expect(first.status).not.toBe(302);
        expect(first.text).not.toContain("purge unavailable");
        expect(h.purgeCalls).toBe(0);
        expect(h.fetched).toEqual([]);
        expect(snapshot()).toBe(before);
        // inside the minute: no attempt, refused for the number even though rows are idle
        expect((await authorizeFresh(DOC_URL)).status).toBe(429);
        expect(h.purgeCalls).toBe(0);
        expect(reportLines(warn)).toHaveLength(1);
        advance(61_000);
        expect((await authorizeFresh(DOC_URL)).status).toBe(302);
        expect(h.purgeCalls).toBe(1);
    });

    it("keeps cleaning up at every registration, before the count", async () => {
        seedUnapproved(CAP);
        markIdle(1);
        expect((await registerFresh()).status).toBe(201);
        expect(h.purgeCalls).toBe(1);
        expect((await registerFresh()).status).toBe(429);
        expect(h.purgeCalls).toBe(2);
        expect((await registerFresh()).status).toBe(429);
        expect(h.purgeCalls).toBe(3);
    });

    it("does not clean up at the token endpoints for a first-seen client", async () => {
        seedUnapproved(CAP);
        const res = await request(fresh)
            .post("/oauth/token")
            .type("form")
            .send({ grant_type: "refresh_token", client_id: DOC_URL, refresh_token: "r".repeat(43) });
        expect(res.body.error).toBe("invalid_client");
        expect(h.purgeCalls).toBe(0);
    });
});
