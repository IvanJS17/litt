import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The firm's criteria over HTTP (training layer 3), against an in-memory
// database. The SQL (constraints, privileges, RLS) is covered against
// PostgreSQL in performance.litt-firm-criteria.sql.
const h = vi.hoisted(() => ({
    caller: { id: "" },
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
                res.locals.userEmail = `${h.caller.id}@test.local`;
                next();
            }),
    };
});
vi.mock("../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/audit")>()),
    recordAudit: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { recordAudit } from "../../lib/audit";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const PARTNER = id(1);
const TRAINEE = id(2);
const ADMIN = id(3);
const OUTSIDER = id(4);

const body = { topic: "Prescripción cambiaria", position: "El plazo corre desde el vencimiento.", practice: "mercantil" };

beforeEach(() => {
    vi.mocked(recordAudit).mockClear();
    h.state = memoryDb({
        organizations: [
            { id: ORG, kind: "team" },
            { id: OTHER_ORG, kind: "team" },
        ],
        org_members: [
            { org_id: ORG, user_id: PARTNER, role: "member" },
            { org_id: ORG, user_id: TRAINEE, role: "member" },
            { org_id: ORG, user_id: ADMIN, role: "admin" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
        ],
        training_stages: [{ org_id: ORG, trainee_user_id: TRAINEE, practice: null, stage: "pasante" }],
        user_profiles: [{ user_id: PARTNER, display_name: "Ana Pérez", email: "ana@example.test" }],
        firm_criteria: [],
    });
});

const as = (userId: string) => {
    h.caller.id = userId;
};

describe("/orgs/:orgId/firm-criteria", () => {
    it("writes, lists, changes and removes a criterion", async () => {
        as(PARTNER);
        const created = await request(app).post(`/orgs/${ORG}/firm-criteria`).send(body);
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ topic: body.topic, author_name: "Ana Pérez", mine: true, practice: "mercantil" });

        as(TRAINEE);
        const listed = await request(app).get(`/orgs/${ORG}/firm-criteria`);
        expect(listed.status).toBe(200);
        expect(listed.body).toMatchObject({ can_write: false, can_manage: false, criteria: [{ id: created.body.id, mine: false }] });

        as(PARTNER);
        const changed = await request(app).put(`/orgs/${ORG}/firm-criteria/${created.body.id}`).send({ ...body, position: "Otra." });
        expect(changed.status).toBe(200);
        expect(changed.body.position).toBe("Otra.");

        as(ADMIN);
        const removed = await request(app).delete(`/orgs/${ORG}/firm-criteria/${created.body.id}`);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ deleted: true });
        expect(vi.mocked(recordAudit).mock.calls.map((call) => call[1].action)).toEqual([
            "firm_criteria.created",
            "firm_criteria.updated",
            "firm_criteria.deleted",
        ]);
    });

    it("answers 400, 403 and 404 as the service decides", async () => {
        as(PARTNER);
        expect((await request(app).post(`/orgs/${ORG}/firm-criteria`).send({ topic: "", position: "" })).status).toBe(400);
        as(TRAINEE);
        expect((await request(app).post(`/orgs/${ORG}/firm-criteria`).send(body)).status).toBe(403);
        as(OUTSIDER);
        expect((await request(app).get(`/orgs/${ORG}/firm-criteria`)).status).toBe(404);
        expect((await request(app).post(`/orgs/${ORG}/firm-criteria`).send(body)).status).toBe(404);
        expect((await request(app).get(`/orgs/not-an-id/firm-criteria`)).status).toBe(404);
    });

    it("gives the other organization the same 404 for a criterion that exists there", async () => {
        as(OUTSIDER);
        const created = await request(app).post(`/orgs/${OTHER_ORG}/firm-criteria`).send(body);
        expect(created.status).toBe(201);
        as(PARTNER);
        const missing = await request(app).put(`/orgs/${ORG}/firm-criteria/${created.body.id}`).send(body);
        const unknown = await request(app).put(`/orgs/${ORG}/firm-criteria/${id(999)}`).send(body);
        expect(missing.status).toBe(404);
        expect(missing.body).toEqual(unknown.body);
        expect((await request(app).delete(`/orgs/${ORG}/firm-criteria/${created.body.id}`)).status).toBe(404);
    });
});
