import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// The Terms gate over HTTP: only the current LEGAL_VERSION is recorded.
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ profiles: [] as Row[], audits: [] as Row[] }));

// A minimal user_profiles / audit_events store: just what these routes call.
function fakeDb() {
    return {
        from(table: string) {
            let op = "select";
            let patch: Row = {};
            const q: Record<string, unknown> = {
                select: () => q,
                upsert: (row: Row) => {
                    op = "upsert";
                    if (!h.profiles.length) h.profiles.push({ ...row });
                    return q;
                },
                update: (row: Row) => {
                    op = "update";
                    patch = row;
                    return q;
                },
                insert: (row: Row) => {
                    h.audits.push(row);
                    return q;
                },
                eq: () => q,
                order: () => q,
                single: () => Promise.resolve({ data: h.profiles[0], error: null }),
                maybeSingle: () => Promise.resolve({ data: h.profiles[0] ?? null, error: null }),
                then: (resolve: (value: unknown) => unknown) => {
                    if (op === "update") Object.assign(h.profiles[0], patch);
                    return Promise.resolve({ data: table === "user_router_models" ? [] : null, error: null }).then(resolve);
                },
            };
            return q;
        },
    };
}
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => fakeDb()) }));
vi.mock("../../lib/audit", () => ({
    recordAudit: vi.fn(async (_db: unknown, event: Row) => void h.audits.push(event)),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    return authMock();
});

import { app } from "../../app";
import { LEGAL_VERSION } from "../../modules/user/user.profile.storage";

const AUTH = ["Authorization", "Bearer test"] as const;
const accept = (version: string) =>
    request(app).post("/user/terms-acceptance").set(...AUTH).send({ version });

beforeEach(() => {
    h.profiles.length = 0;
    h.audits.length = 0;
    h.profiles.push({ user_id: "u1", display_name: null, organisation: null, message_credits_used: 0, credits_reset_date: "2999-01-01", tier: "Free", mfa_on_login: false, quick_actions_visible: true, theme: "system", project_memory_default: true, terms_accepted_version: null });
});

describe("POST /user/terms-acceptance", () => {
    it("records the current version, audits it and clears termsRequired", async () => {
        const before = await request(app).get("/user/profile").set(...AUTH);
        expect(before.body.termsRequired).toBe(true);

        const res = await accept(LEGAL_VERSION);
        expect(res.status).toBe(200);
        expect(res.body.termsRequired).toBe(false);
        expect(h.profiles[0].terms_accepted_version).toBe(LEGAL_VERSION);
        expect(h.audits).toContainEqual(
            expect.objectContaining({ action: "user.terms_accepted", detail: { version: LEGAL_VERSION } }),
        );
    });

    it("answers 409 terms_version_mismatch for any other version", async () => {
        const res = await accept("2020-01-01");
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("terms_version_mismatch");
        expect(h.profiles[0].terms_accepted_version).toBeNull();
    });
});
