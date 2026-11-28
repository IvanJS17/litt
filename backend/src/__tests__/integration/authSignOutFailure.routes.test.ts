import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// A sign-out that the identity service refuses is not reported as done. The
// cookies of this browser and the stamp that ends connected applications are
// still handled first; then, when other sessions may still be open, the answer
// is a failure. Real auth routes; stand-ins for the identity client, the cookie
// clearing and the stamp.
const h = vi.hoisted(() => ({
    order: [] as string[],
    revokeError: null as unknown,
}));

vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({})) }));
vi.mock("../../modules/mcp/mcp.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/mcp/mcp.service")>()),
    markSessionsEnded: vi.fn(async () => {
        h.order.push("stamp");
    }),
}));
const fakeAuthClient = () => ({
    auth: {
        getUser: async () => ({ data: { user: { id: "user-1", email: "ana@firm.example" } }, error: null }),
        signOut: async ({ scope }: { scope: string }) => {
            h.order.push(`signOut:${scope}`);
            return { error: h.revokeError };
        },
        updateUser: async () => ({ data: { user: { id: "user-1", email: "ana@firm.example" } }, error: null }),
    },
});
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createRequestSupabase: vi.fn(() => fakeAuthClient()),
    clearRequestAuthCookies: vi.fn((_req: unknown, res: { append: (k: string, v: string) => void }) => {
        h.order.push("cookies");
        res.append("Set-Cookie", "mike-session=; Path=/; Max-Age=0");
    }),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = "user-1";
                res.locals.userEmail = "ana@firm.example";
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = "web-session-token";
                res.locals.authSource = "cookie";
                res.locals.authClient = fakeAuthClient();
                next();
            }),
    };
});

import { app } from "../../app";

const WEB = "http://localhost:3000";
const unavailable = Object.assign(new Error("secret upstream text"), {
    __isAuthError: true,
    name: "AuthRetryableFetchError",
    status: 503,
});
const logout = (scope: string) => request(app).post("/auth/logout").set("Origin", WEB).send({ scope });
const recovery = () =>
    request(app).patch("/auth/password").set("Origin", WEB).send({ password: "Correct-Horse-Battery-9", signOut: true });

beforeEach(() => {
    h.order.length = 0;
    h.revokeError = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signing out everywhere", () => {
    it("answers as always when the identity service ends the sessions", async () => {
        const res = await logout("global");
        expect(res.status).toBe(204);
        expect(h.order).toEqual(["signOut:global", "stamp", "cookies"]);
    });

    it("answers a failure, after clearing the cookies and stamping, when the identity service refuses", async () => {
        h.revokeError = unavailable;
        const res = await logout("global");
        expect(res.status).toBe(503);
        expect(JSON.stringify(res.body)).not.toContain("secret upstream text");
        expect(String(res.headers["set-cookie"])).toContain("mike-session=;");
        expect(h.order).toEqual(["signOut:global", "stamp", "cookies"]);
    });
});

describe("signing out of this browser only", () => {
    it("answers success when the cookies were cleared even though the identity service refuses", async () => {
        h.revokeError = unavailable;
        const res = await logout("local");
        expect(res.status).toBe(204);
        expect(String(res.headers["set-cookie"])).toContain("mike-session=;");
    });
});

describe("changing the password with the sign-out option", () => {
    it("reports the failure, with the cookies cleared and the stamp written, when the identity service refuses", async () => {
        h.revokeError = unavailable;
        const res = await recovery();
        expect(res.status).toBe(503);
        expect(JSON.stringify(res.body)).not.toContain("secret upstream text");
        expect(String(res.headers["set-cookie"])).toContain("mike-session=;");
        expect(h.order).toContain("stamp");
    });

    it("answers as always when the identity service ends the sessions", async () => {
        expect((await recovery()).status).toBe(200);
    });
});
