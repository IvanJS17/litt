import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The per-address limit on GET /oauth/authorize, over HTTP, against an
// in-memory database (the harness of mcp.oauth.routes.test.ts). Its own file:
// the limiter's counters live as long as the process.
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

const ISSUER_RESOURCE = RESOURCE;
const LIMIT = 120;

beforeEach(() => {
    const rows: Record<string, Row[]> = { mcp_oauth_clients: [], mcp_oauth_requests: [], mcp_grants: [], mcp_oauth_audit: [] };
    h.state = memoryDb(rows, { mcp_oauth_purge: () => null });
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", WEB);
});
afterEach(() => vi.unstubAllEnvs());

const tables = () => h.state!.tables;
const from = (address: string) => ({ "X-Forwarded-For": address });
const bare = (address: string) => request(app).get("/oauth/authorize").set(from(address));
const valid = (address: string) =>
    request(app)
        .get("/oauth/authorize")
        .set(from(address))
        .query({
            response_type: "code",
            client_id: "client-1",
            redirect_uri: REDIRECT,
            code_challenge: "x".repeat(43),
            code_challenge_method: "S256",
            resource: ISSUER_RESOURCE,
        })
        .redirects(0);

describe("GET /oauth/authorize limit per address", () => {
    it("answers 429 from request 121 of one address, creating nothing, and leaves another address, the consent page and the token endpoint alone", async () => {
        tables().mcp_oauth_clients.push({ client_id: "client-1", kind: "dcr", client_name: "C", redirect_uris: [REDIRECT] });
        for (let i = 0; i < LIMIT; i++) expect((await bare("203.0.113.7")).status).toBe(400);
        const refused = await valid("203.0.113.7");
        expect(refused.status).toBe(429);
        expect(tables().mcp_oauth_requests).toEqual([]);
        expect(tables().mcp_oauth_audit).toEqual([]);

        expect((await valid("203.0.113.8")).status).toBe(302);
        expect(tables().mcp_oauth_requests).toHaveLength(1);

        const token = await request(app).post("/oauth/token").set(from("203.0.113.7")).type("form").send({ grant_type: "nope" });
        expect(token.status).toBe(400);
        const consent = await request(app).get("/mcp-connect/authorizations/unknown").set(from("203.0.113.7"));
        expect(consent.status).not.toBe(429);
    });
});
