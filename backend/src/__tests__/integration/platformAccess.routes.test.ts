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
    signUpWithPassword: vi.fn(async () => ({
        data: { user: { id: "new", email: "x@firm.example" }, session: null },
        error: null,
    })),
}));

const invite = vi.hoisted(() => vi.fn());
import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const AUTH = ["Authorization", "Bearer test"] as const;
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const signup = (email: string) =>
    request(app).post("/auth/signup").set("Origin", "http://localhost:3000").send({ email, password: "a-long-enough-password" });
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
    invite.mockReset().mockResolvedValue({ data: {}, error: null });
    (h.state.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite } };
    as("u1", "u1@test.local");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", " Boss@Firm.example , other@firm.example");
});
afterEach(() => vi.unstubAllEnvs());

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

    it("sends nothing to an address that already has an account", async () => {
        as("u3", "boss@firm.example");
        invite.mockResolvedValue({ data: null, error: { code: "email_exists", message: "x" } });
        const res = await request(app).post("/platform/invitations").set(...AUTH).send({ email: "old@firm.example" });
        expect(res.status).toBe(201);
        expect(res.body.email_sent).toBe(false);
    });
});
