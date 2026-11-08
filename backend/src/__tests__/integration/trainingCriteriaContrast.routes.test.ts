import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// HTTP mapping and role matrix of the criteria contrast (layer 3, card 13).
// The learning-data rule itself is PostgreSQL's (training_can_read_learning,
// covered in src/__tests__/sql/performance.litt-training-criteria.sql); here a
// stand-in answers it from the same tables, so the matrix below is the
// service's use of it: the person and the CURRENT mentor, nobody else.
const state = vi.hoisted(() => ({
    actor: "",
    tables: {} as Record<string, Record<string, unknown>[]>,
    openable: new Set<string>(),
}));
vi.mock("../../lib/supabase", async () => {
    const { memoryDb } = await import("../helpers/memoryDb.js");
    return {
        createServerSupabase: vi.fn(() => {
            const { db } = memoryDb(state.tables, {
                training_can_read_learning: (args, tables) => {
                    const { p_actor: actor, p_org: org, p_trainee: trainee } = args as Record<string, string>;
                    const member = (id: string) => (tables.org_members ?? []).some((m) => m.org_id === org && m.user_id === id);
                    if (!member(actor) || !member(trainee)) return false;
                    if (actor === trainee) return true;
                    return (tables.training_pupils ?? []).some(
                        (p) => p.org_id === org && p.trainee_user_id === trainee && p.mentor_user_id === actor,
                    );
                },
            });
            return db;
        }),
    };
});
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = state.actor;
                next();
            }),
    };
});
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string) => ({ ok: state.openable.has(projectId) })),
}));

import { app } from "../../app";
import {
    myCriteriaContrastRouter,
    pupilCriteriaContrastRouter,
} from "../../modules/training-criteria-contrast/trainingCriteriaContrast.routes";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const OTHER_ORG = id(11);
const PUPIL = id(1);
const MENTOR = id(2);
const OLD_MENTOR = id(3);
const OWNER = id(4);
const ADMIN = id(5);
const MEMBER = id(6);
const OUTSIDER = id(7);
const OPEN_CHAT = id(20);
const SECRET_CHAT = id(21);
const OPEN_PROJECT = id(30);
const SECRET_PROJECT = id(31);
const OPEN_ROW = id(50);
const SECRET_ROW = id(51);

function seed() {
    const row = (over: Record<string, unknown>) => ({
        org_id: ORG, trainee_user_id: PUPIL, status: "explained", created_at: "2026-11-08T10:00:00Z",
        updated_at: "2026-11-08T10:00:00Z", message_id: id(60), person_explanation: "Mi explicación de la divergencia.",
        comparison: "Coincide\n- Ambos\nNo coincide\n- Nada\nFaltó\n- Nada", briefs: ["Uno", "Dos"],
        routes: [
            { name: "fast", provider: "gemini", model: "gemini-3.5-flash-lite", status: "completed", credential_ref: "never-shown" },
            { approach: "systematic", model: "m", status: "completed" },
        ],
        ...over,
    });
    state.tables = {
        org_members: [PUPIL, MENTOR, OLD_MENTOR, OWNER, ADMIN, MEMBER].map((user_id) => ({ org_id: ORG, user_id })),
        training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
        chats: [
            { id: OPEN_CHAT, project_id: OPEN_PROJECT, title: "Plazo" },
            { id: SECRET_CHAT, project_id: SECRET_PROJECT, title: "Reservado" },
        ],
        training_criteria_contrasts: [
            row({ id: OPEN_ROW, chat_id: OPEN_CHAT, message_id: id(61) }),
            row({ id: SECRET_ROW, chat_id: SECRET_CHAT, message_id: id(62), created_at: "2026-11-08T09:00:00Z" }),
        ],
        audit_events: [],
    };
    state.openable = new Set([OPEN_PROJECT]);
}

const as = (user: string) => {
    state.actor = user;
    return request(app);
};

const MATRIX: { route: string; call: (user: string) => request.Test; allowed: string[] }[] = [
    { route: "GET /", call: (u) => as(u).get("/training/me/criteria-contrasts"), allowed: [PUPIL] },
    { route: "GET /", call: (u) => as(u).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`), allowed: [MENTOR] },
];

describe("the role matrix", () => {
    beforeEach(seed);

    it("covers every route of both routers", () => {
        const routes = [myCriteriaContrastRouter, pupilCriteriaContrastRouter].flatMap((router) =>
            (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
                .filter((layer) => layer.route)
                .flatMap((layer) =>
                    Object.keys(layer.route!.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`),
                ),
        );
        expect(routes.sort()).toEqual(MATRIX.map((entry) => entry.route).sort());
    });

    it("the person's own list serves whoever asks only what is theirs: nothing for others", async () => {
        for (const user of [MENTOR, OLD_MENTOR, OWNER, ADMIN, MEMBER, OUTSIDER]) {
            const res = await as(user).get("/training/me/criteria-contrasts");
            expect(res.status).toBe(200);
            expect(res.body.contrasts, `contrasts of ${user}`).toEqual([]);
        }
    });

    it("the mentor route serves only the current mentor; the others get one and the same 404", async () => {
        const refused: string[] = [];
        for (const user of [PUPIL, MENTOR, OLD_MENTOR, OWNER, ADMIN, MEMBER, OUTSIDER]) {
            seed();
            const res = await MATRIX[1].call(user);
            if (user === MENTOR) expect(res.status).toBe(200);
            else {
                expect(res.status, `status for ${user}`).toBe(404);
                refused.push(JSON.stringify(res.body));
            }
        }
        expect(new Set(refused).size).toBe(1);
    });
});

describe("the person's routes", () => {
    beforeEach(seed);

    it("lists their own contrasts, newest first, with the analyses and without anything else", async () => {
        state.tables.training_criteria_contrasts.push({
            id: id(52), org_id: ORG, trainee_user_id: MEMBER, chat_id: OPEN_CHAT, message_id: id(63), status: "failed",
            routes: [{ status: "not_run" }], briefs: null, person_explanation: null, comparison: null, created_at: "2026-11-08T12:00:00Z",
        });
        const res = await as(PUPIL).get("/training/me/criteria-contrasts");
        expect(res.status).toBe(200);
        expect(res.body.contrasts.map((c: { id: string }) => c.id)).toEqual([OPEN_ROW, SECRET_ROW]);
        expect(res.body.contrasts[0]).toMatchObject({
            org_id: ORG, chat_id: OPEN_CHAT, status: "explained", briefs: ["Uno", "Dos"],
            person_explanation: "Mi explicación de la divergencia.",
        });
        // Identifiers only: whatever else a row carried is not passed on.
        expect(res.body.contrasts[0].routes).toEqual([
            { name: "fast", provider: "gemini", model: "gemini-3.5-flash-lite", status: "completed" },
            { approach: "systematic", model: "m", status: "completed" },
        ]);
        expect(JSON.stringify(res.body)).not.toMatch(/credential|never-shown|trainee_user_id|mentor/i);
    });

    it("filters by conversation", async () => {
        const res = await as(PUPIL).get(`/training/me/criteria-contrasts?chat_id=${OPEN_CHAT}`);
        expect(res.body.contrasts.map((c: { id: string }) => c.id)).toEqual([OPEN_ROW]);
    });

    it("answers the same 404 for a malformed filter", async () => {
        expect((await as(PUPIL).get("/training/me/criteria-contrasts?chat_id=x")).status).toBe(404);
        expect((await as(PUPIL).get("/training/me/criteria-contrasts?org_id=x")).status).toBe(404);
    });

    it("never serves a person who left the organization", async () => {
        state.tables.org_members = state.tables.org_members.filter((m) => m.user_id !== PUPIL);
        expect((await as(PUPIL).get("/training/me/criteria-contrasts")).status).toBe(404);
        expect((await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`)).status).toBe(404);
    });

    it("answers other organizations' ids the same 404", async () => {
        expect((await as(MENTOR).get(`/orgs/${OTHER_ORG}/training/pupils/${PUPIL}/criteria-contrasts`)).status).toBe(404);
    });
});

describe("the mentor's view", () => {
    beforeEach(seed);

    it("lists the contrasts in matters the mentor can open, only counts the others, and omits the analyses", async () => {
        const res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ org_id: ORG, trainee_user_id: PUPIL, contrasts_without_access: 1 });
        expect(res.body.contrasts).toHaveLength(1);
        expect(res.body.contrasts[0]).toMatchObject({
            id: OPEN_ROW, chat_id: OPEN_CHAT, project_id: OPEN_PROJECT, title: "Plazo", status: "explained",
            person_explanation: "Mi explicación de la divergencia.",
        });
        expect(res.body.contrasts[0].comparison).toMatch(/Coincide/);
        expect(res.body.contrasts[0]).not.toHaveProperty("briefs");
        expect(JSON.stringify(res.body)).not.toContain(SECRET_CHAT);
        expect(JSON.stringify(res.body)).not.toMatch(/Uno|Dos|credential/);
    });

    it("a new mentor sees the rows, the old one no longer does", async () => {
        (state.tables.training_pupils[0] as Record<string, unknown>).mentor_user_id = OLD_MENTOR;
        expect((await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`)).status).toBe(404);
        const res = await as(OLD_MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`);
        expect(res.status).toBe(200);
        expect(res.body.contrasts).toHaveLength(1);
    });

    it("carries no score, rank, average, percentile or group totals", async () => {
        const res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/criteria-contrasts`);
        const mine = await as(PUPIL).get("/training/me/criteria-contrasts");
        for (const body of [res.body, mine.body]) expect(JSON.stringify(body)).not.toMatch(/score|rank|average|percentile|total/i);
    });
});
