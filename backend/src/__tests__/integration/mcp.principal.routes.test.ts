import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Row } from "../helpers/memoryDb";

// What /mcp enforces on EVERY call (design §6.5, §7): the live principal
// (membership, managed account, erased account, training stage, epochs), the
// scope of each tool, the per-grant budget and the insert-only record of calls.
// Real OAuth flow against an in-memory database; two probe tools stand in for
// the real ones of the next slice.
const ORG = "11111111-1111-4111-8111-111111111111";
const ORG2 = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
    caller: { id: "user-1", email: "ana@firm.example" },
    state: null as null | {
        db: unknown;
        tables: Record<string, Row[]>;
        failNext: (table: string, op: string, error: unknown) => void;
    },
    ran: [] as unknown[],
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
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = "web-session-token";
                next();
            }),
    };
});
// Two probe tools next to whoami: a run-scope tool that audits strictly and
// works in the client's own AI mode, and one that fails with internals in its message.
vi.mock("../../modules/mcp/mcp.catalog.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/mcp/mcp.catalog.js")>();
    const { defineMcpTool, mcpText, McpToolError } = await import("../../modules/mcp/mcp.tools.js");
    const probeRun = defineMcpTool({
        name: "probe_run",
        title: "Probe run",
        description: "Test tool.",
        inputSchema: z.object({ workspace: z.string().optional(), note: z.string().optional() }),
        scope: "litt.run",
        lane: "write",
        readOnly: false,
        audit: "strict",
        usesWorkspace: true,
        mode: "B",
        handler: async (args, call) => {
            h.ran.push(args);
            return mcpText({ ok: true, workspace: call.workspace, mode: call.mode });
        },
    });
    const probeBoom = defineMcpTool({
        name: "probe_boom",
        title: "Probe boom",
        description: "Test tool.",
        inputSchema: z.object({ kind: z.string().optional() }),
        scope: "litt.read",
        lane: "read",
        readOnly: true,
        audit: "call",
        handler: async (args) => {
            if (args.kind === "known") throw new McpToolError("ocr_key_missing", "Set your key.", "Open Settings.");
            throw new Error("select * from secret_table failed at /srv/app/db.ts password=hunter2");
        },
    });
    return { ...original, MCP_TOOLS: [...original.MCP_TOOLS, probeRun, probeBoom] };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { resetGrantBudgets, takeGrantBudget } from "../../modules/mcp/mcp.limits";
import { mcpConfig } from "../../modules/mcp/mcp.config";
import { revalidatePrincipal } from "../../modules/mcp/mcp.principal";
import { registerLegalVersion } from "../../lib/managedAccounts";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";

const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        mcp_oauth_clients: [],
        mcp_oauth_requests: [],
        mcp_grants: [],
        mcp_oauth_codes: [],
        mcp_oauth_tokens: [],
        mcp_oauth_audit: [],
        org_members: [
            { org_id: ORG, user_id: "user-1", role: "member" },
            { org_id: ORG2, user_id: "user-1", role: "admin" },
        ],
        organizations: [
            { id: ORG, name: "Firm A", kind: "firm", deleted_at: null, authorization_epoch: 4, managed_accounts: false },
            { id: ORG2, name: "Firm B", kind: "firm", deleted_at: null, authorization_epoch: 9, managed_accounts: false },
        ],
        user_profiles: [],
        training_stages: [],
        mcp_tool_calls: [],
        audit_events: [],
    };
    h.state = memoryDb(tables, { mcp_oauth_purge: () => null });
    (h.state.db as { auth?: unknown }).auth = {
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    };
    h.caller = { id: "user-1", email: "ana@firm.example" };
    h.ran = [];
    resetGrantBudgets();
    registerLegalVersion("test-terms");
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

const tables = () => h.state!.tables;

/** DCR → authorize → consent → code → token. Returns the access and refresh tokens. */
async function connect(opts: { workspaces?: string[]; scopes?: string[] } = {}) {
    const reg = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const clientId = reg.body.client_id as string;
    const v = randomBytes(32).toString("base64url");
    const scopes = opts.scopes ?? ["litt.read", "litt.run"];
    const auth = await request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: REDIRECT,
            code_challenge: challengeOf(v),
            code_challenge_method: "S256",
            resource: RESOURCE,
            scope: "litt.read litt.run litt.write litt.chat",
            state: "s",
        })
        .redirects(0);
    const requestId = new URL(auth.headers.location).searchParams.get("request")!;
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: opts.workspaces ?? ["personal", ORG], scopes });
    expect(decision.status).toBe(200);
    const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
    const token = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT, resource: RESOURCE });
    expect(token.status).toBe(200);
    return { access: token.body.access_token as string, refresh: token.body.refresh_token as string };
}

const rpc = (token: string, method: string, params: object = {}, id = 1) =>
    request(app)
        .post("/mcp")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Authorization", `Bearer ${token}`)
        .send({ jsonrpc: "2.0", id, method, params });

const call = (token: string, name: string, args: object = {}) => rpc(token, "tools/call", { name, arguments: args });

const bodyOf = (res: { body: unknown; text: string }) =>
    (res.body && Object.keys(res.body as object).length ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1])) as {
        result?: { content: { text: string }[]; isError?: boolean; tools?: { name: string }[] };
    };
const textOf = (res: { body: unknown; text: string }) => JSON.parse(bodyOf(res).result!.content[0].text);
const who = async (token: string) => textOf(await call(token, "whoami"));

const calls = () => tables().mcp_tool_calls;

describe("live revalidation on every call", () => {
    it("drops a workspace the person left, on the very next call, and keeps the others", async () => {
        const { access } = await connect();
        expect((await who(access)).workspaces).toEqual(["personal", ORG]);
        tables().org_members = tables().org_members.filter((m) => m.org_id !== ORG);
        expect((await who(access)).workspaces).toEqual(["personal"]);
        expect((await who(access)).default_workspace).toBe("personal");
    });

    it("moves the default to a live workspace when the default one is gone", async () => {
        const { access } = await connect({ workspaces: [ORG, ORG2] });
        tables().mcp_grants[0].default_workspace = ORG;
        tables().org_members = tables().org_members.filter((m) => m.org_id !== ORG);
        const me = await who(access);
        expect(me.workspaces).toEqual([ORG2]);
        expect(me.default_workspace).toBe(ORG2);
    });

    it("drops a workspace whose firm was deleted", async () => {
        const { access } = await connect();
        // The role lookup joins organizations and requires deleted_at null.
        tables().org_members = tables().org_members.filter((m) => m.org_id !== ORG);
        tables().organizations.find((o) => o.id === ORG)!.deleted_at = "2026-11-16T00:00:00.000Z";
        expect((await who(access)).workspaces).toEqual(["personal"]);
    });

    it("answers 403 workspace_not_found, and records it, when no workspace of the grant is left", async () => {
        const { access } = await connect({ workspaces: [ORG] });
        tables().org_members = tables().org_members.filter((m) => m.org_id !== ORG);
        const res = await call(access, "whoami");
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("workspace_not_found");
        expect(calls()).toEqual([
            expect.objectContaining({ tool: "(protocol)", outcome: "denied", error_code: "workspace_not_found", user_id: "user-1" }),
        ]);
    });

    it("takes Personal away from a managed account at once", async () => {
        const { access } = await connect();
        tables().user_profiles.push({ user_id: "user-1", created_by_org_id: ORG, terms_accepted_version: "test-terms" });
        tables().organizations.find((o) => o.id === ORG)!.managed_accounts = true;
        const me = await who(access);
        expect(me.workspaces).toEqual([ORG]);
        expect(me.default_workspace).toBe(ORG);
    });

    it("answers 403 personal_workspace_disabled when a managed account's grant only had Personal", async () => {
        const { access } = await connect({ workspaces: ["personal"] });
        tables().user_profiles.push({ user_id: "user-1", created_by_org_id: ORG, terms_accepted_version: "test-terms" });
        tables().organizations.find((o) => o.id === ORG)!.managed_accounts = true;
        const res = await call(access, "whoami");
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("personal_workspace_disabled");
    });

    it("lets an apprentice use mode A only, and says so per workspace", async () => {
        const { access } = await connect();
        tables().training_stages.push({ org_id: ORG, trainee_user_id: "user-1", practice: null, stage: "pasante" });
        const me = await who(access);
        expect(me.mode).toBe("A");
        expect(me.workspace_modes).toEqual({ personal: "B", [ORG]: "A" });
        // A tool that runs the client's own AI is refused in the apprentice's firm, allowed elsewhere.
        const refused = textOf(await call(access, "probe_run", { workspace: ORG }));
        expect(refused.code).toBe("mode_not_available");
        expect(h.ran).toEqual([]);
        const allowed = textOf(await call(access, "probe_run", { workspace: "personal" }));
        expect(allowed).toEqual({ ok: true, workspace: "personal", mode: "B" });
    });

    it("also holds for a stage in one practice area, and for the junior stage", async () => {
        const { access } = await connect();
        tables().training_stages.push({ org_id: ORG, trainee_user_id: "user-1", practice: "civil", stage: "junior" });
        expect((await who(access)).workspace_modes[ORG]).toBe("A");
    });

    it("ends with the person's training stage, too", async () => {
        const { access } = await connect();
        tables().training_stages.push({ org_id: ORG, trainee_user_id: "user-1", practice: null, stage: "junior" });
        expect((await who(access)).mode).toBe("A");
        tables().training_stages.length = 0;
        expect((await who(access)).mode).toBe("B");
    });

    it("reads each firm's authorization epoch for the call", async () => {
        const { access } = await connect({ workspaces: [ORG, ORG2] });
        const live = await revalidatePrincipal(h.state!.db as never, tables().mcp_grants[0].id as string);
        expect(live.ok && live.principal.workspaces.map((w) => w.authorizationEpoch)).toEqual([4, 9]);
        tables().organizations.find((o) => o.id === ORG)!.authorization_epoch = 5;
        const again = await revalidatePrincipal(h.state!.db as never, tables().mcp_grants[0].id as string);
        expect(again.ok && again.principal.workspaces[0].authorizationEpoch).toBe(5);
        expect(access).toBeTruthy();
    });

    it("refuses with 401 once the account is being erased, a grant is revoked or it expired", async () => {
        const erased = await connect();
        tables().user_profiles.push({ user_id: "user-1", account_deletion_requested_at: "2026-11-16T00:00:00.000Z" });
        const res = await call(erased.access, "whoami");
        expect(res.status).toBe(401);
        expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');

        tables().user_profiles.length = 0;
        const revoked = await connect();
        await request(app).post("/oauth/revoke").type("form").send({ token: revoked.refresh });
        expect((await call(revoked.access, "whoami")).status).toBe(401);

        const expired = await connect();
        const grant = tables().mcp_grants.at(-1)!;
        grant.expires_at = "2000-01-01T00:00:00.000Z";
        expect((await call(expired.access, "whoami")).status).toBe(401);
    });

    it("fails closed with a sanitized 500 when a live check cannot be read", async () => {
        const { access } = await connect();
        h.state!.failNext("training_stages", "select", { message: "connection to 10.0.0.5 refused", code: "08006" });
        const res = await call(access, "whoami");
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body) + res.text).not.toMatch(/10\.0\.0\.5|training_stages/);
    });
});

describe("scopes", () => {
    it("answers 403 insufficient_scope naming the missing scope, before running anything", async () => {
        const { access } = await connect({ scopes: ["litt.read"] });
        const res = await call(access, "probe_run");
        expect(res.status).toBe(403);
        expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
        expect(res.headers["www-authenticate"]).toContain('scope="litt.run"');
        expect(h.ran).toEqual([]);
        expect(calls().at(-1)).toMatchObject({ tool: "probe_run", outcome: "denied", error_code: "insufficient_scope" });
    });

    it("does not list the tools the grant has no scope for", async () => {
        const narrow = await connect({ scopes: ["litt.read"] });
        const names = (r: Awaited<ReturnType<typeof rpc>>) => bodyOf(r).result!.tools!.map((t) => t.name);
        expect(names(await rpc(narrow.access, "tools/list"))).toEqual(["whoami", "probe_boom"]);
        const wide = await connect();
        expect(names(await rpc(wide.access, "tools/list"))).toEqual(["whoami", "probe_run", "probe_boom"]);
    });

    it("refuses a workspace the grant does not cover, without naming it in the record", async () => {
        const { access } = await connect({ workspaces: ["personal"] });
        const res = textOf(await call(access, "probe_run", { workspace: ORG }));
        expect(res.code).toBe("workspace_not_found");
        expect(h.ran).toEqual([]);
        expect(JSON.stringify(calls())).not.toContain(ORG);
        expect(calls().at(-1)).toMatchObject({ outcome: "denied", error_code: "workspace_not_found" });
    });
});

describe("rate limits per grant", () => {
    it("answers 429 with Retry-After when a grant spends its read budget, and only that grant", async () => {
        vi.stubEnv("RATE_LIMIT_MCP_GRANT_READ_MAX", "3");
        const first = await connect();
        const second = await connect();
        for (let i = 0; i < 3; i++) expect((await call(first.access, "whoami")).status).toBe(200);
        const limited = await call(first.access, "whoami");
        expect(limited.status).toBe(429);
        expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
        expect(limited.body.code).toBe("rate_limited");
        expect((await call(second.access, "whoami")).status).toBe(200);
        expect(calls().filter((c) => c.outcome === "rate_limited")).toHaveLength(1);
    });

    it("keeps writes and runs on their own, smaller budget", async () => {
        vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "2");
        const { access } = await connect();
        expect((await call(access, "probe_run")).status).toBe(200);
        expect((await call(access, "probe_run")).status).toBe(200);
        const limited = await call(access, "probe_run");
        expect(limited.status).toBe(429);
        expect(h.ran).toHaveLength(2);
        // Reads still flow.
        expect((await call(access, "whoami")).status).toBe(200);
    });

    it("defaults to 120 reads a minute and 30 writes in 15 minutes", async () => {
        expect(mcpConfig().rateLimits).toEqual({ readMax: 120, readWindowMs: 60_000, writeMax: 30, writeWindowMs: 900_000 });
    });

    it("opens a new window once the old one ends", async () => {
        vi.stubEnv("RATE_LIMIT_MCP_GRANT_READ_MAX", "1");
        expect(takeGrantBudget("g", "read", 1000).allowed).toBe(true);
        expect(takeGrantBudget("g", "read", 2000)).toEqual({ allowed: false, retryAfterSeconds: 59 });
        expect(takeGrantBudget("g", "read", 61_001).allowed).toBe(true);
    });
});

describe("the record of calls", () => {
    it("writes one insert-only row per call, with no arguments, no result and no secret", async () => {
        const { access, refresh } = await connect();
        const res = await call(access, "probe_run", { note: "SECRET-ARGUMENT-TEXT", workspace: ORG });
        expect(textOf(res)).toEqual({ ok: true, workspace: ORG, mode: "B" });
        await call(access, "whoami");
        expect(calls()).toHaveLength(2);
        expect(calls()[0]).toMatchObject({
            tool: "probe_run",
            user_id: "user-1",
            workspace: ORG,
            mode: "B",
            outcome: "ok",
            grant_id: tables().mcp_grants[0].id,
            client_id: tables().mcp_grants[0].client_id,
        });
        expect(typeof calls()[0].latency_ms).toBe("number");
        expect(Object.keys(calls()[0]).sort()).toEqual(
            ["client_id", "error_code", "grant_id", "id", "latency_ms", "mode", "outcome", "tool", "user_id", "workspace"].sort(),
        );
        const dump = JSON.stringify([calls(), tables().audit_events]);
        for (const secret of [access, refresh, "SECRET-ARGUMENT-TEXT"]) expect(dump).not.toContain(secret);
    });

    it("writes audit_events with surface 'mcp' before a strict tool runs", async () => {
        const { access } = await connect();
        await call(access, "probe_run", { workspace: ORG });
        expect(tables().audit_events).toEqual([
            expect.objectContaining({
                user_id: "user-1",
                org_id: ORG,
                action: "mcp.probe_run",
                surface: "mcp",
                detail: expect.objectContaining({ grant_id: tables().mcp_grants[0].id, workspace: ORG }),
            }),
        ]);
        await call(access, "whoami");
        expect(tables().audit_events).toHaveLength(1);
    });

    it("does not run a strict tool when its audit event cannot be written", async () => {
        const { access } = await connect();
        h.state!.failNext("audit_events", "insert", { message: "disk full at /var/lib/pg" });
        const res = textOf(await call(access, "probe_run"));
        expect(res.code).toBe("audit_unavailable");
        expect(JSON.stringify(res)).not.toContain("/var/lib");
        expect(h.ran).toEqual([]);
        expect(calls().at(-1)).toMatchObject({ outcome: "error", error_code: "audit_unavailable" });
    });

    it("still answers when the call record itself cannot be written", async () => {
        const { access } = await connect();
        h.state!.failNext("mcp_tool_calls", "insert", { message: "boom" });
        expect((await call(access, "whoami")).status).toBe(200);
    });

    it("never reaches the client with an internal message, and passes authored errors through", async () => {
        const { access } = await connect();
        const unknown = await call(access, "probe_boom");
        expect(unknown.status).toBe(200);
        expect(bodyOf(unknown).result!.isError).toBe(true);
        expect(unknown.text).not.toMatch(/secret_table|hunter2|\/srv\/app/);
        expect(textOf(unknown)).toEqual({ code: "internal_error", detail: "LiTT could not complete this request." });
        expect(textOf(await call(access, "probe_boom", { kind: "known" }))).toEqual({
            code: "ocr_key_missing",
            detail: "Set your key.",
            suggested_action: "Open Settings.",
        });
        expect(calls().map((c) => c.error_code)).toEqual(["internal_error", "ocr_key_missing"]);
        expect(JSON.stringify(calls())).not.toMatch(/hunter2|secret_table/);
    });
});
