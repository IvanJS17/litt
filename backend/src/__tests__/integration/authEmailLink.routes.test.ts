import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// POST /auth/verify-otp: an emailed sign-up value opens a session only for an
// account that registered itself. An account an invitation created has its own
// door, so its value is refused here as a wrong one is. In invitation-only mode
// the sign-up type is refused before the identity service is asked. Real auth
// routes, the fake identity service, a stand-in for the cookie-bearing client.
const h = vi.hoisted(() => ({
    verified: [] as unknown[],
    signedOut: [] as unknown[],
    applied: [] as unknown[],
    reported: [] as unknown[][],
    signOutError: null as unknown,
    verify: null as unknown as (hash: string, type: string) => unknown,
}));

vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError: vi.fn((...args: unknown[]) => {
        h.reported.push(args);
        return "event-1";
    }),
}));
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createCookielessSupabase: vi.fn(() => ({
        auth: {
            verifyOtp: async (args: { token_hash: string; type: string }) => {
                h.verified.push(args);
                return h.verify(args.token_hash, args.type);
            },
            signOut: async (args: unknown) => {
                h.signedOut.push(args);
                return { error: h.signOutError };
            },
        },
    })),
    createRequestSupabase: vi.fn((_req: unknown, res: { append: (k: string, v: string) => void }) => ({
        auth: {
            getUser: async () => ({
                data: { user: null },
                error: { __isAuthError: true, name: "AuthSessionMissingError", status: 400, message: "no session" },
            }),
            setSession: async (tokens: { access_token: string }) => {
                h.applied.push(tokens);
                res.append("Set-Cookie", "mike-session=signed-in; Path=/; HttpOnly");
                return { data: { user: { id: "u", email: "a@firm.example" }, session: tokens }, error: null };
            },
        },
    })),
    clearRequestAuthCookies: vi.fn((_req: unknown, res: { append: (k: string, v: string) => void }) => {
        res.append("Set-Cookie", "mike-session=; Path=/; Max-Age=0");
    }),
}));

import { app } from "../../app";
import { fakeIdentityService } from "../helpers/fakeIdentityService";

const WEB = "http://localhost:3000";
const fake = fakeIdentityService();

const confirm = (token_hash: string, type = "signup") =>
    request(app).post("/auth/verify-otp").set("Origin", WEB).send({ token_hash, type });
/** What the person is answered and which cookies were set: the whole visible outcome. */
const outcome = (res: request.Response) => ({ status: res.status, body: res.body, cookies: res.headers["set-cookie"] });
const signedIn = (res: request.Response) => String(res.headers["set-cookie"] ?? "").includes("signed-in");

beforeEach(() => {
    fake.reset();
    h.verified.length = 0;
    h.signedOut.length = 0;
    h.applied.length = 0;
    h.reported.length = 0;
    h.signOutError = null;
    h.verify = (hash, type) => fake.verifyToken(hash, type);
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
});

describe("the emailed sign-up value", () => {
    it("opens a session for an account that registered itself", async () => {
        fake.seed("ana@firm.example", { token: "signup-value" });
        const res = await confirm("signup-value");
        expect(res.status).toBe(200);
        expect(signedIn(res)).toBe(true);
        expect(h.signedOut).toEqual([]);
    });

    it("is answered as a wrong value is, with no session, for an account an invitation created", async () => {
        const wrong = await confirm("no-such-value");
        expect(wrong.status).toBeGreaterThanOrEqual(400);
        await fake.invite("ben@firm.example");
        const res = await confirm(fake.identities.get("ben@firm.example")!.token!);
        expect(outcome(res)).toEqual(outcome(wrong));
        expect(signedIn(res)).toBe(false);
        expect(h.applied).toEqual([]);
    });

    it("ends the session the identity service issued for it", async () => {
        await fake.invite("ben@firm.example");
        await confirm(fake.identities.get("ben@firm.example")!.token!);
        expect(h.signedOut).toEqual([{ scope: "local" }]);
    });

    it("answers the same, and reports one warning, when the identity service refuses to end the issued session", async () => {
        const wrong = await confirm("no-such-value");
        await fake.invite("ben@firm.example");
        h.signOutError = { __isAuthError: true, name: "AuthRetryableFetchError", status: 503, message: "secret upstream text" };
        const res = await confirm(fake.identities.get("ben@firm.example")!.token!);
        expect(outcome(res)).toEqual(outcome(wrong));
        expect(signedIn(res)).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("secret upstream text");
        expect(h.reported).toHaveLength(1);
        const [failure, context] = h.reported[0] as [{ kind: string; cause: unknown }, { level?: string }];
        expect(failure.kind).toBe("auth.supabase_unavailable");
        expect(failure.cause).toBe(h.signOutError);
        expect(context.level).toBe("warning");
    });

    it("still opens a session for an invited account that had confirmed its address earlier", async () => {
        fake.seed("cy@firm.example", {
            token: "signup-value",
            invitedAt: "2026-01-01T00:00:00.000Z",
            confirmed: true,
            confirmedAt: "2026-01-02T00:00:00.000Z",
        });
        expect((await confirm("signup-value")).status).toBe(200);
    });

    it("is refused before the identity service is asked in invitation-only mode", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "owner@firm.example");
        fake.seed("ana@firm.example", { token: "signup-value" });
        const wrong = await confirm("no-such-value", "email_change");
        const res = await confirm("signup-value");
        expect(h.verified).toEqual([{ token_hash: "no-such-value", type: "email_change" }]);
        expect(res.status).toBe(wrong.status);
        expect(res.body).toEqual(wrong.body);
        expect(signedIn(res)).toBe(false);
    });
});

describe("the other emailed values", () => {
    it("a recovery value still opens a session, in invitation-only mode too", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "owner@firm.example");
        fake.seed("ben@firm.example", { confirmed: true, password: "old-password" });
        fake.issueRecovery("ben@firm.example");
        const res = await confirm(fake.identities.get("ben@firm.example")!.token!, "recovery");
        expect(res.status).toBe(200);
        expect(signedIn(res)).toBe(true);
        expect(h.signedOut).toEqual([]);
    });

    it("an invitation's value under the recovery type is answered as a wrong value", async () => {
        const wrong = await confirm("no-such-value", "recovery");
        await fake.invite("ben@firm.example");
        const res = await confirm(fake.identities.get("ben@firm.example")!.token!, "recovery");
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(outcome(res)).toEqual(outcome(wrong));
        expect(signedIn(res)).toBe(false);
    });
});
