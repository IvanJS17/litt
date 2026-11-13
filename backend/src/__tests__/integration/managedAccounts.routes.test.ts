import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Managed accounts over HTTP, through the REAL requireAuth (it binds the
// request scope the access seams read): the personal workspace is closed to
// the people a firm's invitation created while the firm has the setting on,
// and to nobody else.
const h = vi.hoisted(() => ({
    caller: "invited",
    state: null as null | { db: any; tables: Record<string, Row[]> },
}));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => h.state!.db),
}));
vi.mock("../../lib/userLookup", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/userLookup")>()),
    syncProfileEmail: vi.fn(async () => null),
}));
import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { LEGAL_VERSION } from "../../modules/user/user.profile.storage";

const AUTH = ["Authorization", "Bearer test"] as const;
const ORIGIN = "http://localhost:3000";

function world() {
    const tables: Record<string, Row[]> = {
        organizations: [{ id: "firm", name: "Despacho Aurora", managed_accounts: true, deleted_at: null }],
        org_members: [
            { org_id: "firm", user_id: "invited", role: "member" },
            { org_id: "firm", user_id: "veteran", role: "member" },
            { org_id: "firm", user_id: "admin", role: "admin" },
            { org_id: "firm", user_id: "owner", role: "owner" },
        ],
        user_profiles: [
            { user_id: "invited", email: "invited@firm.example", created_by_org_id: "firm", terms_accepted_version: LEGAL_VERSION },
            // Had an account before the invitation.
            { user_id: "veteran", email: "veteran@firm.example", created_by_org_id: null, terms_accepted_version: LEGAL_VERSION },
            { user_id: "admin", email: "admin@firm.example", created_by_org_id: null, terms_accepted_version: LEGAL_VERSION },
            { user_id: "owner", email: "owner@firm.example", created_by_org_id: null, terms_accepted_version: LEGAL_VERSION },
        ],
        audit_events: [],
        user_api_keys: [],
    };
    const mem = memoryDb(tables);
    (mem.db as { auth?: unknown }).auth = {
        getUser: async () => ({
            data: { user: { id: h.caller, email: `${h.caller}@firm.example`, email_confirmed_at: "2026-01-01" } },
            error: null,
        }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    };
    return { tables, db: mem.db };
}

beforeEach(() => {
    h.state = world();
    h.caller = "invited";
    vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "test-secret-low-entropy");
});
afterEach(() => vi.unstubAllEnvs());

const personalList = () => request(app).get("/projects?workspace=personal").set(...AUTH);

describe("a managed account", () => {
    it("is refused the personal workspace with a stable code", async () => {
        const res = await personalList();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("personal_workspace_disabled");
        expect(typeof res.body.detail).toBe("string");
    });

    it.each([
        "/playbooks/runs/history?workspace=personal",
        "/playbooks?workspace=personal",
        "/chat?workspace=personal",
    ])("answers 403, never a 500, on %s", async (path) => {
        const res = await request(app).get(path).set(...AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("personal_workspace_disabled");
    });

    it.each([
        "/user/memory",
        "/user/mcp-connectors",
        "/models/openrouter",
    ])("answers 403 on %s without ?workspace=, where it would default to Personal", async (path) => {
        const res = await request(app).get(path).set(...AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("personal_workspace_disabled");
    });

    it("is refused saving a personal key, even where the firm lets members bring their own", async () => {
        h.state!.tables.organizations[0].allow_personal_api_keys = true;
        const res = await request(app)
            .put("/user/api-keys/openai")
            .set(...AUTH)
            .set("Origin", ORIGIN)
            .send({ api_key: "sk-test-low-entropy" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("personal_workspace_disabled");
        expect(h.state!.tables.user_api_keys).toEqual([]);
    });

    it("is refused turning a personal key on", async () => {
        const res = await request(app)
            .patch("/user/api-keys/openai")
            .set(...AUTH)
            .set("Origin", ORIGIN)
            .send({ enabled: true });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("personal_workspace_disabled");
    });

    it("can close the 'now managed' notice", async () => {
        const res = await request(app).post("/user/managed-notice/dismiss").set(...AUTH).set("Origin", ORIGIN);
        expect(res.status).toBe(204);
        expect(h.state!.tables.user_profiles[0].managed_notice_seen_org_id).toBe("firm");
    });

    it("keeps the right to download its personal data (the export is not refused)", async () => {
        const res = await request(app)
            .post("/user/exports")
            .set(...AUTH)
            .set("Origin", ORIGIN)
            .send({ type: "account", params: { workspace: "personal" } });
        expect(res.body.code).not.toBe("personal_workspace_disabled");
    });
});

describe("everyone else keeps the personal workspace", () => {
    it.each(["veteran", "admin", "owner"])("%s is not refused", async (who) => {
        h.caller = who;
        const res = await personalList();
        expect(res.body.code).not.toBe("personal_workspace_disabled");
    });

    it("an account whose firm has the setting off is not refused", async () => {
        h.state!.tables.organizations[0].managed_accounts = false;
        const res = await personalList();
        expect(res.body.code).not.toBe("personal_workspace_disabled");
    });

    it("an invited account that leaves the firm gets the personal workspace back", async () => {
        h.state!.tables.org_members = h.state!.tables.org_members.filter((m) => m.user_id !== "invited");
        const res = await personalList();
        expect(res.body.code).not.toBe("personal_workspace_disabled");
    });

    it("turning the setting off returns it at once, on the next request of an open session", async () => {
        expect((await personalList()).status).toBe(403);
        h.state!.tables.organizations[0].managed_accounts = false;
        expect((await personalList()).body.code).not.toBe("personal_workspace_disabled");
        h.state!.tables.organizations[0].managed_accounts = true;
        expect((await personalList()).status).toBe(403);
    });

    it("waits for the new legal version to be accepted", async () => {
        h.state!.tables.user_profiles[0].terms_accepted_version = "older";
        expect((await personalList()).body.code).not.toBe("personal_workspace_disabled");
    });
});

describe("PUT /orgs/:orgId/managed-accounts", () => {
    const put = (body: unknown) =>
        request(app).put("/orgs/firm/managed-accounts").set(...AUTH).set("Origin", ORIGIN).send(body as object);

    it.each(["owner", "admin"])("lets the %s change it, and audits it", async (who) => {
        h.caller = who;
        h.state!.tables.organizations[0].managed_accounts = false;
        const on = await put({ managed_accounts: true });
        expect(on.status).toBe(200);
        expect(on.body).toEqual({ managed_accounts: true, managed_members: 1 });
        expect(h.state!.tables.organizations[0].managed_accounts).toBe(true);
        const off = await put({ managed_accounts: false });
        expect(off.body.managed_accounts).toBe(false);
        expect(h.state!.tables.audit_events.map((e) => [e.action, e.user_id, e.org_id])).toEqual([
            ["org.managed_accounts.enabled", who, "firm"],
            ["org.managed_accounts.disabled", who, "firm"],
        ]);
    });

    it("counts the members the firm's invitation created", async () => {
        h.caller = "owner";
        const res = await put({ managed_accounts: true });
        expect(res.body.managed_members).toBe(1);
    });

    it("refuses a plain member, and writes nothing", async () => {
        h.caller = "veteran";
        h.state!.tables.organizations[0].managed_accounts = false;
        expect((await put({ managed_accounts: true })).status).toBe(403);
        expect(h.state!.tables.organizations[0].managed_accounts).toBe(false);
        expect(h.state!.tables.audit_events).toEqual([]);
    });

    it("refuses the managed account itself", async () => {
        h.state!.tables.organizations[0].managed_accounts = false;
        expect((await put({ managed_accounts: true })).status).toBe(403);
    });

    it("hides the firm from somebody outside it", async () => {
        h.caller = "stranger";
        expect((await put({ managed_accounts: true })).status).toBe(404);
    });

    it("wants a boolean", async () => {
        h.caller = "owner";
        expect((await put({ managed_accounts: "yes" })).status).toBe(400);
        expect((await put({})).status).toBe(400);
    });
});
