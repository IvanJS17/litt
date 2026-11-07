import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// HTTP mapping of training layer 2; the rule is covered against PostgreSQL in
// src/__tests__/sql/performance.litt-training-supervision.sql.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => ({ rpc })),
}));
// The caller is a real uuid: the pupil's id is checked like any other.
const USER = "00000000-0000-4000-8000-000000000001";
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = USER;
                next();
            }),
    };
});

import { app } from "../../app";

const ORG = "00000000-0000-4000-8000-000000000100";

describe("GET /training/me/supervision", () => {
    beforeEach(() => {
        rpc.mockReset();
        rpc.mockImplementation(async (_fn: string, args: { p_org: string }) => ({
            data: args.p_org === ORG,
            error: null,
        }));
    });

    it("returns the caller's supervision in an organization they belong to", async () => {
        const res = await request(app).get(`/training/me/supervision?org_id=${ORG}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ org_id: ORG, work_reviews: [], defenses: [], urgency_passes: [] });
        expect(rpc).toHaveBeenCalledWith("training_can_read_learning", {
            p_actor: USER, p_org: ORG, p_trainee: USER,
        });
    });

    it("answers one 404 body to another organization, a malformed id and no id", async () => {
        const bodies = [];
        for (const query of [`?org_id=00000000-0000-4000-8000-000000000999`, "?org_id=x", ""]) {
            const res = await request(app).get(`/training/me/supervision${query}`);
            expect(res.status).toBe(404);
            bodies.push(res.body);
        }
        expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    });

    it("hides a database failure behind a generic 500", async () => {
        rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret detail" } });
        const res = await request(app).get(`/training/me/supervision?org_id=${ORG}`);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("secret detail");
    });
});
