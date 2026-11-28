import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";
import type { createAnonymousMailCap } from "../../lib/anonymousMailCap";

type AnonymousMailCap = ReturnType<typeof createAnonymousMailCap>;

// Invite-only beta over HTTP: who may register, who may create an
// organization, and who may manage platform invitations. Every rule compares
// the normalized email and nothing else.
const h = vi.hoisted(() => ({
    caller: { id: "u1", email: "u1@test.local" },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
    // The cap on anonymous mails is one instance for the life of the process;
    // each test gets a fresh one so that counts never carry over between tests.
    newCap: null as unknown as () => AnonymousMailCap,
    cap: null as unknown as AnonymousMailCap,
}));
vi.mock("../../lib/anonymousMailCap", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/anonymousMailCap")>();
    h.newCap = () => actual.createAnonymousMailCap({ overall: actual.MAIL_OVERALL_DEFAULT });
    h.cap = h.newCap();
    return {
        ...actual,
        anonymousMailCap: {
            admit: (...args: Parameters<AnonymousMailCap["admit"]>) => h.cap.admit(...args),
            size: () => h.cap.size(),
            keys: () => h.cap.keys(),
        },
    };
});
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
                next();
            }),
    };
});
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createRequestSupabase: vi.fn(() => ({})),
}));
vi.mock("../../modules/auth/auth.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/auth/auth.service")>()),
    signUpWithPassword: vi.fn(async (_client: unknown, args: { email: string; password: string }) =>
        idp.signUp(args.email.trim().toLowerCase(), args.password)),
}));

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { createRequestSupabase } from "../../lib/authSession";
import { signUpWithPassword } from "../../modules/auth/auth.service";
import { fakeIdentityService } from "../helpers/fakeIdentityService";
import { forgetRecentInvitations } from "../../lib/inviteEmail";

const idp = fakeIdentityService();

const invite = vi.fn();
const update = vi.fn();
const AUTH = ["Authorization", "Bearer test"] as const;
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
// Each call comes from its own address so the per-address sign-up limiter stays out of the way.
let caller = 0;
// In beta mode the route answers first and works afterwards, so the helper
// lets that work finish (everything behind it is in memory) before returning.
const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
};
const signup = async (email: string, password = "a-long-enough-password") => {
    const res = await request(app).post("/auth/signup").set("Origin", "http://localhost:3000").set("X-Forwarded-For", `198.51.100.${++caller}`).send({ email, password });
    await settle();
    return res;
};
const as = (id: string, email: string) => {
    h.caller = { id, email };
};

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        org_invitations: [],
        platform_invitations: [],
        organizations: [],
        org_members: [],
        audit_events: [],
        user_profiles: [],
    };
    h.state = memoryDb(tables);
    h.cap = h.newCap();
    idp.reset();
    forgetRecentInvitations();
    vi.useFakeTimers({ toFake: ["Date"] });
    idp.attachTables(() => tables);
    invite.mockReset().mockImplementation(idp.invite);
    update.mockReset().mockImplementation(idp.updateUserById);
    (h.state.db as { auth?: unknown }).auth = {
        admin: {
            inviteUserByEmail: invite,
            updateUserById: update,
            getUserById: vi.fn(idp.getUserById),
            deleteUser: vi.fn(idp.deleteUser),
        },
    };
    vi.stubEnv("SUPABASE_URL", "http://identity.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", vi.fn(idp.fetch));
    as("u1", "u1@test.local");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", " Boss@Firm.example , other@firm.example");
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("POST /auth/signup in beta mode", () => {
    it("sends nothing to an email with no invitation", async () => {
        const res = await signup("stranger@firm.example");
        expect(res.status).toBe(201);
        expect(invite).not.toHaveBeenCalled();
        expect(idp.identities.size).toBe(0);
    });

    it("accepts a pending organization invitation, matched by normalized email", async () => {
        h.state!.tables.org_invitations.push({ email: "guest@firm.example", status: "pending", expires_at: FUTURE });
        expect((await signup(" Guest@Firm.example ")).status).toBe(201);
    });

    it("accepts a pending platform invitation", async () => {
        h.state!.tables.platform_invitations.push({ id: "pi-0", email: "guest@firm.example", status: "pending", expires_at: FUTURE });
        expect((await signup("guest@firm.example")).status).toBe(201);
    });

    it("accepts a platform administrator", async () => {
        expect((await signup("BOSS@firm.example")).status).toBe(201);
    });

    it("sends nothing for an expired invitation", async () => {
        h.state!.tables.platform_invitations.push({ email: "late@firm.example", status: "pending", expires_at: PAST });
        h.state!.tables.org_invitations.push({ email: "late@firm.example", status: "pending", expires_at: PAST });
        expect((await signup("late@firm.example")).status).toBe(201);
        expect(invite).not.toHaveBeenCalled();
    });

    it("is open without the variable", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        expect((await signup("stranger@firm.example")).status).toBe(201);
    });
});

describe("POST /auth/signup in beta mode: the password of an invited address", () => {
    const ATTACKER = "first-caller-password";
    const OWNER = "the-owners-own-password";
    const GUEST = "guest@firm.example";
    const addresses: Array<[string, string, () => void]> = [
        ["a firm's invitation", GUEST, () =>
            h.state!.tables.org_invitations.push({ org_id: "o1", email: GUEST, status: "pending", expires_at: FUTURE })],
        ["a platform invitation", GUEST, () =>
            h.state!.tables.platform_invitations.push({ id: "pi-0", email: GUEST, status: "pending", expires_at: FUTURE })],
        ["a platform administrator with no account", "boss@firm.example", () => {}],
    ];
    const admitGuest = () =>
        h.state!.tables.org_invitations.push({ org_id: "o1", email: GUEST, status: "pending", expires_at: FUTURE });

    it.each(addresses)("is not chosen by whoever signs up first, for %s", async (_name, email, arrange) => {
        arrange();
        expect((await signup(email, ATTACKER)).status).toBe(201);
        vi.setSystemTime(Date.now() + 11 * 60_000);
        expect((await signup(email, OWNER)).status).toBe(201);
        // The owner opens the newest mail sent to the address.
        expect(idp.openLink(email)).toBe(true);
        expect(idp.canSignIn(email, ATTACKER)).toBe(false);
        // Then chooses a password from that link.
        idp.choosePassword(email, OWNER);
        expect(idp.canSignIn(email, OWNER)).toBe(true);
        expect(idp.canSignIn(email, ATTACKER)).toBe(false);
    });

    it("asks the identity service to mail the invitation link", async () => {
        h.state!.tables.platform_invitations.push({ id: "pi-0", email: GUEST, status: "pending", expires_at: FUTURE });
        await signup("Guest@Firm.example", ATTACKER);
        expect(invite).toHaveBeenCalledTimes(1);
        expect(invite.mock.calls[0][0]).toBe(GUEST);
        expect(invite.mock.calls[0][1].redirectTo).toContain("/auth/set-password");
    });

    it("replaces a password an unconfirmed identity already holds, before the mail", async () => {
        idp.seed(GUEST, { password: ATTACKER });
        admitGuest();
        expect((await signup(GUEST, OWNER)).status).toBe(201);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.invocationCallOrder[0]).toBeLessThan(invite.mock.invocationCallOrder[0]);
        expect(idp.openLink(GUEST)).toBe(true);
        expect(idp.canSignIn(GUEST, ATTACKER)).toBe(false);
    });

    it("leaves a confirmed account alone and answers the same way", async () => {
        idp.seed(GUEST, { password: OWNER, confirmed: true });
        admitGuest();
        const res = await signup(GUEST, ATTACKER);
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ user: null, requiresEmailConfirmation: true });
        expect(update).not.toHaveBeenCalled();
        expect(idp.mails).toHaveLength(0);
        expect(idp.canSignIn(GUEST, OWNER)).toBe(true);
        expect(idp.canSignIn(GUEST, ATTACKER)).toBe(false);
    });

    it("answers the same when the invitation mail cannot be sent", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        invite.mockResolvedValue({ data: {}, error: { code: "over_email_send_rate_limit", status: 429, message: "rate limit" } });
        h.state!.tables.platform_invitations.push({ id: "pi-0", email: GUEST, status: "pending", expires_at: FUTURE });
        const res = await signup(GUEST, ATTACKER);
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ user: null, requiresEmailConfirmation: true });
        expect(idp.identities.size).toBe(0);
    });

    it("mails nothing when the old password cannot be replaced", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        idp.seed(GUEST, { password: ATTACKER });
        update.mockResolvedValue({ data: null, error: { message: "boom" } });
        admitGuest();
        expect((await signup(GUEST, OWNER)).status).toBe(201);
        expect(idp.mails).toHaveLength(0);
    });

    describe("a second anonymous request for the same address", () => {
        it("sends no new mail within ten minutes and answers the same, so the first link keeps working", async () => {
            admitGuest();
            const first = await signup(GUEST, ATTACKER);
            const firstLink = idp.mails[0].token;
            const second = await signup(GUEST, ATTACKER);
            expect(second.status).toBe(first.status);
            expect(second.body).toEqual(first.body);
            expect(idp.mails).toHaveLength(1);
            expect(update).not.toHaveBeenCalled();
            expect(idp.openLink(GUEST, firstLink)).toBe(true);
        });

        it("sends one mail for twenty requests, one after the other or together, from different client addresses", async () => {
            admitGuest();
            idp.seed(GUEST, { invitedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
            for (let i = 0; i < 10; i++) {
                // The identity service's own date would hold a repeat; the process's memory is what is proven.
                idp.minutesAgo(GUEST, 11);
                await signup(GUEST, ATTACKER);
            }
            expect(idp.mails).toHaveLength(1);
            vi.setSystemTime(Date.now() + 11 * 60_000);
            await Promise.all(Array.from({ length: 10 }, () => signup(GUEST, ATTACKER)));
            expect(idp.mails).toHaveLength(2);
        });

        it("sends a new mail once the window has passed", async () => {
            admitGuest();
            await signup(GUEST, ATTACKER);
            vi.setSystemTime(Date.now() + 11 * 60_000);
            const again = await signup(GUEST, ATTACKER);
            expect(again.status).toBe(201);
            expect(idp.mails).toHaveLength(2);
        });
    });
});

describe("POST /auth/signup in beta mode: one answer for every address", () => {
    const FIRM = "firm-guest@firm.example";
    const PLATFORM = "platform-guest@firm.example";
    const cases: Array<[string, string, () => void, boolean]> = [
        ["an address with no invitation", "stranger@firm.example", () => {}, false],
        ["an address whose invitation expired", "late@firm.example", () =>
            h.state!.tables.org_invitations.push({ org_id: "o1", email: "late@firm.example", status: "pending", expires_at: PAST }), false],
        ["an address already registered and confirmed", "taken@firm.example", () =>
            idp.seed("taken@firm.example", { password: "their-own-password", confirmed: true }), false],
        ["an address with a firm invitation", FIRM, () =>
            h.state!.tables.org_invitations.push({ org_id: "o1", email: FIRM, status: "pending", expires_at: FUTURE }), true],
        ["an address with a platform invitation", PLATFORM, () =>
            h.state!.tables.platform_invitations.push({ id: "pi-0", email: PLATFORM, status: "pending", expires_at: FUTURE }), true],
        ["a platform administrator", "boss@firm.example", () => {}, true],
    ];

    it("answers with one status, one body and no cookie, and keeps the sign-up call out of it", async () => {
        const answers = [];
        for (const [, email, arrange] of cases) {
            arrange();
            const res = await signup(email);
            answers.push({ status: res.status, body: res.body, cookies: res.headers["set-cookie"] ?? null });
        }
        expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
        expect(answers[0]).toEqual({ status: 201, body: { user: null, requiresEmailConfirmation: true }, cookies: null });
        expect(createRequestSupabase).not.toHaveBeenCalled();
        expect(signUpWithPassword).not.toHaveBeenCalled();
    });

    it.each(cases)("mails the invitation only to an eligible address: %s", async (_name, email, arrange, eligible) => {
        arrange();
        await signup(email);
        expect(invite).toHaveBeenCalledTimes(eligible ? 1 : 0);
    });

    it("answers the same when the lookup of invitations fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const open = await signup("stranger@firm.example");
        h.state!.tables.org_invitations = new Proxy([], { get() { throw new Error("db down"); } }) as never;
        const broken = await signup("guest@firm.example");
        expect({ status: broken.status, body: broken.body }).toEqual({ status: open.status, body: open.body });
        expect(invite).not.toHaveBeenCalled();
    });
});

describe("POST /auth/oauth", () => {
    it("is closed in beta mode", async () => {
        const res = await request(app).post("/auth/oauth").set("Origin", "http://localhost:3000").send({ provider: "google" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("signup_invite_only");
    });
});

describe("POST /orgs in beta mode", () => {
    const create = () => request(app).post("/orgs").set(...AUTH).send({ name: "Firm" });

    it("refuses someone with no permission", async () => {
        const res = await create();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("org_creation_restricted");
    });

    it("lets a platform invitation create one organization, once", async () => {
        as("u2", "Guest@firm.example");
        h.state!.tables.platform_invitations.push({ id: "pi-1", email: "guest@firm.example", status: "pending", expires_at: FUTURE });
        expect((await create()).status).toBe(201);
        const [invitation] = h.state!.tables.platform_invitations;
        expect(invitation.status).toBe("used");
        expect(h.state!.tables.audit_events.map((e) => e.action)).toContain("platform.invitation_used");
        expect((await create()).status).toBe(403);
    });

    it("lets a platform administrator create", async () => {
        as("u3", "boss@firm.example");
        expect((await create()).status).toBe(201);
        expect((await create()).status).toBe(201);
    });

    it("is open without the variable", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        expect((await create()).status).toBe(201);
    });
});

describe("/platform", () => {
    it("refuses the invitation routes to anyone but an administrator", async () => {
        for (const res of [
            await request(app).get("/platform/invitations").set(...AUTH),
            await request(app).post("/platform/invitations").set(...AUTH).send({ email: "a@b.co" }),
            await request(app).delete("/platform/invitations/x").set(...AUTH),
        ]) {
            expect(res.status).toBe(403);
            expect(res.body.code).toBe("platform_admin_required");
        }
    });

    it("lets an administrator invite, list and cancel", async () => {
        as("u3", "boss@firm.example");
        const created = await request(app).post("/platform/invitations").set(...AUTH).send({ email: " New@Firm.example " });
        expect(created.status).toBe(201);
        expect(created.body.email).toBe("new@firm.example");
        const list = await request(app).get("/platform/invitations").set(...AUTH);
        expect(list.status).toBe(200);
        const del = await request(app).delete(`/platform/invitations/${created.body.id}`).set(...AUTH);
        expect(del.status).toBe(204);
    });

    describe("withdrawing an invitation", () => {
        const GUEST = "guest@firm.example";
        const admin = () => as("u3", "boss@firm.example");
        const invitePlatform = async () => {
            const created = await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST });
            expect(created.body.email_sent).toBe(true);
            return created.body.id as string;
        };
        const withdraw = (id: string) => request(app).delete(`/platform/invitations/${id}`).set(...AUTH);
        beforeEach(admin);

        it("removes the identity the invitation created, so its link leads nowhere", async () => {
            const id = await invitePlatform();
            expect(idp.identities.has(GUEST)).toBe(true);
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(false);
            expect(h.state!.tables.platform_invitations).toHaveLength(0);
        });

        it("keeps an identity whose link was opened", async () => {
            const id = await invitePlatform();
            idp.openLink(GUEST);
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(true);
        });

        it("keeps an identity that has signed in", async () => {
            const id = await invitePlatform();
            idp.identities.get(GUEST)!.lastSignInAt = new Date().toISOString();
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(true);
        });

        it("keeps an identity that belongs to a firm", async () => {
            const id = await invitePlatform();
            h.state!.tables.org_members.push({ id: "m1", org_id: "o1", user_id: idp.identities.get(GUEST)!.id, role: "member" });
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(true);
        });

        it("keeps an identity that holds another live invitation", async () => {
            const id = await invitePlatform();
            h.state!.tables.org_invitations.push({ id: "oi1", org_id: "o1", email: GUEST, status: "pending", expires_at: FUTURE });
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(true);
        });

        it("removes it when the only other invitation has expired or was withdrawn", async () => {
            const id = await invitePlatform();
            h.state!.tables.org_invitations.push(
                { id: "oi1", org_id: "o1", email: GUEST, status: "pending", expires_at: PAST },
                { id: "oi2", org_id: "o1", email: GUEST, status: "cancelled", expires_at: FUTURE },
            );
            expect((await withdraw(id)).status).toBe(204);
            expect(idp.identities.has(GUEST)).toBe(false);
        });

        it("fails, withdrawing nothing, when the identity service cannot be asked", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const id = await invitePlatform();
            vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
            expect((await withdraw(id)).status).toBeGreaterThanOrEqual(500);
            expect(h.state!.tables.platform_invitations).toHaveLength(1);
            expect(idp.identities.has(GUEST)).toBe(true);
        });

        it("fails, withdrawing nothing, when the identity cannot be removed", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const id = await invitePlatform();
            (h.state!.db as { auth: { admin: { deleteUser: ReturnType<typeof vi.fn> } } }).auth.admin.deleteUser
                .mockResolvedValue({ data: null, error: { message: "boom" } });
            expect((await withdraw(id)).status).toBeGreaterThanOrEqual(500);
            expect(h.state!.tables.platform_invitations).toHaveLength(1);
        });

        it("still reports an unknown invitation as missing", async () => {
            expect((await withdraw("nope")).status).toBe(404);
        });

        describe("the account of an invitation whose link was opened", () => {
            const guest = () => idp.identities.get(GUEST)!;
            const banned = () => !!guest().bannedUntil && Date.parse(guest().bannedUntil!) > Date.now();
            const ours = () => guest().appMetadata?.litt_blocked === "invitation_withdrawn";
            const opened = async () => {
                const id = await invitePlatform();
                idp.openLink(GUEST);
                idp.choosePassword(GUEST, "a-long-enough-password");
                return id;
            };
            const profile = (marks: Record<string, unknown>) =>
                h.state!.tables.user_profiles.push({ user_id: guest().id, ...marks });
            const failBlock = () =>
                update.mockImplementation(async (id: string, attrs: { ban_duration?: string }) =>
                    attrs.ban_duration !== undefined && attrs.ban_duration !== "none"
                        ? { data: null, error: { message: "boom" } }
                        : idp.updateUserById(id, attrs));
            const failLift = () =>
                update.mockImplementation(async (id: string, attrs: { ban_duration?: string }) =>
                    attrs.ban_duration === "none"
                        ? { data: null, error: { message: "boom" } }
                        : idp.updateUserById(id, attrs));

            it("is blocked and marked, keeps its data, and the invitation goes", async () => {
                const id = await opened();
                profile({});
                expect((await withdraw(id)).status).toBe(204);
                expect(idp.identities.has(GUEST)).toBe(true);
                expect(banned()).toBe(true);
                expect(ours()).toBe(true);
                expect(idp.canSignIn(GUEST, "a-long-enough-password")).toBe(false);
                expect(h.state!.tables.user_profiles).toHaveLength(1);
                expect(h.state!.tables.platform_invitations).toHaveLength(0);
                const rows = h.state!.tables.audit_events.filter((e) => e.action === "account.blocked");
                expect(rows).toHaveLength(1);
                expect(rows[0].user_id).toBe("u3");
                expect(JSON.stringify(rows[0])).toContain(guest().id);
                expect(JSON.stringify(rows[0])).not.toContain(GUEST);
            });

            it.each([
                ["has accepted the terms", () => profile({ terms_accepted_at: PAST })],
                ["has finished onboarding", () => profile({ onboarding_version: 1 })],
                ["belongs to a firm", () =>
                    h.state!.tables.org_members.push({ id: "m1", org_id: "o1", user_id: guest().id, role: "member" })],
                ["is a platform administrator", () => vi.stubEnv("PLATFORM_ADMIN_EMAILS", `boss@firm.example,${GUEST}`)],
                ["holds another live invitation", () =>
                    h.state!.tables.org_invitations.push({ id: "oi1", org_id: "o1", email: GUEST, status: "pending", expires_at: FUTURE })],
            ])("is left as it is when it %s", async (_name, arrange) => {
                const id = await opened();
                arrange();
                expect((await withdraw(id)).status).toBe(204);
                expect(banned()).toBe(false);
                expect(ours()).toBe(false);
                expect(idp.canSignIn(GUEST, "a-long-enough-password")).toBe(true);
                expect(h.state!.tables.audit_events.filter((e) => e.action === "account.blocked")).toHaveLength(0);
            });

            it("is left as it is when the person registered it and no invitation made it", async () => {
                const id = await opened();
                guest().invitedAt = null;
                expect((await withdraw(id)).status).toBe(204);
                expect(banned()).toBe(false);
                expect(idp.canSignIn(GUEST, "a-long-enough-password")).toBe(true);
            });

            it("is blocked again when it is invited again and that invitation is withdrawn too", async () => {
                expect((await withdraw(await opened())).status).toBe(204);
                expect(banned()).toBe(true);
                const again = await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST });
                expect(again.status).toBe(201);
                expect(banned()).toBe(false);
                expect((await withdraw(again.body.id)).status).toBe(204);
                expect(banned()).toBe(true);
                expect(ours()).toBe(true);
            });

            it("is blocked when the only other invitation has expired", async () => {
                const id = await opened();
                h.state!.tables.org_invitations.push({ id: "oi1", org_id: "o1", email: GUEST, status: "pending", expires_at: PAST });
                expect((await withdraw(id)).status).toBe(204);
                expect(banned()).toBe(true);
            });

            it("is not blocked when the account was never opened: it is removed as before", async () => {
                const id = await invitePlatform();
                expect((await withdraw(id)).status).toBe(204);
                expect(idp.identities.has(GUEST)).toBe(false);
                expect(update.mock.calls.some(([, attrs]) => "ban_duration" in (attrs as object))).toBe(false);
            });

            it("keeps a ban that is not ours exactly as it is", async () => {
                const id = await opened();
                guest().bannedUntil = "2999-01-01T00:00:00.000Z";
                expect((await withdraw(id)).status).toBe(204);
                expect(guest().bannedUntil).toBe("2999-01-01T00:00:00.000Z");
                expect(ours()).toBe(false);
            });

            it("fails, leaving the invitation, when the block cannot be written; a repeat completes", async () => {
                vi.spyOn(console, "warn").mockImplementation(() => {});
                const id = await opened();
                failBlock();
                const failed = await withdraw(id);
                expect(failed.status).toBeGreaterThanOrEqual(500);
                expect(JSON.stringify(failed.body)).not.toContain("boom");
                expect(h.state!.tables.platform_invitations).toHaveLength(1);
                expect(banned()).toBe(false);
                update.mockImplementation(idp.updateUserById);
                expect((await withdraw(id)).status).toBe(204);
                expect(banned()).toBe(true);
                expect(h.state!.tables.platform_invitations).toHaveLength(0);
            });

            it("is blocked before the invitation is removed", async () => {
                const id = await opened();
                let rowsWhenBlocked = -1;
                update.mockImplementation(async (uid: string, attrs: { ban_duration?: string }) => {
                    if (attrs.ban_duration) rowsWhenBlocked = h.state!.tables.platform_invitations.length;
                    return idp.updateUserById(uid, attrs);
                });
                expect((await withdraw(id)).status).toBe(204);
                expect(rowsWhenBlocked).toBe(1);
            });

            describe("when two live invitations for the address are withdrawn at about the same time", () => {
                // Each withdrawal makes its first decision before the other has
                // removed its invitation: both removals wait for each other.
                const interleave = (onBothDecided: () => void = () => {}) => {
                    let arrived = 0;
                    let release: () => void = () => {};
                    const both = new Promise<void>((resolve) => (release = resolve));
                    const db = h.state!.db as { from: (t: string) => Record<string, unknown> };
                    const realFrom = db.from.bind(db);
                    const gate = (builder: Record<string, unknown>): Record<string, unknown> =>
                        new Proxy(builder, {
                            get: (target, key) => {
                                if (key === "then")
                                    return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
                                        if (++arrived === 2) {
                                            onBothDecided();
                                            release();
                                        }
                                        return both.then(() => (target.then as (a: unknown, b: unknown) => unknown)(ok, bad));
                                    };
                                const value = target[key as string];
                                return typeof value === "function"
                                    ? (...args: unknown[]) => {
                                          const next = (value as (...a: unknown[]) => unknown).apply(target, args);
                                          return next === target ? gate(target) : next;
                                      }
                                    : value;
                            },
                        });
                    db.from = (table: string) => {
                        const builder = realFrom(table);
                        const removal = table === "platform_invitations" ? "delete" : table === "org_invitations" ? "update" : null;
                        return !removal
                            ? builder
                            : new Proxy(builder, {
                                  get: (target, key) => {
                                      const value = target[key as string];
                                      if (key !== removal) return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
                                      return (...args: unknown[]) => gate(target[removal] ? ((value as (...a: unknown[]) => Record<string, unknown>).apply(target, args)) : target);
                                  },
                              });
                    };
                };
                const withFirmInvitation = () => {
                    // The in-memory table applies no column defaults: the platform invitation is made live here.
                    Object.assign(h.state!.tables.platform_invitations[0], { status: "pending", expires_at: FUTURE });
                    h.state!.tables.organizations.push({ id: "o1", name: "Firm" });
                    h.state!.tables.org_members.push({ id: "m-u3", org_id: "o1", user_id: "u3", role: "owner" });
                    h.state!.tables.org_invitations.push({ id: "oi1", org_id: "o1", email: GUEST, role: "member", status: "pending", expires_at: FUTURE });
                };
                const withdrawBoth = (id: string) =>
                    Promise.all([withdraw(id), request(app).delete("/orgs/o1/invitations/oi1").set(...AUTH)]);
                const settled = () =>
                    h.state!.tables.platform_invitations.length === 0 &&
                    h.state!.tables.org_invitations.every((r) => r.status !== "pending");

                it("leaves the account blocked and marked, with no live invitation", async () => {
                    const id = await opened();
                    profile({});
                    withFirmInvitation();
                    interleave();
                    const [platform, firm] = await withdrawBoth(id);
                    expect([platform.status, firm.status]).toEqual([204, 204]);
                    expect(settled()).toBe(true);
                    expect(banned()).toBe(true);
                    expect(ours()).toBe(true);
                    expect(h.state!.tables.audit_events.filter((e) => e.action === "account.blocked").length).toBeGreaterThanOrEqual(1);
                });

                it("does not block an account that was finished in between", async () => {
                    const id = await opened();
                    profile({});
                    withFirmInvitation();
                    interleave(() => {
                        (h.state!.tables.user_profiles[0] as Record<string, unknown>).terms_accepted_at = PAST;
                    });
                    const [platform, firm] = await withdrawBoth(id);
                    expect([platform.status, firm.status]).toEqual([204, 204]);
                    expect(settled()).toBe(true);
                    expect(banned()).toBe(false);
                    expect(h.state!.tables.audit_events.filter((e) => e.action === "account.blocked")).toHaveLength(0);
                });

                it("answers a failure, the invitation being gone, when the second look cannot be made", async () => {
                    vi.spyOn(console, "warn").mockImplementation(() => {});
                    const id = await opened();
                    profile({});
                    const db = h.state!.db as { from: (t: string) => Record<string, unknown> };
                    const realFrom = db.from.bind(db);
                    let removed = false;
                    db.from = (table: string) => {
                        // Once the invitation is removed, looking at the account fails.
                        if (table === "user_profiles" && removed) throw new Error("boom");
                        const builder = realFrom(table);
                        return table !== "platform_invitations"
                            ? builder
                            : new Proxy(builder, {
                                  get: (target, key) => {
                                      const value = target[key as string];
                                      if (key === "delete")
                                          return (...a: unknown[]) => {
                                              removed = true;
                                              return (value as (...x: unknown[]) => unknown).apply(target, a);
                                          };
                                      return typeof value === "function" ? (value as (...x: unknown[]) => unknown).bind(target) : value;
                                  },
                              });
                    };
                    const res = await withdraw(id);
                    expect(res.status).toBeGreaterThanOrEqual(500);
                    expect(JSON.stringify(res.body)).not.toContain("boom");
                    expect(h.state!.tables.platform_invitations).toHaveLength(0);
                });
            });

            describe("when the address is invited again", () => {
                it("is let back in, by a platform invitation, when the mark is ours", async () => {
                    const id = await opened();
                    await withdraw(id);
                    expect(banned()).toBe(true);
                    expect((await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST })).status).toBe(201);
                    expect(banned()).toBe(false);
                    expect(ours()).toBe(false);
                    expect(idp.canSignIn(GUEST, "a-long-enough-password")).toBe(true);
                    expect(h.state!.tables.audit_events.filter((e) => e.action === "account.unblocked")).toHaveLength(1);
                });

                it("stays banned when the ban is not ours", async () => {
                    await opened();
                    guest().bannedUntil = "2999-01-01T00:00:00.000Z";
                    expect((await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST })).status).toBe(201);
                    expect(guest().bannedUntil).toBe("2999-01-01T00:00:00.000Z");
                });

                it("fails, leaving the account blocked, when the ban cannot be lifted", async () => {
                    vi.spyOn(console, "warn").mockImplementation(() => {});
                    const id = await opened();
                    await withdraw(id);
                    failLift();
                    const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST });
                    expect(res.status).toBeGreaterThanOrEqual(500);
                    expect(JSON.stringify(res.body)).not.toContain("boom");
                    // The invitation row stays; the account stays blocked.
                    expect(h.state!.tables.platform_invitations).toHaveLength(1);
                    expect(banned()).toBe(true);
                });

                it("stays blocked when the invitation cannot be written", async () => {
                    vi.spyOn(console, "warn").mockImplementation(() => {});
                    const id = await opened();
                    await withdraw(id);
                    const db = h.state!.db as { from: (t: string) => Record<string, unknown> };
                    const realFrom = db.from.bind(db);
                    db.from = (table: string) => {
                        const builder = realFrom(table);
                        return table !== "platform_invitations"
                            ? builder
                            : new Proxy(builder, {
                                  get: (target, key) =>
                                      key === "insert"
                                          ? () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) })
                                          : typeof target[key as string] === "function"
                                            ? (target[key as string] as (...a: unknown[]) => unknown).bind(target)
                                            : target[key as string],
                              });
                    };
                    const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: GUEST });
                    expect(res.status).toBeGreaterThanOrEqual(500);
                    expect(banned()).toBe(true);
                    expect(ours()).toBe(true);
                });
            });
        });
    });

    it("answers /platform/me by mode", async () => {
        expect((await request(app).get("/platform/me").set(...AUTH)).body).toEqual({ admin: false, can_create_org: false });
        as("u3", "boss@firm.example");
        expect((await request(app).get("/platform/me").set(...AUTH)).body).toEqual({ admin: true, can_create_org: true });
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        expect((await request(app).get("/platform/me").set(...AUTH)).body).toEqual({ admin: false, can_create_org: true });
    });

    it("emails a new address through GoTrue and says so", async () => {
        as("u3", "boss@firm.example");
        const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: "new@firm.example" });
        expect(res.body.email_sent).toBe(true);
        expect(invite).toHaveBeenCalledWith("new@firm.example", {
            redirectTo: "http://localhost:3000/auth/set-password",
        });
    });

    it("keeps the invitation and reports email_sent false when sending fails", async () => {
        as("u3", "boss@firm.example");
        invite.mockResolvedValue({ data: null, error: new Error("smtp down") });
        const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: "new@firm.example" });
        expect(res.status).toBe(201);
        expect(res.body.email_sent).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("smtp");
        expect(h.state!.tables.platform_invitations).toHaveLength(1);
    });

    describe("an address whose unconfirmed identity already holds a password", () => {
        const post = () => request(app).post("/platform/invitations").set(...AUTH).send({ email: "new@firm.example" });
        beforeEach(() => as("u3", "boss@firm.example"));

        it("has it replaced before the mail, so the old password never signs in", async () => {
            idp.seed("new@firm.example", { password: "old-password-from-someone" });
            const res = await post();
            expect(res.body.email_sent).toBe(true);
            expect(update).toHaveBeenCalledTimes(1);
            expect(update.mock.invocationCallOrder[0]).toBeLessThan(invite.mock.invocationCallOrder[0]);
            expect(idp.openLink("new@firm.example")).toBe(true);
            expect(idp.canSignIn("new@firm.example", "old-password-from-someone")).toBe(false);
        });

        it("leaves a confirmed identity untouched", async () => {
            idp.seed("new@firm.example", { password: "owners-password", confirmed: true });
            expect((await post()).body.email_sent).toBe(false);
            expect(update).not.toHaveBeenCalled();
            expect(idp.canSignIn("new@firm.example", "owners-password")).toBe(true);
        });

        it("sends no mail when the password cannot be replaced", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            idp.seed("new@firm.example", { password: "old-password-from-someone" });
            update.mockResolvedValue({ data: null, error: { message: "boom" } });
            expect((await post()).body.email_sent).toBe(false);
            expect(idp.mails).toHaveLength(0);
        });
    });

    it("sends nothing to an address that already has an account", async () => {
        as("u3", "boss@firm.example");
        invite.mockResolvedValue({ data: null, error: { code: "email_exists", message: "x" } });
        const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: "old@firm.example" });
        expect(res.status).toBe(201);
        expect(res.body.email_sent).toBe(false);
    });
});
