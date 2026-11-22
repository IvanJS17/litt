import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Invite-only beta over HTTP: who may register, who may create an
// organization, and who may manage platform invitations. Every rule compares
// the normalized email and nothing else.
const h = vi.hoisted(() => ({
    caller: { id: "u1", email: "u1@test.local" },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
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
import { fakeIdentityService } from "../helpers/fakeIdentityService";

const idp = fakeIdentityService();

const invite = vi.fn();
const update = vi.fn();
const AUTH = ["Authorization", "Bearer test"] as const;
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
// Each call comes from its own address so the per-address sign-up limiter stays out of the way.
let caller = 0;
const signup = (email: string, password = "a-long-enough-password") =>
    request(app).post("/auth/signup").set("Origin", "http://localhost:3000").set("X-Forwarded-For", `198.51.100.${++caller}`).send({ email, password });
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
    };
    h.state = memoryDb(tables);
    idp.reset();
    invite.mockReset().mockImplementation(idp.invite);
    update.mockReset().mockImplementation(idp.updateUserById);
    (h.state.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite, updateUserById: update } };
    vi.stubEnv("SUPABASE_URL", "http://identity.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", vi.fn(idp.fetch));
    as("u1", "u1@test.local");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", " Boss@Firm.example , other@firm.example");
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("POST /auth/signup in beta mode", () => {
    it("refuses an email with no invitation", async () => {
        const res = await signup("stranger@firm.example");
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("signup_invite_only");
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

    it("refuses an expired invitation", async () => {
        h.state!.tables.platform_invitations.push({ email: "late@firm.example", status: "pending", expires_at: PAST });
        h.state!.tables.org_invitations.push({ email: "late@firm.example", status: "pending", expires_at: PAST });
        expect((await signup("late@firm.example")).status).toBe(403);
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
        idp.minutesAgo(email, 11);
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

    it("says so when the invitation mail cannot be sent", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        invite.mockResolvedValue({ data: {}, error: { code: "over_email_send_rate_limit", status: 429, message: "rate limit" } });
        h.state!.tables.platform_invitations.push({ id: "pi-0", email: GUEST, status: "pending", expires_at: FUTURE });
        const res = await signup(GUEST, ATTACKER);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(idp.identities.size).toBe(0);
    });

    it("mails nothing when the old password cannot be replaced", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        idp.seed(GUEST, { password: ATTACKER });
        update.mockResolvedValue({ data: null, error: { message: "boom" } });
        admitGuest();
        expect((await signup(GUEST, OWNER)).status).toBeGreaterThanOrEqual(400);
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

        it("sends a new mail once the window has passed", async () => {
            admitGuest();
            await signup(GUEST, ATTACKER);
            idp.minutesAgo(GUEST, 11);
            const again = await signup(GUEST, ATTACKER);
            expect(again.status).toBe(201);
            expect(idp.mails).toHaveLength(2);
        });
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
