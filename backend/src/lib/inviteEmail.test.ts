import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentityService } from "../__tests__/helpers/fakeIdentityService";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import { inviteAdmittedSignup, recordCreatingOrgOfSignup, sendSignupInvite } from "./inviteEmail";

const now = () => new Date().toISOString();
const LONG_AGO = "2020-01-01T00:00:00.000Z";

function world(invite: ReturnType<typeof vi.fn>) {
    const tables: Record<string, Row[]> = {
        user_profiles: [
            { user_id: "new", created_by_org_id: null },
            { user_id: "old", created_by_org_id: null },
            { user_id: "other", created_by_org_id: "first-firm" },
        ],
        org_invitations: [],
    };
    const mem = memoryDb(tables);
    (mem.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite } };
    return { tables, db: mem.db };
}
const profile = (t: Record<string, Row[]>, id: string) => t.user_profiles.find((p) => p.user_id === id)!;

const idp = fakeIdentityService();
beforeEach(() => {
    idp.reset();
    vi.stubEnv("SUPABASE_URL", "http://identity.test/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", vi.fn(idp.fetch));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("recording the firm whose invitation created an account", () => {
    it("records it for the account the invitation email just made", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "new@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBe("firm");
    });

    it("leaves an account that existed before the invitation without one", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "old", created_at: LONG_AGO } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "old@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("records nothing when the address already has an account", async () => {
        const invite = vi.fn().mockResolvedValue({ data: {}, error: { code: "email_exists", message: "registered" } });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "old@firm.example", { createdByOrgId: "firm" })).toBe(false);
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("never replaces the first firm", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "other", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        await sendSignupInvite(db, "other@firm.example", { createdByOrgId: "second-firm" });
        expect(profile(tables, "other").created_by_org_id).toBe("first-firm");
    });

    it("records nothing for the platform's own invitations", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "new@firm.example")).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBeNull();
    });

    it("still reports the email as sent when recording fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { tables } = world(invite);
        const mem = memoryDb(tables);
        (mem.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite } };
        mem.failNext("user_profiles", "update", { message: "boom" });
        expect(await sendSignupInvite(mem.db, "new@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });
});

describe("closed-beta sign-up on a firm's invitation", () => {
    const invitation = (orgId: string, created: string, extra: Row = {}): Row => ({
        email: "new@firm.example",
        org_id: orgId,
        status: "pending",
        expires_at: "2999-01-01T00:00:00.000Z",
        created_at: created,
        ...extra,
    });

    it("records the oldest live invitation's firm for the new account", async () => {
        const { db, tables } = world(vi.fn());
        tables.org_invitations.push(invitation("younger", "2026-02-01"), invitation("elder", "2026-01-01"));
        await recordCreatingOrgOfSignup(db, { id: "new", created_at: now() }, " New@Firm.example ");
        expect(profile(tables, "new").created_by_org_id).toBe("elder");
    });

    it("ignores expired invitations and accounts that were not just made", async () => {
        const { db, tables } = world(vi.fn());
        tables.org_invitations.push(invitation("late", "2026-01-01", { expires_at: "2000-01-01T00:00:00.000Z" }));
        await recordCreatingOrgOfSignup(db, { id: "new", created_at: now() }, "new@firm.example");
        expect(profile(tables, "new").created_by_org_id).toBeNull();
        tables.org_invitations.push(invitation("firm", "2026-01-01"));
        await recordCreatingOrgOfSignup(db, { id: "old", created_at: LONG_AGO }, "new@firm.example");
        await recordCreatingOrgOfSignup(db, null, "new@firm.example");
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("never throws", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const mem = memoryDb({ org_invitations: [] });
        mem.failNext("org_invitations", "select", { message: "boom" });
        await expect(recordCreatingOrgOfSignup(mem.db, { id: "new", created_at: now() }, "a@b.c")).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalled();
    });
});

describe("closed-beta sign-up by an admitted address", () => {
    const invitation = (orgId: string, created: string): Row => ({
        email: "new@firm.example",
        org_id: orgId,
        status: "pending",
        expires_at: "2999-01-01T00:00:00.000Z",
        created_at: created,
    });
    const withAdmin = (db: unknown, admin: Record<string, unknown>) => {
        (db as { auth: { admin: Record<string, unknown> } }).auth.admin = { ...(db as { auth: { admin: object } }).auth.admin, ...admin };
    };
    const asked = () => vi.mocked(fetch).mock.calls.map((call) => String(call[0]));

    it("mails the link to the normalized address and replaces nothing for a new account", async () => {
        const invite = vi.fn(idp.invite);
        const update = vi.fn(idp.updateUserById);
        const { db, tables } = world(invite);
        withAdmin(db, { updateUserById: update });
        tables.org_invitations.push(invitation("younger", "2026-02-01"), invitation("elder", "2026-01-01"));
        expect((await inviteAdmittedSignup(db, " New@Firm.example ")).kind).toBe("sent");
        expect(invite.mock.calls[0][0]).toBe("new@firm.example");
        expect(asked()[0]).toBe("http://identity.test/auth/v1/admin/users?filter=new%40firm.example&page=1&per_page=50");
        expect(update).not.toHaveBeenCalled();
    });

    it("finds the identity by the exact address among look-alikes, on a later page, whatever the case", async () => {
        for (let i = 0; i < 55; i++) idp.seed(`a${i}new@firm.example`);
        idp.seed("new@firm.example", { password: "someone-elses" });
        const update = vi.fn(idp.updateUserById);
        const { db } = world(vi.fn(idp.invite));
        withAdmin(db, { updateUserById: update });
        expect(await sendSignupInvite(db, "New@Firm.example")).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(idp.identities.get("new@firm.example")!.password).not.toBe("someone-elses");
        expect(asked().length).toBeGreaterThan(1);
    });

    it("fails closed, mailing nothing, when it cannot tell whether an identity exists", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const invite = vi.fn(idp.invite);
        const { db } = world(invite);
        for (const failure of [
            () => Promise.resolve(new Response("{}", { status: 500 })),
            () => Promise.reject(new Error("down")),
        ]) {
            vi.stubGlobal("fetch", vi.fn(failure));
            expect(await sendSignupInvite(db, "new@firm.example")).toBe(false);
            expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("failed");
        }
        // Every page full of look-alikes: not found is not the same as not looked.
        for (let i = 0; i < 520; i++) idp.seed(`a${i}new@firm.example`);
        vi.stubGlobal("fetch", vi.fn(idp.fetch));
        expect(await sendSignupInvite(db, "new@firm.example")).toBe(false);
        vi.unstubAllEnvs();
        expect(await sendSignupInvite(db, "new@firm.example")).toBe(false);
        expect(invite).not.toHaveBeenCalled();
    });

    it("never touches a confirmed identity, and says it has an account", async () => {
        idp.seed("old@firm.example", { password: "owners", confirmed: true });
        const update = vi.fn(idp.updateUserById);
        const { db } = world(vi.fn(idp.invite));
        withAdmin(db, { updateUserById: update });
        expect((await inviteAdmittedSignup(db, "old@firm.example")).kind).toBe("has_account");
        expect(await sendSignupInvite(db, "old@firm.example")).toBe(false);
        expect(update).not.toHaveBeenCalled();
    });

    it("holds an anonymous repeat within ten minutes, but not a signed-in invitation", async () => {
        const invite = vi.fn(idp.invite);
        const update = vi.fn(idp.updateUserById);
        const { db } = world(invite);
        withAdmin(db, { updateUserById: update });
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("sent");
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("held");
        expect(invite).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
        expect(await sendSignupInvite(db, "new@firm.example")).toBe(true);
        expect(invite).toHaveBeenCalledTimes(2);
        idp.minutesAgo("new@firm.example", 9);
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("held");
        idp.minutesAgo("new@firm.example", 11);
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("sent");
    });

    it("does not hold an account made by an earlier sign-up, which has no invitation date", async () => {
        idp.seed("old@firm.example", { password: "someone-elses", createdAt: new Date().toISOString() });
        const { db } = world(vi.fn(idp.invite));
        withAdmin(db, { updateUserById: vi.fn(idp.updateUserById) });
        expect((await inviteAdmittedSignup(db, "old@firm.example")).kind).toBe("sent");
        expect(idp.identities.get("old@firm.example")!.password).not.toBe("someone-elses");
    });

    it("fails closed, mailing nothing, when the password cannot be replaced", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        idp.seed("old@firm.example", { password: "someone-elses" });
        const invite = vi.fn(idp.invite);
        const { db } = world(invite);
        withAdmin(db, { updateUserById: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) });
        expect((await inviteAdmittedSignup(db, "old@firm.example")).kind).toBe("failed");
        withAdmin(db, { updateUserById: vi.fn().mockRejectedValue(new Error("down")) });
        expect(await sendSignupInvite(db, "old@firm.example")).toBe(false);
        expect(invite).not.toHaveBeenCalled();
    });

    it("distinguishes an address with an account from a failure and never throws", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { db } = world(vi.fn().mockResolvedValue({ data: {}, error: { code: "email_exists", message: "x" } }));
        expect((await inviteAdmittedSignup(db, "old@firm.example")).kind).toBe("has_account");
        const down = world(vi.fn().mockRejectedValue(new Error("smtp down")));
        expect((await inviteAdmittedSignup(down.db, "old@firm.example")).kind).toBe("failed");
    });
});
