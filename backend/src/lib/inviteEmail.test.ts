import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentityService } from "../__tests__/helpers/fakeIdentityService";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import {
    forgetRecentInvitations,
    inviteAdmittedSignup,
    recordCreatingOrgOfSignup,
    retireUnusedInvitationIdentity,
    sendSignupInvite,
} from "./inviteEmail";

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
    forgetRecentInvitations();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("SUPABASE_URL", "http://identity.test/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", vi.fn(idp.fetch));
});
afterEach(() => {
    vi.useRealTimers();
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
        vi.setSystemTime(Date.now() + 9 * 60_000);
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("held");
        vi.setSystemTime(Date.now() + 2 * 60_000);
        expect((await inviteAdmittedSignup(db, "new@firm.example")).kind).toBe("sent");
    });

    describe("the mail cool-down per address", () => {
        const ADDRESS = "new@firm.example";
        const setup = (address = ADDRESS) => {
            // Invited long enough ago that the identity service's own date no longer holds a repeat.
            idp.seed(address, { invitedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
            const { db } = world(vi.fn(idp.invite));
            withAdmin(db, { updateUserById: vi.fn(idp.updateUserById) });
            return db;
        };
        const mailsTo = (address: string) => idp.mails.filter((m) => m.email === address).length;

        it("mails an address once for twenty requests one after the other", async () => {
            const db = setup();
            // The identity service dates every invitation to now, so its own date would hold
            // a repeat; it is put back each time to prove the process's own memory does.
            for (let i = 0; i < 20; i++) {
                idp.minutesAgo(ADDRESS, 11);
                await inviteAdmittedSignup(db, ADDRESS);
            }
            expect(mailsTo(ADDRESS)).toBe(1);
        });

        it("mails an address once for twenty requests at the same time", async () => {
            const db = setup();
            await Promise.all(Array.from({ length: 20 }, () => inviteAdmittedSignup(db, ADDRESS)));
            expect(mailsTo(ADDRESS)).toBe(1);
        });

        it("counts the address in its normalized form", async () => {
            const db = setup();
            await Promise.all([" New@Firm.example ", "NEW@firm.example", ADDRESS].map((a) => inviteAdmittedSignup(db, a)));
            await inviteAdmittedSignup(db, "New@FIRM.example");
            expect(mailsTo(ADDRESS)).toBe(1);
        });

        it("mails each of two addresses once", async () => {
            const db = setup();
            idp.seed("second@firm.example", { invitedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
            await Promise.all(
                Array.from({ length: 10 }, () => [ADDRESS, "second@firm.example"]).flat().map((a) => inviteAdmittedSignup(db, a)),
            );
            expect(mailsTo(ADDRESS)).toBe(1);
            expect(mailsTo("second@firm.example")).toBe(1);
        });

        it("mails once more after the cool-down", async () => {
            const db = setup();
            await inviteAdmittedSignup(db, ADDRESS);
            vi.setSystemTime(Date.now() + 9 * 60_000);
            idp.minutesAgo(ADDRESS, 11);
            await inviteAdmittedSignup(db, ADDRESS);
            expect(mailsTo(ADDRESS)).toBe(1);
            vi.setSystemTime(Date.now() + 2 * 60_000);
            await inviteAdmittedSignup(db, ADDRESS);
            expect(mailsTo(ADDRESS)).toBe(2);
        });

        it("lets a failed attempt be retried at once", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const db = setup();
            const send = vi.fn().mockResolvedValueOnce({ data: {}, error: { message: "smtp down" } }).mockImplementation(idp.invite);
            withAdmin(db, { inviteUserByEmail: send });
            expect((await inviteAdmittedSignup(db, ADDRESS)).kind).toBe("failed");
            expect((await inviteAdmittedSignup(db, ADDRESS)).kind).toBe("sent");
        });
    });

    describe("the caller's permission to mail", () => {
        const ADDRESS = "new@firm.example";
        const setup = () => {
            idp.seed(ADDRESS, { password: "someone-elses", invitedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
            const invite = vi.fn(idp.invite);
            const update = vi.fn(idp.updateUserById);
            const { db } = world(invite);
            withAdmin(db, { updateUserById: update });
            return { db, invite, update };
        };

        it("replaces nothing and requests nothing when the caller does not permit the mail", async () => {
            const { db, invite, update } = setup();
            const mayMail = vi.fn(() => false);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail })).kind).toBe("held");
            expect(mayMail).toHaveBeenCalledTimes(1);
            expect(update).not.toHaveBeenCalled();
            expect(invite).not.toHaveBeenCalled();
            expect(idp.identities.get(ADDRESS)!.password).toBe("someone-elses");
        });

        it("replaces the password and mails once when the caller permits the mail", async () => {
            const { db, invite, update } = setup();
            const mayMail = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail })).kind).toBe("sent");
            expect(mayMail).toHaveBeenCalledTimes(1);
            expect(update).toHaveBeenCalledTimes(1);
            expect(invite).toHaveBeenCalledTimes(1);
        });

        it("asks permission for an address with no identity as well", async () => {
            const { db, invite, update } = setup();
            const mayMail = vi.fn(() => false);
            expect((await inviteAdmittedSignup(db, "nobody@firm.example", { mayMail })).kind).toBe("held");
            expect(mayMail).toHaveBeenCalledTimes(1);
            expect(update).not.toHaveBeenCalled();
            expect(invite).not.toHaveBeenCalled();
        });

        it("does not ask permission for an address whose identity is confirmed, and says it has an account", async () => {
            idp.seed("owner@firm.example", { password: "owners", confirmed: true });
            const { db, update } = (() => {
                const update = vi.fn(idp.updateUserById);
                const { db } = world(vi.fn(idp.invite));
                withAdmin(db, { updateUserById: update });
                return { db, update };
            })();
            const mayMail = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, "owner@firm.example", { mayMail })).kind).toBe("has_account");
            expect(mayMail).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it("does not ask permission for an invitation held by the cool-down or in flight", async () => {
            const { db } = setup();
            const first = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail: first })).kind).toBe("sent");
            const repeat = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail: repeat })).kind).toBe("held");
            expect(repeat).not.toHaveBeenCalled();

            // The identity service's own invitation date holds a repeat as well.
            forgetRecentInvitations();
            idp.minutesAgo(ADDRESS, 3);
            const dated = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail: dated })).kind).toBe("held");
            expect(dated).not.toHaveBeenCalled();

            forgetRecentInvitations();
            idp.minutesAgo(ADDRESS, 11);
            const together = vi.fn(() => true);
            await Promise.all(Array.from({ length: 5 }, () => inviteAdmittedSignup(db, ADDRESS, { mayMail: together })));
            expect(together).toHaveBeenCalledTimes(1);
        });

        it("does not ask permission when the identity lookup fails", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const { db, invite } = setup();
            vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
            const mayMail = vi.fn(() => true);
            expect((await inviteAdmittedSignup(db, ADDRESS, { mayMail })).kind).toBe("failed");
            expect(mayMail).not.toHaveBeenCalled();
            expect(invite).not.toHaveBeenCalled();
        });

        it("asks nothing of a signed-in invitation", async () => {
            const { db, invite } = setup();
            expect(await sendSignupInvite(db, ADDRESS)).toBe(true);
            expect(invite).toHaveBeenCalledTimes(1);
        });
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

describe("retiring the account a withdrawn invitation created", () => {
    const FUTURE = "2999-01-01T00:00:00.000Z";
    const except = { table: "platform_invitations", id: "pi-1" } as const;
    const setup = () => {
        const tables: Record<string, Row[]> = { org_members: [], org_invitations: [], platform_invitations: [] };
        const mem = memoryDb(tables);
        const deleteUser = vi.fn(idp.deleteUser);
        (mem.db as { auth?: unknown }).auth = { admin: { deleteUser } };
        idp.attachTables(() => tables);
        return { tables, db: mem.db, deleteUser };
    };
    const invitedOnly = (email = "guest@firm.example") =>
        idp.seed(email, { invitedAt: LONG_AGO });

    it("removes an invited account that never confirmed or signed in", async () => {
        const { db, deleteUser } = setup();
        invitedOnly();
        await retireUnusedInvitationIdentity(db, " Guest@Firm.example ", except);
        expect(deleteUser).toHaveBeenCalledTimes(1);
        expect(idp.identities.has("guest@firm.example")).toBe(false);
    });

    it("does nothing when there is no account", async () => {
        const { db, deleteUser } = setup();
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it.each([
        ["confirmed", { confirmed: true }],
        ["signed in", { lastSignInAt: LONG_AGO }],
        ["made by an earlier sign-up, never invited", { invitedAt: null }],
    ])("keeps an account that is %s", async (_name, partial) => {
        const { db, deleteUser } = setup();
        idp.seed("guest@firm.example", { invitedAt: LONG_AGO, ...partial });
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("keeps an account that belongs to a firm, though every account also owns a personal organization", async () => {
        const { db, tables, deleteUser } = setup();
        invitedOnly();
        const id = idp.identities.get("guest@firm.example")!.id;
        expect(tables.org_members.filter((m) => m.user_id === id && m.role === "owner")).toHaveLength(1);
        tables.org_members.push({ id: "m-firm", org_id: "firm-org", user_id: id, role: "member" });
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("keeps the account of a platform administrator", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "guest@firm.example");
        const { db, deleteUser } = setup();
        invitedOnly();
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("keeps an account with another live platform invitation but not the withdrawn one", async () => {
        const { db, tables, deleteUser } = setup();
        invitedOnly();
        tables.platform_invitations.push({ id: "pi-1", email: "guest@firm.example", status: "pending", expires_at: FUTURE });
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).toHaveBeenCalledTimes(1);
        tables.platform_invitations.push({ id: "pi-2", email: "guest@firm.example", status: "pending", expires_at: FUTURE });
        invitedOnly();
        await retireUnusedInvitationIdentity(db, "guest@firm.example", except);
        expect(deleteUser).toHaveBeenCalledTimes(1);
    });

    it("throws, removing nothing, when it cannot tell", async () => {
        const { db, deleteUser } = setup();
        invitedOnly();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
        await expect(retireUnusedInvitationIdentity(db, "guest@firm.example", except)).rejects.toThrow();
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("throws when a lookup of memberships or invitations fails", async () => {
        const { db, deleteUser } = setup();
        invitedOnly();
        const failing = {
            ...db,
            from: () => {
                throw new Error("db down");
            },
        };
        await expect(retireUnusedInvitationIdentity(failing as never, "guest@firm.example", except)).rejects.toThrow();
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("throws when the account cannot be removed", async () => {
        const { db, deleteUser } = setup();
        invitedOnly();
        deleteUser.mockResolvedValue({ data: null, error: { message: "boom" } } as never);
        await expect(retireUnusedInvitationIdentity(db, "guest@firm.example", except)).rejects.toBeTruthy();
    });
});
