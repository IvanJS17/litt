import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Membership, role, invitation and archive-recovery changes over HTTP, through
// the REAL requireAuth and requireMfaIfEnrolled: a signed-in owner whose
// account has a second factor must have verified it in this session before
// any of them is written; an account with no factor is not asked for one.
const h = vi.hoisted(() => ({
    assurance: { currentLevel: "aal1", nextLevel: "aal1" },
    state: null as null | { db: any; tables: Record<string, Row[]> },
    rpcCalls: [] as string[],
    invited: [] as string[],
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
import { LEGAL_VERSION } from "../../modules/user/user.service";

const AUTH = ["Authorization", "Bearer test"] as const;
const ARCHIVE = "11111111-1111-4111-8111-111111111111";
const INVITATION = "22222222-2222-4222-8222-222222222222";
const PLATFORM_INVITATION = "33333333-3333-4333-8333-333333333333";

function world() {
    const tables: Record<string, Row[]> = {
        organizations: [{ id: "firm", name: "Despacho Aurora", deleted_at: null }],
        org_members: [
            { id: "m1", org_id: "firm", user_id: "owner", role: "owner" },
            { id: "m2", org_id: "firm", user_id: "member", role: "member" },
        ],
        user_profiles: [
            { user_id: "owner", email: "owner@firm.example", mfa_on_login: false, terms_accepted_version: LEGAL_VERSION },
            { user_id: "member", email: "member@firm.example", terms_accepted_version: LEGAL_VERSION },
        ],
        org_invitations: [
            {
                id: INVITATION, org_id: "firm", email: "guest@firm.example", role: "member",
                status: "pending", invited_by: "owner", expires_at: "2999-01-01T00:00:00.000Z",
            },
        ],
        org_departure_archives: [{ id: ARCHIVE, org_id: "firm", kind: "project", item_id: "p1" }],
        platform_invitations: [
            { id: PLATFORM_INVITATION, email: "beta@firm.example", status: "pending", expires_at: "2999-01-01T00:00:00.000Z" },
        ],
        audit_events: [],
    };
    const mem = memoryDb(tables, {
        resolve_org_departure_archive: () => {
            h.rpcCalls.push("resolve_org_departure_archive");
            return null;
        },
        org_members_departure_items: () => [],
        remove_org_member: (args, t) => {
            h.rpcCalls.push("remove_org_member");
            t.org_members = t.org_members.filter((m) => m.user_id !== args.p_user_id);
            return null;
        },
    });
    (mem.db as { auth?: unknown }).auth = {
        getUser: async () => ({
            data: { user: { id: "owner", email: "owner@firm.example", email_confirmed_at: "2026-01-01" } },
            error: null,
        }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: h.assurance, error: null }) },
        admin: {
            inviteUserByEmail: async (email: string) => {
                h.invited.push(email);
                return { data: {}, error: null };
            },
        },
    };
    return { tables, db: mem.db };
}

beforeEach(() => {
    h.state = world();
    h.rpcCalls = [];
    h.invited = [];
    h.assurance = { currentLevel: "aal1", nextLevel: "aal1" };
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "owner@firm.example");
    // Withdrawing an invitation asks the identity service about the address;
    // here it knows nobody.
    vi.stubEnv("SUPABASE_URL", "http://identity.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ users: [] })));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

const ORIGIN = "http://localhost:3000";
const send = (method: "post" | "patch" | "delete" | "put", path: string, body?: object) =>
    request(app)[method](path).set(...AUTH).set("Origin", ORIGIN).send(body);

const MUTATIONS: [string, () => request.Test][] = [
    ["role change", () => send("patch", "/orgs/firm/members/member", { role: "admin" })],
    ["member removal", () => send("delete", "/orgs/firm/members/member")],
    ["invitation create", () => send("post", "/orgs/firm/invitations", { email: "new@firm.example", role: "member" })],
    ["invitation revoke", () => send("delete", `/orgs/firm/invitations/${INVITATION}`)],
    ["invitation resend", () => send("post", `/orgs/firm/invitations/${INVITATION}/resend`)],
    ["archive recovery", () => send("post", `/orgs/firm/archives/${ARCHIVE}/recover`, { assign_to: "member" })],
    ["bulk archive recovery", () => send("post", "/orgs/firm/archives/recover", { archive_ids: [ARCHIVE], assign_to: "member" })],
    ["platform invitation create", () => send("post", "/platform/invitations", { email: "newbeta@firm.example" })],
    ["platform invitation delete", () => send("delete", `/platform/invitations/${PLATFORM_INVITATION}`)],
];

const snapshot = () => JSON.stringify([h.state!.tables, h.rpcCalls, h.invited]);

describe("second factor on membership and invitation changes", () => {
    it.each(MUTATIONS)("%s: an enrolled owner at aal1 is refused and nothing is written", async (_name, call) => {
        h.assurance = { currentLevel: "aal1", nextLevel: "aal2" };
        const before = snapshot();
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("mfa_verification_required");
        expect(snapshot()).toBe(before);
    });

    it.each(MUTATIONS)("%s: the same owner at aal2 succeeds", async (_name, call) => {
        h.assurance = { currentLevel: "aal2", nextLevel: "aal2" };
        const before = snapshot();
        const res = await call();
        expect(res.status).toBeLessThan(300);
        expect(snapshot()).not.toBe(before);
    });

    it.each(MUTATIONS)("%s: an owner with no factor enrolled still succeeds", async (_name, call) => {
        const res = await call();
        expect(res.status).toBeLessThan(300);
    });
});
