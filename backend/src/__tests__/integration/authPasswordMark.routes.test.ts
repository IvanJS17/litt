import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// PATCH /auth/password: a password set through LiTT (the invitation's password
// step, a recovery, or Settings) records that the account has a password. The
// record is best effort: the password is already changed, so a failure to
// write it changes nothing in the answer and is reported once, without the
// address. Real auth routes and user module, in-memory database, a stand-in
// for the auth service's client.
const h = vi.hoisted(() => ({
    caller: { id: "user-1", email: "ana@firm.example" },
    state: null as null | {
        db: unknown;
        tables: Record<string, Row[]>;
        failNext: (table: string, op: string, error: unknown) => void;
    },
    order: [] as string[],
    marked: [] as unknown[],
    markResult: "2026-11-27T00:00:00.000Z" as string | null,
    updateError: null as unknown,
    reported: [] as unknown[][],
}));

// The in-memory database has no upsert: the profile row is ensured here.
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
vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError: vi.fn((...args: unknown[]) => {
        h.reported.push(args);
        return "event-1";
    }),
}));
vi.mock("../../modules/mcp/mcp.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/mcp/mcp.service")>()),
    markSessionsEnded: vi.fn(async () => {
        h.order.push("sessionsEnded");
    }),
}));
const fakeAuthClient = () => ({
    auth: {
        getUser: async () => ({ data: { user: { id: h.caller.id, email: h.caller.email } }, error: null }),
        signOut: async ({ scope }: { scope: string }) => {
            h.order.push(`signOut:${scope}`);
            return { error: null };
        },
        updateUser: async () => {
            h.order.push("updateUser");
            if (h.updateError) return { data: { user: null }, error: h.updateError };
            return { data: { user: { id: h.caller.id, email: h.caller.email } }, error: null };
        },
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
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.caller.id;
                res.locals.userEmail = h.caller.email;
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = "web-session-token";
                res.locals.authSource = "cookie";
                res.locals.authClient = fakeAuthClient();
                next();
            }),
    };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const WEB = "http://localhost:3000";
const PASSWORD = "Correct-Horse-Battery-9";
const SESSION_COOKIE = "mike-session=stale";

beforeEach(() => {
    h.order.length = 0;
    h.marked.length = 0;
    h.reported.length = 0;
    h.markResult = "2026-11-27T00:00:00.000Z";
    h.updateError = null;
    h.state = memoryDb(
        { user_profiles: [{ user_id: h.caller.id }], user_api_keys: [] },
        {
            sync_user_password_set: (args) => {
                h.order.push("mark");
                h.marked.push(args);
                return h.markResult;
            },
        },
    );
});

const change = (body: unknown = { password: PASSWORD }) =>
    request(app).patch("/auth/password").set("Origin", WEB).set("Cookie", SESSION_COOKIE).send(body as object);
/** The whole answer: status, body and the cookies set. */
const whole = (answer: request.Response) => ({
    status: answer.status,
    body: answer.body,
    cookies: answer.headers["set-cookie"] ?? null,
});

describe("PATCH /auth/password records that the account has a password", () => {
    it("records it once for the signed-in account after a successful change", async () => {
        const answer = await change();
        expect(answer.status).toBe(200);
        expect(h.marked).toEqual([{ p_user_id: h.caller.id }]);
        expect(h.order).toEqual(["updateUser", "mark"]);
        expect(h.reported).toHaveLength(0);
    });

    it("records it with the sign-out option too, before the sessions end, and the sign-out is unchanged", async () => {
        const answer = await change({ password: PASSWORD, signOut: true });
        expect(answer.status).toBe(200);
        expect(h.marked).toEqual([{ p_user_id: h.caller.id }]);
        expect(h.order).toEqual(["updateUser", "mark", "signOut:global", "sessionsEnded"]);
        expect(String(answer.headers["set-cookie"])).toContain("mike-session=;");
    });

    it.each([
        ["the database fails", () => h.state!.failNext("sync_user_password_set", "rpc", { message: "database unavailable ana@firm.example" })],
        ["the database records nothing", () => { h.markResult = null; }],
    ])("answers exactly as for a success and reports once, without the address, when %s", async (_name, arrange) => {
        for (const body of [{ password: PASSWORD }, { password: PASSWORD, signOut: true }]) {
            h.reported.length = 0;
            const reference = whole(await change(body));
            expect(h.reported).toHaveLength(0);

            arrange();
            const answer = whole(await change(body));
            expect(answer).toEqual(reference);
            expect(answer.status).toBe(200);
            expect(h.reported).toHaveLength(1);
            expect(h.reported[0]![1]).toMatchObject({ level: "warning" });
            const text = inspect(h.reported, { depth: 8 });
            expect(text).not.toContain("ana@");
            expect(text).not.toContain("firm.example");
            h.markResult = "2026-11-27T00:00:00.000Z";
        }
    });

    it("records nothing when the auth service refuses the change", async () => {
        h.updateError = Object.assign(new Error("weak"), { __isAuthError: true, name: "AuthWeakPasswordError", status: 422 });
        const answer = await change();
        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(h.order).toEqual(["updateUser"]);
        expect(h.marked).toEqual([]);
        expect(h.reported).toHaveLength(0);
    });

    it.each([[{ password: "short" }], [{}], [{ password: PASSWORD, signOut: "yes" }]])(
        "records nothing for an invalid body %j",
        async (body) => {
            const answer = await change(body);
            expect(answer.status).toBe(400);
            expect(h.order).toEqual([]);
            expect(h.marked).toEqual([]);
        },
    );
});
