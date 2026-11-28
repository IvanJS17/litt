import { AuthApiError } from "@supabase/supabase-js";
import type express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Password sign-in is refused ("too many attempts") after repeated refused
// credentials for an address. A person who proves control of the mailbox, by
// setting a new password through the emailed link, is not left locked out: the
// refusals counted against their address are cleared. Real app, real auth
// router and real limiters (small limits); stand-ins for the auth service's
// client and the session middleware.
const h = vi.hoisted(() => ({
    session: null as null | { id: string; email: string; amr: { method: string; timestamp: number }[] },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
    refuseNewPassword: false,
}));

vi.mock("../../lib/log", () => ({ devLog: vi.fn(), isDev: false }));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => {
        const db = h.state!.db as { from: (table: string) => Record<string, unknown> };
        return {
            ...db,
            from: (table: string) => ({
                ...db.from(table),
                upsert: async (row: Row) => {
                    const rows = h.state!.tables[table];
                    if (!rows.some((r) => r.user_id === row.user_id)) rows.push(row);
                    return { error: null };
                },
            }),
        };
    }),
}));
vi.mock("../../modules/mcp/mcp.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/mcp/mcp.service")>()),
    markSessionsEnded: vi.fn(async () => undefined),
}));

const CORRECT = "Correct-Horse-Battery-9";
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenFor = (s: NonNullable<typeof h.session>) =>
    `${part({ alg: "HS256" })}.${part({ sub: s.id, amr: s.amr })}.sig`;

const fakeAuthClient = () => ({
    auth: {
        signInWithPassword: async ({ password }: { password: string }) => {
            if (password === CORRECT) {
                const user = { id: "u-login", email: "x@example.test", app_metadata: {}, user_metadata: {} };
                return { data: { user, session: { access_token: "a", refresh_token: "r" } }, error: null };
            }
            return {
                data: { user: null, session: null },
                error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
            };
        },
        signOut: async () => ({ error: null }),
        updateUser: async () =>
            h.refuseNewPassword
                ? { data: { user: null }, error: new AuthApiError("New password should be different", 422, "same_password") }
                : { data: { user: { id: h.session!.id, email: h.session!.email } }, error: null },
    },
});
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createRequestSupabase: vi.fn(() => fakeAuthClient()),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (
            req: unknown,
            res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } },
            next: () => void,
        ) => {
            if (!h.session) {
                res.status(401).json({ detail: "Invalid or expired session" });
                return;
            }
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.session!.id;
                res.locals.userEmail = h.session!.email;
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = tokenFor(h.session!);
                res.locals.authSource = "cookie";
                res.locals.authClient = fakeAuthClient();
                next();
            });
        },
    };
});

import { memoryDb } from "../helpers/memoryDb";

let app: express.Express;
beforeAll(async () => {
    vi.stubEnv("RATE_LIMIT_AUTH_LOGIN_MAX", "10000");
    vi.stubEnv("RATE_LIMIT_AUTH_ACCOUNT_MAX", "3");
    vi.stubEnv("RATE_LIMIT_AUTH_ACCOUNT_GLOBAL_MAX", "5");
    app = (await import("../../app.js")).app;
});
afterAll(() => {
    vi.unstubAllEnvs();
});

const WEB = "http://localhost:3000";
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
    h.session = null;
    h.refuseNewPassword = false;
    h.state = memoryDb(
        { user_profiles: [{ user_id: "u-owner" }, { user_id: "u-other" }], user_api_keys: [] },
        { sync_user_password_set: () => "2026-11-27T00:00:00.000Z" },
    );
});

const login = (email: string, password: string, client: string) =>
    request(app).post("/auth/login").set("Origin", WEB).set("X-Forwarded-For", client).send({ email, password });
const setPassword = (client: string, body: object = { password: CORRECT, signOut: true }) =>
    request(app).patch("/auth/password").set("Origin", WEB).set("X-Forwarded-For", client).set("Cookie", "mike-session=x").send(body);
// The auth service records a sign-in by an emailed link as `otp` (a link that
// is exchanged as a code, as `recovery`).
const recoverySession = (email: string, id = "u-owner", method = "otp") => {
    h.session = { id, email, amr: [{ method, timestamp: now() }] };
};
const refuseThreeTimes = async (email: string, client: string) => {
    for (let i = 0; i < 3; i++) expect((await login(email, "wrong-password-1", client)).status).toBe(400);
    const refused = await login(email, CORRECT, client);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("rate_limited");
};

describe("a password set through the emailed link clears the sign-in refusals for that address", () => {
    it("lets the next sign-in with the right password through", async () => {
        const email = "cleared@example.test";
        await refuseThreeTimes(email, "198.51.100.1");
        recoverySession(email);
        expect((await setPassword("198.51.100.1")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.1")).status).toBe(200);
    });

    it("clears the across-clients lane too, for a client that was not the one refused", async () => {
        const email = "spread@example.test";
        for (const [client, n] of [["198.51.100.10", 3], ["198.51.100.11", 2]] as const) {
            for (let i = 0; i < n; i++) expect((await login(email, "wrong-password-1", client)).status).toBe(400);
        }
        expect((await login(email, CORRECT, "198.51.100.12")).status).toBe(429);
        recoverySession(email);
        expect((await setPassword("198.51.100.12", { password: CORRECT })).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.12")).status).toBe(200);
    });

    it("clears for a link that was exchanged as a code", async () => {
        const email = "exchanged@example.test";
        await refuseThreeTimes(email, "198.51.100.6");
        recoverySession(email, "u-owner", "recovery");
        expect((await setPassword("198.51.100.6")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.6")).status).toBe(200);
    });

    it("does not clear for a password session that also passed a second factor", async () => {
        const email = "secondfactor@example.test";
        await refuseThreeTimes(email, "198.51.100.7");
        h.session = {
            id: "u-owner",
            email,
            amr: [{ method: "password", timestamp: now() }, { method: "totp", timestamp: now() }],
        };
        expect((await setPassword("198.51.100.7")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.7")).status).toBe(429);
    });

    it("does not clear for a sign-in record dated in the future", async () => {
        const email = "future@example.test";
        await refuseThreeTimes(email, "198.51.100.8");
        h.session = { id: "u-owner", email, amr: [{ method: "otp", timestamp: now() + 3600 }] };
        expect((await setPassword("198.51.100.8")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.8")).status).toBe(429);
    });

    it("does not clear when the new password is refused", async () => {
        const email = "refused@example.test";
        await refuseThreeTimes(email, "198.51.100.9");
        recoverySession(email);
        h.refuseNewPassword = true;
        expect((await setPassword("198.51.100.9")).status).toBeGreaterThanOrEqual(400);
        expect((await login(email, CORRECT, "198.51.100.9")).status).toBe(429);
    });

    it("does not clear when the password is changed in an ordinary signed-in session", async () => {
        const email = "ordinary@example.test";
        await refuseThreeTimes(email, "198.51.100.2");
        h.session = { id: "u-owner", email, amr: [{ method: "password", timestamp: now() }] };
        expect((await setPassword("198.51.100.2")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.2")).status).toBe(429);
    });

    it("does not clear when the emailed-link sign-in is old", async () => {
        const email = "stale@example.test";
        await refuseThreeTimes(email, "198.51.100.3");
        h.session = { id: "u-owner", email, amr: [{ method: "recovery", timestamp: now() - 3 * 3600 }] };
        expect((await setPassword("198.51.100.3")).status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.3")).status).toBe(429);
    });

    it("clears only the session's own address, whatever the body carries", async () => {
        const email = "locked@example.test";
        await refuseThreeTimes(email, "198.51.100.4");
        recoverySession("someone-else@example.test", "u-other");
        const answer = await setPassword("198.51.100.4", { password: CORRECT, email, userId: "u-owner" });
        expect(answer.status).toBe(200);
        expect((await login(email, CORRECT, "198.51.100.4")).status).toBe(429);
    });

    it("cannot be reached without a session", async () => {
        const email = "nosession@example.test";
        await refuseThreeTimes(email, "198.51.100.5");
        const answer = await setPassword("198.51.100.5", { password: CORRECT, email });
        expect(answer.status).toBe(401);
        expect((await login(email, CORRECT, "198.51.100.5")).status).toBe(429);
    });
});
