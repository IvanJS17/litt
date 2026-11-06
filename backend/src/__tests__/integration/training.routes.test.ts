import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { memoryDb as MemoryDb } from "../helpers/memoryDb";

// HTTP mapping of the training module; the rules themselves are covered in
// modules/training/training.service.test.ts.
const { holder } = vi.hoisted(() => ({
    holder: { state: null as ReturnType<typeof MemoryDb> | null },
}));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => holder.state!.db),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    return authMock();
});
vi.mock("../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/audit")>()),
    recordAudit: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { TEST_USER_ID } from "../helpers/authMock";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const MENTOR2 = id(4);
const PUPIL = id(5);

function seed(role: "owner" | "member", mentor = true) {
    holder.state = memoryDb({
        organizations: [{ id: ORG, kind: "team", deleted_at: null }],
        org_members: [
            { org_id: ORG, user_id: TEST_USER_ID, role },
            { org_id: ORG, user_id: MENTOR2, role: "member" },
            { org_id: ORG, user_id: PUPIL, role: "member" },
        ],
        training_mentors: [
            ...(mentor ? [{ org_id: ORG, user_id: TEST_USER_ID }] : []),
            { org_id: ORG, user_id: MENTOR2 },
        ],
        training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR2 }],
        training_stages: [],
    });
}

describe("training routes", () => {
    beforeEach(() => seed("member"));

    it("403s a member reading who mentors whom", async () => {
        const res = await request(app).get(`/orgs/${ORG}/training/mentors`);
        expect(res.status).toBe(403);
    });

    it("409s with a code when the member already has a mentor", async () => {
        const res = await request(app).post(`/orgs/${ORG}/training/pupils`).send({ user_id: PUPIL });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("training_pupil_has_mentor");
    });

    it("409s with a code when retiring a mentor who has pupils", async () => {
        seed("owner");
        const res = await request(app).delete(`/orgs/${ORG}/training/mentors/${MENTOR2}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("training_mentor_has_pupils");
    });

    it("lets the current mentor set a stage and the pupil read it", async () => {
        holder.state!.tables.training_pupils[0].mentor_user_id = TEST_USER_ID;
        const put = await request(app)
            .put(`/orgs/${ORG}/training/pupils/${PUPIL}/stages`)
            .send({ practice: "Laboral", stage: "pasante" });
        expect(put.status).toBe(200);
        expect(put.body).toEqual({ practice: "laboral", stage: "pasante" });
        const forbidden = await request(app)
            .put(`/orgs/${ORG}/training/pupils/${MENTOR2}/stages`)
            .send({ stage: "junior" });
        expect(forbidden.status).toBe(404);
        const me = await request(app).get("/training/me");
        expect(me.status).toBe(200);
        expect(me.body.memberships).toEqual([
            { org_id: ORG, is_mentor: true, mentor_user_id: null, stages: [] },
        ]);
    });

    it("404s an organization the caller is not in", async () => {
        const res = await request(app).get(`/orgs/${id(999)}/training/pupils`);
        expect(res.status).toBe(404);
    });
});
