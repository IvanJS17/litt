import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Urgency pass routes (training layer 2) over an in-memory database. The rule
// (training_can_read_learning) and the grant function
// (training_grant_urgency_pass) are PostgreSQL's and run against a real
// database in src/__tests__/sql/performance.litt-training-*.sql; here they are
// stubbed as the database answers them, so these tests prove that the routes
// add no role of their own and map every outcome.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const PROJECT = id(200);
const OTHER_ORG_PROJECT = id(201);
const PUPIL = id(1);
const MENTOR = id(2);
const PREVIOUS_MENTOR = id(3);
const OWNER = id(4);
const ADMIN = id(5);
const MEMBER = id(6);
const OUTSIDER = id(7);

const state = vi.hoisted(() => ({
    caller: "",
    tables: {} as Record<string, Record<string, unknown>[]>,
    grantOutcome: "granted",
    // Who can open which project: `${projectId}:${userId}`.
    projectAccess: new Set<string>(),
    audits: [] as Record<string, unknown>[],
    rpcCalls: [] as [string, Record<string, unknown>][],
}));

vi.mock("../../lib/supabase", async () => {
    const { memoryDb } = await import("../helpers/memoryDb.js");
    return {
        createServerSupabase: vi.fn(() => ({ from: memoryDb(state.tables).db.from, rpc: fakeRpc })),
    };
});
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) =>
        state.projectAccess.has(`${projectId}:${userId}`)
            ? {
                  ok: true,
                  isCreator: false,
                  orgRole: "member",
                  projectRole: "editor",
                  project: { id: projectId, org_id: projectId === OTHER_ORG_PROJECT ? id(999) : ORG },
              }
            : { ok: false },
    ),
}));
vi.mock("../../lib/audit", () => ({
    recordAudit: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
        state.audits.push(event);
    }),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = state.caller;
                res.locals.userEmail = `${state.caller}@example.test`;
                next();
            }),
    };
});

import { app } from "../../app";

const NOTE = "La audiencia del cliente Pérez es mañana a las 9";

function pass(extra: Row = {}): Row {
    return {
        id: id(300),
        org_id: ORG,
        trainee_user_id: PUPIL,
        project_id: PROJECT,
        granted_by: MENTOR,
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        reason_code: "audiencia",
        reason_note: NOTE,
        revoked_at: null,
        revoked_by: null,
        created_at: new Date(Date.now() - 60_000).toISOString(),
        ...extra,
    };
}

// The database as these routes see it: the learning rule admits the pupil
// and their current mentor (MENTOR) only, and a grant inserts a row.
async function fakeRpc(fn: string, args: Record<string, unknown>) {
    state.rpcCalls.push([fn, args]);
    if (fn === "training_can_read_learning")
        return {
            data:
                args.p_org === ORG &&
                args.p_trainee === PUPIL &&
                (args.p_actor === PUPIL || args.p_actor === MENTOR),
            error: null,
        };
    if (fn === "training_grant_urgency_pass") {
        if (state.grantOutcome !== "granted") return { data: { outcome: state.grantOutcome }, error: null };
        const row = pass({
            id: id(301),
            project_id: args.p_project,
            granted_by: args.p_actor,
            expires_at: new Date(Date.now() + (args.p_duration_minutes as number) * 60_000).toISOString(),
            reason_code: args.p_reason_code,
            reason_note: args.p_reason_note,
        });
        state.tables.training_urgency_passes.push(row);
        return { data: { outcome: "granted", pass: row }, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
}

beforeEach(() => {
    state.caller = MENTOR;
    state.tables = { training_urgency_passes: [] };
    state.grantOutcome = "granted";
    state.projectAccess = new Set([
        `${PROJECT}:${MENTOR}`,
        `${PROJECT}:${PUPIL}`,
        `${OTHER_ORG_PROJECT}:${MENTOR}`,
        `${OTHER_ORG_PROJECT}:${PUPIL}`,
    ]);
    state.audits = [];
    state.rpcCalls = [];
});

const base = `/orgs/${ORG}/training/pupils/${PUPIL}/passes`;
const grant = (body: Record<string, unknown> = {}) =>
    request(app)
        .post(base)
        .send({ project_id: PROJECT, reason_code: "audiencia", reason_note: NOTE, ...body });
const grantCalls = () => state.rpcCalls.filter(([fn]) => fn === "training_grant_urgency_pass");

describe("POST /orgs/:orgId/training/pupils/:userId/passes", () => {
    it("lets the current mentor grant a pass for 8 hours by default", async () => {
        const res = await grant();
        expect(res.status).toBe(201);
        expect(Object.keys(res.body).sort()).toEqual([
            "expires_at",
            "id",
            "org_id",
            "project_id",
            "reason_code",
            "reason_note",
            "revoked_at",
            "starts_at",
            "trainee_user_id",
        ]);
        expect(res.body).toMatchObject({ project_id: PROJECT, reason_code: "audiencia", reason_note: NOTE });
        expect(grantCalls()).toEqual([
            [
                "training_grant_urgency_pass",
                {
                    p_actor: MENTOR,
                    p_org: ORG,
                    p_trainee: PUPIL,
                    p_project: PROJECT,
                    p_duration_minutes: 480,
                    p_reason_code: "audiencia",
                    p_reason_note: NOTE,
                    p_max_active: 5,
                },
            ],
        ]);
    });

    it("audits who, to whom, where, until when and the reason code, never the note", async () => {
        const res = await grant({ duration_minutes: 90 });
        expect(state.audits).toHaveLength(1);
        const [event] = state.audits;
        expect(event).toMatchObject({
            userId: MENTOR,
            orgId: ORG,
            action: "training.urgency_pass_granted",
            surface: "organization",
            projectId: PROJECT,
        });
        expect(event.detail).toEqual({
            org_id: ORG,
            target_user_id: PUPIL,
            expires_at: res.body.expires_at,
            reason_code: "audiencia",
        });
        expect(JSON.stringify(state.audits)).not.toContain("Pérez");
    });

    it("stores a blank note as none", async () => {
        const res = await grant({ reason_note: "   " });
        expect(res.status).toBe(201);
        expect(grantCalls()[0][1].p_reason_note).toBeNull();
    });

    it.each([
        ["29 minutes", { duration_minutes: 29 }],
        ["more than 72 hours", { duration_minutes: 4321 }],
        ["a fraction of a minute", { duration_minutes: 30.5 }],
        ["a duration as text", { duration_minutes: "60" }],
        ["an unknown reason", { reason_code: "capricho" }],
        ["no reason", { reason_code: null }],
        ["a note over 500 characters", { reason_note: "x".repeat(501) }],
        ["a malformed project", { project_id: "nope" }],
    ])("refuses %s with 400 training_pass_invalid", async (_label, body) => {
        const res = await grant(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("training_pass_invalid");
        expect(grantCalls()).toHaveLength(0);
    });

    it.each([[30], [4320]])("accepts %s minutes", async (minutes) => {
        expect((await grant({ duration_minutes: minutes })).status).toBe(201);
    });

    it("refuses a project the mentor cannot open, or of another organization, as not found", async () => {
        expect((await grant({ project_id: OTHER_ORG_PROJECT })).status).toBe(404);
        state.projectAccess.delete(`${PROJECT}:${MENTOR}`);
        expect((await grant()).status).toBe(404);
        expect(grantCalls()).toHaveLength(0);
    });

    // R3's organization condition on its own: both people can open the
    // matter, so only its organization is left to refuse it. The answer is the
    // one a matter nobody can open gets, so it says nothing about the matter.
    it("refuses a matter of another organization that the mentor and the pupil can both open", async () => {
        expect(state.projectAccess.has(`${OTHER_ORG_PROJECT}:${MENTOR}`)).toBe(true);
        expect(state.projectAccess.has(`${OTHER_ORG_PROJECT}:${PUPIL}`)).toBe(true);
        const res = await grant({ project_id: OTHER_ORG_PROJECT });
        expect(res.status).toBe(404);
        expect(res.body).toEqual((await grant({ project_id: id(250) })).body);
        expect(grantCalls()).toHaveLength(0);
        expect(state.audits).toEqual([]);
    });

    it("refuses a project the pupil cannot open with its own code", async () => {
        state.projectAccess.delete(`${PROJECT}:${PUPIL}`);
        const res = await grant();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("training_pass_pupil_no_access");
        expect(grantCalls()).toHaveLength(0);
    });

    it.each([
        ["limit", 409, "training_pass_limit_reached"],
        ["duplicate", 409, "training_pass_duplicate"],
        ["project_not_found", 404, undefined],
        ["not_found", 404, undefined],
    ])("maps the database's %s", async (outcome, status, code) => {
        state.grantOutcome = outcome;
        const res = await grant();
        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(state.audits).toEqual([]);
    });
});

describe("the pass routes answer one 404 to anybody but the current mentor", () => {
    const actors: [string, string][] = [
        ["the pupil themself", PUPIL],
        ["a previous mentor", PREVIOUS_MENTOR],
        ["the owner", OWNER],
        ["an admin", ADMIN],
        ["another member", MEMBER],
        ["somebody outside the firm", OUTSIDER],
    ];
    const calls = [
        () => request(app).get(base),
        () => grant(),
        () => request(app).delete(`${base}/${id(300)}`),
    ];

    it.each(actors)("%s", async (_label, actor) => {
        state.tables.training_urgency_passes.push(pass());
        state.caller = actor;
        const bodies = new Set<string>();
        for (const call of calls) {
            const res = await call();
            expect(res.status).toBe(404);
            bodies.add(JSON.stringify(res.body));
        }
        // The same body as a pupil who does not exist.
        state.caller = MENTOR;
        const missing = await request(app).get(`/orgs/${ORG}/training/pupils/${id(998)}/passes`);
        expect(missing.status).toBe(404);
        bodies.add(JSON.stringify(missing.body));
        expect(bodies.size).toBe(1);
        expect(grantCalls()).toHaveLength(0);
        expect(state.tables.training_urgency_passes[0].revoked_at).toBeNull();
        expect(state.audits).toEqual([]);
    });
});

describe("GET and DELETE …/passes", () => {
    it("lists the pupil's passes for the current mentor, with no score or ranking", async () => {
        state.tables.training_urgency_passes.push(pass(), pass({ id: id(302), trainee_user_id: MEMBER }));
        const res = await request(app).get(base);
        expect(res.status).toBe(200);
        expect(res.body.passes.map((p: { id: string }) => p.id)).toEqual([id(300)]);
        expect(JSON.stringify(res.body)).not.toMatch(/score|rank|average|promedio/i);
    });

    describe("?project_ids= (the selector's matters)", () => {
        const PUPIL_BLOCKED = id(202);
        const MENTOR_BLOCKED = id(203);
        beforeEach(() => {
            state.projectAccess.add(`${PUPIL_BLOCKED}:${MENTOR}`);
            state.projectAccess.add(`${MENTOR_BLOCKED}:${PUPIL}`);
        });
        const ask = (ids: string[]) => request(app).get(`${base}?project_ids=${ids.join(",")}`);

        it("keeps only the matters both the mentor and the pupil can open, in the organization", async () => {
            const res = await ask([PROJECT, PUPIL_BLOCKED, MENTOR_BLOCKED, OTHER_ORG_PROJECT]);
            expect(res.status).toBe(200);
            expect(res.body.grantable_project_ids).toEqual([PROJECT]);
            expect(res.body.passes).toEqual([]);
        });

        it("leaves out a matter of another organization that both can open", async () => {
            const res = await ask([OTHER_ORG_PROJECT]);
            expect(res.status).toBe(200);
            expect(res.body.grantable_project_ids).toEqual([]);
        });

        it("agrees with the grant: what it lists is accepted, what it leaves out is refused", async () => {
            const listed = (await ask([PROJECT, PUPIL_BLOCKED])).body.grantable_project_ids;
            expect(listed).toEqual([PROJECT]);
            expect((await grant({ project_id: PROJECT })).status).toBe(201);
            const refused = await grant({ project_id: PUPIL_BLOCKED });
            expect(refused.status).toBe(409);
            expect(refused.body.code).toBe("training_pass_pupil_no_access");
        });

        it("ignores malformed and repeated ids, and says nothing without the parameter", async () => {
            const res = await ask(["nope", PROJECT, PROJECT, ""]);
            expect(res.body.grantable_project_ids).toEqual([PROJECT]);
            expect(await request(app).get(base)).toMatchObject({
                body: { passes: [] },
            });
            expect((await request(app).get(base)).body).not.toHaveProperty("grantable_project_ids");
        });

        it("answers an empty list for an empty parameter", async () => {
            expect((await request(app).get(`${base}?project_ids=`)).body.grantable_project_ids).toEqual([]);
        });

        it("is the current mentor's only: anyone else gets the uniform 404", async () => {
            state.caller = OWNER;
            const res = await ask([PROJECT]);
            expect(res.status).toBe(404);
            expect(res.body).not.toHaveProperty("grantable_project_ids");
        });
    });

    it("revokes once, audits once, and answers 204 again without a second event", async () => {
        state.tables.training_urgency_passes.push(pass());
        expect((await request(app).delete(`${base}/${id(300)}`)).status).toBe(204);
        const row = state.tables.training_urgency_passes[0];
        expect(row.revoked_at).toEqual(expect.any(String));
        expect(row.revoked_by).toBe(MENTOR);
        expect((await request(app).delete(`${base}/${id(300)}`)).status).toBe(204);
        expect(state.audits).toHaveLength(1);
        expect(state.audits[0]).toMatchObject({
            action: "training.urgency_pass_revoked",
            projectId: PROJECT,
        });
        expect(state.audits[0].detail).toEqual({ org_id: ORG, target_user_id: PUPIL });
    });

    it("answers 404 to a pass that is not this pupil's, or a malformed id", async () => {
        state.tables.training_urgency_passes.push(pass({ trainee_user_id: MEMBER }));
        expect((await request(app).delete(`${base}/${id(300)}`)).status).toBe(404);
        expect((await request(app).delete(`${base}/not-a-uuid`)).status).toBe(404);
        expect(state.tables.training_urgency_passes[0].revoked_at).toBeNull();
        expect(state.audits).toEqual([]);
    });
});

describe("GET /training/me/supervision", () => {
    it("shows the pupil their own passes", async () => {
        state.caller = PUPIL;
        state.tables.training_urgency_passes.push(pass(), pass({ id: id(302), trainee_user_id: MEMBER }));
        const res = await request(app).get(`/training/me/supervision?org_id=${ORG}`);
        expect(res.status).toBe(200);
        expect(res.body.urgency_passes.map((p: { id: string }) => p.id)).toEqual([id(300)]);
        expect(res.body.urgency_passes[0].reason_note).toBe(NOTE);
    });
});
