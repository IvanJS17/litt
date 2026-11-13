import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Row } from "../helpers/memoryDb";

// The firm's profile over HTTP, through the REAL requireAuth and org-role checks.
const h = vi.hoisted(() => ({
    caller: "member",
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
import { loadFirmProfileFor } from "../../lib/firmProfileStore";
import { LEGAL_VERSION } from "../../modules/user/user.profile.storage";

const AUTH = ["Authorization", "Bearer test"] as const;
const ORIGIN = "http://localhost:3000";
const SECRET = "Cliente Juan Pérez y su asunto";

function world() {
    const users = ["member", "admin", "owner", "stranger"];
    const tables: Record<string, Row[]> = {
        organizations: [
            { id: "firm", name: "Aurora", kind: "team", deleted_at: null, firm_profile: { hq_state: "JAL", size: "2-5" } },
            { id: "other", name: "Otro", kind: "team", deleted_at: null, firm_profile: { size: "51+" } },
        ],
        org_members: [
            { org_id: "firm", user_id: "member", role: "member" },
            { org_id: "firm", user_id: "admin", role: "admin" },
            { org_id: "firm", user_id: "owner", role: "owner" },
            { org_id: "other", user_id: "stranger", role: "owner" },
        ],
        user_profiles: users.map((id) => ({ user_id: id, email: `${id}@firm.example`, created_by_org_id: null, terms_accepted_version: LEGAL_VERSION })),
        audit_events: [],
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
    h.caller = "member";
    vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "test-secret-low-entropy");
});
afterEach(() => vi.unstubAllEnvs());

const get = (org: string) => request(app).get(`/orgs/${org}/profile`).set(...AUTH);
const put = (org: string, body: unknown) => request(app).put(`/orgs/${org}/profile`).set(...AUTH).set("Origin", ORIGIN).send(body as object);

describe("firm profile routes", () => {
    it("lets a member read the profile but not write it", async () => {
        const read = await get("firm");
        expect(read.status).toBe(200);
        expect(read.body).toEqual({ profile: { hq_state: "JAL", size: "2-5" }, can_manage: false });
        const write = await put("firm", { profile: { size: "1" } });
        expect(write.status).toBe(403);
        expect(h.state!.tables.organizations[0].firm_profile).toEqual({ hq_state: "JAL", size: "2-5" });
        expect(h.state!.tables.audit_events).toEqual([]);
    });

    it("lets an admin write, and audits the changed fields without the free text", async () => {
        h.caller = "admin";
        const res = await put("firm", { profile: { hq_state: "JAL", size: "2-5", description: SECRET } });
        expect(res.status).toBe(200);
        expect(res.body.can_manage).toBe(true);
        expect(h.state!.tables.organizations[0].firm_profile).toEqual({ hq_state: "JAL", size: "2-5", description: SECRET });
        const events = h.state!.tables.audit_events;
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ action: "org.profile.updated" });
        expect(JSON.stringify(events)).toContain("description");
        expect(JSON.stringify(events)).not.toContain(SECRET);
    });

    it("refuses an invalid profile and writes nothing", async () => {
        h.caller = "owner";
        const res = await put("firm", { profile: { description: "x".repeat(1001) } });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(h.state!.tables.organizations[0].firm_profile).toEqual({ hq_state: "JAL", size: "2-5" });
    });

    it("does not show or change a firm to someone who is not in it", async () => {
        h.caller = "stranger";
        expect((await get("firm")).status).toBe(404);
        expect((await put("firm", { profile: null })).status).toBe(404);
        expect(h.state!.tables.organizations[0].firm_profile).toEqual({ hq_state: "JAL", size: "2-5" });
        // ...and their own firm shows its own profile, not the other's.
        expect((await get("other")).body.profile).toEqual({ size: "51+" });
    });
});

describe("what the assistant is given", () => {
    const read = (path: string) => readFileSync(resolve(__dirname, "../../", path), "utf8");

    it("is only the profile's own fields: nothing of who edited it or when", async () => {
        const selects: string[] = [];
        const db = {
            from: (table: string) => {
                const q: any = {
                    select: (cols: string) => {
                        selects.push(`${table}:${cols}`);
                        return q;
                    },
                    eq: () => q,
                    maybeSingle: async () => ({ data: { firm_profile: { size: "1" }, kind: "team" }, error: null }),
                    single: async () => ({ data: { firm_profile: { size: "1" }, kind: "team" }, error: null }),
                };
                return q;
            },
        } as never;
        expect(await loadFirmProfileFor(db, "firm")).toEqual({ size: "1" });
        expect(selects.filter((s) => s.startsWith("organizations:")).some((s) => s.includes("firm_profile"))).toBe(true);
        expect(selects.join(" ")).not.toMatch(/updated_by|created_by|email|updated_at/);
    });

    it("keeps the column closed to the browser roles, readable by members only through the existing policy", () => {
        const schema = read("../schema.sql");
        const migration = read("../migrations/20261113_30_litt_firm_profile.sql");
        expect(schema).toContain("revoke all on public.organizations from anon, authenticated;");
        for (const sql of [schema, migration]) {
            expect(sql).toContain("organizations_firm_profile_check");
            const grants = sql.split(";").filter((st) => /\bgrant\b/i.test(st) && /firm_profile/.test(st));
            expect(grants).toEqual([]);
        }
        expect(schema).toContain("20261113_30_litt_firm_profile.sql");
    });

    it("never enters the beta statistics", () => {
        expect(read("modules/platform/platform.stats.ts")).not.toMatch(/firm_profile|firmProfile/);
    });
});
