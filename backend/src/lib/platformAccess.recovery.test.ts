import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentityService } from "../__tests__/helpers/fakeIdentityService";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import { mayRecoverPassword } from "./platformAccess";

// Who may have a recovery mail requested in invitation-only mode: an
// administrator, an address with a current invitation, or a confirmed identity
// that is not an unfinished invitation.
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";
const A = "someone@firm.example";

const idp = fakeIdentityService();
let world: ReturnType<typeof memoryDb>;
let fetchCalls: number;

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        org_invitations: [],
        platform_invitations: [],
        organizations: [],
        org_members: [],
        user_profiles: [],
    };
    world = memoryDb(tables);
    idp.reset();
    idp.attachTables(() => tables);
    fetchCalls = 0;
    vi.stubEnv("SUPABASE_URL", "http://identity.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "boss@firm.example");
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof idp.fetch>) => {
        fetchCalls++;
        return idp.fetch(...args);
    }));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

const may = (address = A) => mayRecoverPassword(world.db, address);
const idOf = (email = A) => idp.identities.get(email)!.id;
const profile = (marks: Row) => world.tables.user_profiles.push({ user_id: idOf(), ...marks });

describe("mayRecoverPassword", () => {
    it("is true outside invitation-only mode and reads nothing", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        expect(await may("anyone@firm.example")).toBe(true);
        expect(fetchCalls).toBe(0);
    });

    it("is true for an administrator, whatever the case, without a lookup", async () => {
        expect(await may(" BOSS@Firm.example ")).toBe(true);
        expect(fetchCalls).toBe(0);
    });

    it("is true for a current platform invitation or a current firm invitation", async () => {
        world.tables.platform_invitations.push({ id: "p", email: A, status: "pending", expires_at: FUTURE });
        expect(await may()).toBe(true);
        world.tables.platform_invitations.length = 0;
        world.tables.org_invitations.push({ id: "o", email: A, status: "pending", expires_at: FUTURE });
        expect(await may()).toBe(true);
    });

    it("is false for no identity, and for an expired or used invitation of an unconfirmed identity", async () => {
        expect(await may()).toBe(false);
        idp.seed(A, { invitedAt: LONG_AGO });
        world.tables.platform_invitations.push({ id: "p", email: A, status: "pending", expires_at: PAST });
        world.tables.org_invitations.push({ id: "o", email: A, status: "accepted", expires_at: FUTURE });
        expect(await may()).toBe(false);
    });

    it("is true for a confirmed identity that no invitation created", async () => {
        idp.seed(A, { confirmed: true });
        expect(await may()).toBe(true);
    });

    it("is false for a confirmed invited identity with no finished mark", async () => {
        idp.seed(A, { confirmed: true, invitedAt: LONG_AGO });
        expect(await may()).toBe(false);
        profile({ password_set_at: null, terms_accepted_at: null, onboarding_version: null });
        expect(await may()).toBe(false);
    });

    it.each([
        ["a password set", { password_set_at: LONG_AGO }],
        ["accepted terms", { terms_accepted_at: LONG_AGO }],
        ["an onboarding version", { onboarding_version: 0 }],
    ])("is true for a confirmed invited identity whose profile shows %s", async (_name, marks) => {
        idp.seed(A, { confirmed: true, invitedAt: LONG_AGO });
        profile(marks);
        expect(await may()).toBe(true);
    });

    it("is true for a confirmed invited identity in a firm, but not for one in its personal organization only", async () => {
        idp.seed(A, { confirmed: true, invitedAt: LONG_AGO });
        expect(await may()).toBe(false);
        world.tables.org_members.push({ id: "m", org_id: "firm-1", user_id: idOf(), role: "member" });
        expect(await may()).toBe(true);
    });

    it("throws when the identity lookup cannot tell", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
        await expect(may()).rejects.toThrow();
    });

    it.each(["org_invitations", "platform_invitations"])("throws when reading %s fails", async (table) => {
        world.failNext(table, "select", { message: "unavailable" });
        await expect(may()).rejects.toBeDefined();
    });

    it.each(["user_profiles", "org_members", "organizations"])("throws when reading %s fails for a confirmed invited identity", async (table) => {
        idp.seed(A, { confirmed: true, invitedAt: LONG_AGO });
        world.failNext(table, "select", { message: "unavailable" });
        await expect(may()).rejects.toBeDefined();
    });
});
