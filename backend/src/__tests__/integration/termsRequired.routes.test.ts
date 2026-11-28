import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.hoisted(() => {
    process.env.LITT_MCP_SERVER = "enabled";
    process.env.LITT_MCP_PUBLIC_URL = "https://mcp.test.example";
});

// The current Terms are required by the server at every entry: the real
// requireAuth, the real app, a fake identity service and a fake profile store.
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ profile: null as Row | null }));

function fakeDb() {
    return {
        auth: {
            getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.test", email_confirmed_at: "2026-01-01" } }, error: null }),
            mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
        },
        from(table: string) {
            let op = "select";
            let patch: Row = {};
            const mine = table === "user_profiles";
            const q: Record<string, unknown> = {
                select: () => q,
                upsert: (row: Row) => {
                    op = "upsert";
                    if (mine && !h.profile) h.profile = { ...row };
                    return q;
                },
                update: (row: Row) => {
                    op = "update";
                    patch = row;
                    return q;
                },
                insert: () => q,
                eq: () => q,
                in: () => q,
                is: () => q,
                or: () => q,
                order: () => q,
                limit: () => q,
                single: () => Promise.resolve({ data: mine ? h.profile : null, error: null }),
                maybeSingle: () => Promise.resolve({ data: mine ? h.profile : null, error: null }),
                then: (resolve: (value: unknown) => unknown) => {
                    if (op === "update" && mine && h.profile) Object.assign(h.profile, patch);
                    return Promise.resolve({ data: [], error: null }).then(resolve);
                },
            };
            return q;
        },
    };
}
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => fakeDb()) }));
vi.mock("../../lib/userLookup", () => ({ syncProfileEmail: vi.fn(async () => null) }));
vi.mock("../../lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

import { app } from "../../app";
import { LEGAL_VERSION } from "../../modules/user/user.service";

const AUTH = ["Authorization", "Bearer test"] as const;
const ID = "00000000-0000-4000-8000-000000000001";
const CODE = "terms_acceptance_required";

const REQUESTS: Array<[family: string, method: "get" | "post" | "put" | "delete" | "patch", path: string]> = [
    ["chat read", "get", "/chat"],
    ["chat write", "post", "/chat/create"],
    ["documents read", "get", `/single-documents/${ID}`],
    ["documents write", "delete", `/single-documents/${ID}`],
    ["uploads write", "post", "/upload-sessions"],
    ["projects read", "get", "/projects"],
    ["projects write", "post", "/projects"],
    ["tabular read", "get", "/tabular-review"],
    ["tabular write", "post", "/tabular-review"],
    ["organizations read", "get", `/orgs/${ID}/members`],
    ["organizations member change", "patch", `/orgs/${ID}/members/${ID}`],
    ["settings read", "get", "/user/api-keys"],
    ["settings write", "put", "/user/custom-instructions"],
    ["playbooks read", "get", "/playbooks"],
    ["playbooks write", "post", "/playbooks"],
    ["workflows read", "get", "/workflows"],
    ["workflows write", "post", "/workflows"],
    ["connected-application approval", "get", `/mcp-connect/authorizations/${ID}`],
    ["streaming route", "get", `/chat/${ID}/turn/${ID}/stream`],
];

const send = (method: string, path: string) =>
    (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(...AUTH).send({});

const PROFILES: Array<[string, Row | null]> = [
    ["no accepted version", { user_id: "u1", terms_accepted_version: null }],
    ["an older version", { user_id: "u1", terms_accepted_version: "2020-01-01" }],
    ["no profile row", null],
];

beforeEach(() => {
    h.profile = null;
});

describe("the current Terms are required by the server", () => {
    describe.each(PROFILES)("for a person with %s", (_label, row) => {
        beforeEach(() => {
            h.profile = row && { ...row };
        });
        it.each(REQUESTS)("refuses %s with the code", async (_family, method, path) => {
            const res = await send(method, path);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe(CODE);
            expect(res.body.detail).toBe("Accept the current Terms in LiTT on the web to continue.");
        });
    });

    it.each(REQUESTS)("does not refuse %s for a person on the current version", async (_family, method, path) => {
        h.profile = { user_id: "u1", terms_accepted_version: LEGAL_VERSION };
        const res = await send(method, path);
        expect(res.body?.code).not.toBe(CODE);
    });

    it("still answers the routes a person needs to read and accept the Terms", async () => {
        h.profile = { user_id: "u1", terms_accepted_version: null };
        const profile = await send("get", "/user/profile");
        expect(profile.status).toBe(200);
        expect(profile.body.termsRequired).toBe(true);
        expect((await send("post", "/user/terms-acceptance")).status).toBe(409);
        for (const [method, path] of [
            ["get", "/auth/session"],
            ["get", "/auth/mfa/factors"],
            ["post", "/auth/mfa/verify"],
            ["patch", "/auth/password"],
            ["delete", "/user/account"],
            ["post", "/user/exports"],
            ["get", `/user/exports/${ID}`],
            ["get", `/user/exports/${ID}/download`],
        ]) {
            const res = await send(method, path);
            expect(res.body?.code, `${method} ${path}`).not.toBe(CODE);
        }
    });

    it("lets the next request through once the current Terms are accepted", async () => {
        h.profile = { user_id: "u1", terms_accepted_version: null };
        expect((await send("get", "/projects")).body.code).toBe(CODE);
        const accepted = await request(app).post("/user/terms-acceptance").set(...AUTH).send({ version: LEGAL_VERSION });
        expect(accepted.status).toBe(200);
        expect((await send("get", "/projects")).body?.code).not.toBe(CODE);
    });
});
