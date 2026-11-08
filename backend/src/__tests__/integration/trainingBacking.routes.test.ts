import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// HTTP mapping and role matrix of the accountability mode (layer 3, card 8).
// The learning-data rule itself is PostgreSQL's (training_can_read_learning,
// covered in src/__tests__/sql/performance.litt-training-supervision.sql);
// here a stand-in answers it from the same tables, so the matrix below is
// the service's use of it: the person and the CURRENT mentor, nobody else.
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
import { myBackingRouter, pupilBackingRouter } from "../../modules/training-backing/trainingBacking.routes";

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
const MSG_OPEN = id(40);
const MSG_SECRET = id(41);
const CHECK_OPEN = id(50);
const CHECK_SECRET = id(51);

const CITATION = {
    ref: 1, filename: "contrato.docx", page: 3, verified: true,
    quotes: [{ verification: { verified: true, source_excerpt: "El plazo es de tres años." } }],
};
const conclusion = (over: Record<string, unknown> = {}) => ({
    id: "c1", text: "El plazo es de tres años", citation_ref: 1, status: "backed",
    unverified_references: [], person_verified: false, person_note: null, ...over,
});

function seed() {
    const row = (over: Record<string, unknown>) => ({
        org_id: ORG, trainee_user_id: PUPIL, status: "ready", created_at: "2026-11-08T10:00:00Z",
        updated_at: "2026-11-08T10:00:00Z", word_chat_id: null, tabular_chat_id: null, ...over,
    });
    state.tables = {
        org_members: [PUPIL, MENTOR, OLD_MENTOR, OWNER, ADMIN, MEMBER].map((user_id) => ({ org_id: ORG, user_id })),
        training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
        chats: [
            { id: OPEN_CHAT, project_id: OPEN_PROJECT, title: "Plazo" },
            { id: SECRET_CHAT, project_id: SECRET_PROJECT, title: "Reservado" },
        ],
        chat_messages: [
            { id: MSG_OPEN, chat_id: OPEN_CHAT, citations: [CITATION] },
            { id: MSG_SECRET, chat_id: SECRET_CHAT, citations: [CITATION] },
        ],
        training_backing_checks: [
            row({ id: CHECK_OPEN, chat_id: OPEN_CHAT, message_id: MSG_OPEN, conclusions: [conclusion(), conclusion({ id: "c2", text: "Procede", citation_ref: null, status: "unbacked" })] }),
            row({ id: CHECK_SECRET, chat_id: SECRET_CHAT, message_id: MSG_SECRET, conclusions: [conclusion()] }),
        ],
        audit_events: [],
    };
    state.openable = new Set([OPEN_PROJECT]);
}

const as = (user: string) => {
    state.actor = user;
    return request(app);
};
const MARK = { person_verified: true };

/** Every route of the two routers, who may use it and what the others get. */
const MATRIX: { route: string; call: (user: string) => request.Test; allowed: string[] }[] = [
    { route: "GET /:chatId/backing", call: (u) => as(u).get(`/training/me/chats/${OPEN_CHAT}/backing`), allowed: [PUPIL] },
    {
        route: "PUT /:chatId/backing/:checkId/conclusions/:conclusionId",
        call: (u) => as(u).put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c2`).send(MARK),
        allowed: [PUPIL],
    },
    { route: "GET /", call: (u) => as(u).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`), allowed: [MENTOR] },
];

describe("the role matrix", () => {
    beforeEach(seed);

    it("covers every route of both routers", () => {
        const routes = [myBackingRouter, pupilBackingRouter].flatMap((router) =>
            (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
                .filter((layer) => layer.route)
                .flatMap((layer) =>
                    Object.keys(layer.route!.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`),
                ),
        );
        expect(routes.sort()).toEqual(MATRIX.map((entry) => entry.route).sort());
    });

    for (const entry of MATRIX) {
        it(`${entry.route}: only ${entry.allowed.length === 1 && entry.allowed[0] === PUPIL ? "the person" : "the current mentor"} is served`, async () => {
            const refused: string[] = [];
            for (const user of [PUPIL, MENTOR, OLD_MENTOR, OWNER, ADMIN, MEMBER, OUTSIDER]) {
                seed();
                const res = await entry.call(user);
                if (entry.allowed.includes(user)) {
                    expect(res.status, `status for ${user}`).toBe(200);
                } else {
                    expect(res.status, `status for ${user}`).toBe(404);
                    refused.push(JSON.stringify(res.body));
                }
            }
            // The same body whoever is refused: "not yours" and "not there" look alike.
            expect(new Set(refused).size).toBe(1);
        });
    }
});

describe("the person's routes", () => {
    beforeEach(seed);

    it("shows the person's checks with the passage the server found, never another person's", async () => {
        state.tables.training_backing_checks.push({
            id: id(52), org_id: ORG, trainee_user_id: MEMBER, chat_id: OPEN_CHAT, message_id: id(42),
            status: "ready", conclusions: [conclusion()], created_at: "2026-11-08T11:00:00Z", updated_at: "x",
            word_chat_id: null, tabular_chat_id: null,
        });
        const res = await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing`);
        expect(res.status).toBe(200);
        expect(res.body.checks).toHaveLength(1);
        expect(res.body.checks[0]).toMatchObject({ id: CHECK_OPEN, chat_id: OPEN_CHAT, message_id: MSG_OPEN, status: "ready" });
        expect(res.body.checks[0].conclusions[0]).toMatchObject({
            status: "backed",
            passage: { ref: 1, title: "contrato.docx", page: 3, excerpt: "El plazo es de tres años." },
        });
        expect(res.body.checks[0].conclusions[1]).toMatchObject({ status: "unbacked", passage: null });
    });

    it("answers the same 404 for a chat with no checks of theirs, a message with none and a malformed id", async () => {
        const bodies = [
            await as(PUPIL).get(`/training/me/chats/${id(99)}/backing`),
            await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing?message_id=${id(98)}`),
            await as(PUPIL).get("/training/me/chats/x/backing"),
            await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing?message_id=x`),
        ];
        expect(bodies.map((res) => res.status)).toEqual([404, 404, 404, 404]);
        expect(new Set(bodies.map((res) => JSON.stringify(res.body))).size).toBe(1);
    });

    it("downgrades a backed conclusion whose passage can no longer be shown", async () => {
        state.tables.chat_messages[0].citations = [];
        const res = await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing`);
        expect(res.body.checks[0].conclusions[0]).toMatchObject({ status: "unbacked", passage: null, citation_ref: null });
    });

    it("reads a pending check as failed after ten minutes and hides its conclusions", async () => {
        Object.assign(state.tables.training_backing_checks[0], { status: "pending", conclusions: null, created_at: "2020-01-01T00:00:00Z" });
        const res = await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing`);
        expect(res.body.checks[0]).toMatchObject({ status: "failed", conclusions: null });
    });

    it("marks «lo verifiqué» and a reason, keeps the rest of the row, and audits ids only", async () => {
        const res = await as(PUPIL)
            .put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c2`)
            .send({ person_verified: true, person_note: "  Lo conservo porque la cláusula 5 lo dice  " });
        expect(res.status).toBe(200);
        expect(res.body.conclusions[1]).toMatchObject({ person_verified: true, person_note: "Lo conservo porque la cláusula 5 lo dice" });
        expect(res.body.conclusions[0]).toMatchObject({ person_verified: false, person_note: null });
        const audit = state.tables.audit_events;
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
            action: "training.backing_verified", surface: "organization", org_id: ORG, chat_id: OPEN_CHAT,
            detail: { org_id: ORG, target_user_id: PUPIL },
        });
        expect(Object.keys(audit[0].detail as object).sort()).toEqual(["org_id", "target_user_id"]);
        expect(JSON.stringify(audit)).not.toContain("cláusula");
        // Marking again, or writing only a note, is not a second verification.
        await as(PUPIL).put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c2`).send({ person_verified: true });
        await as(PUPIL).put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c1`).send({ person_note: "nota" });
        expect(state.tables.audit_events).toHaveLength(1);
    });

    it("clears a note with null or blank, and unmarks", async () => {
        const url = `/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c1`;
        await as(PUPIL).put(url).send({ person_verified: true, person_note: "x" });
        const res = await as(PUPIL).put(url).send({ person_verified: false, person_note: "   " });
        expect(res.body.conclusions[0]).toMatchObject({ person_verified: false, person_note: null });
    });

    it.each([
        ["an empty body", {}],
        ["a stray field", { person_verified: true, status: "backed" }],
        ["a non-boolean mark", { person_verified: "yes" }],
        ["a non-string note", { person_note: 3 }],
        ["a note over 500 characters", { person_note: "x".repeat(501) }],
        ["an array", [1]],
    ])("rejects %s with its own code", async (_label, body) => {
        const res = await as(PUPIL)
            .put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c1`)
            .send(body as object);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("training_backing_invalid");
    });

    it("404s an unknown conclusion, a check of another chat and a pending check; 409 on a pending one", async () => {
        const base = `/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions`;
        expect((await as(PUPIL).put(`${base}/c9`).send(MARK)).status).toBe(404);
        expect((await as(PUPIL).put(`/training/me/chats/${SECRET_CHAT}/backing/${CHECK_OPEN}/conclusions/c1`).send(MARK)).status).toBe(404);
        expect((await as(PUPIL).put(`/training/me/chats/${OPEN_CHAT}/backing/${id(99)}/conclusions/c1`).send(MARK)).status).toBe(404);
        Object.assign(state.tables.training_backing_checks[0], { status: "pending", conclusions: null, created_at: new Date().toISOString() });
        expect((await as(PUPIL).put(`${base}/c1`).send(MARK)).status).toBe(409);
    });

    it("never leaves a learning table for the mentor of a former pupil", async () => {
        state.tables.org_members = state.tables.org_members.filter((m) => m.user_id !== PUPIL);
        expect((await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing`)).status).toBe(404);
        expect((await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`)).status).toBe(404);
    });

    it("answers other organizations' ids the same 404", async () => {
        expect((await as(MENTOR).get(`/orgs/${OTHER_ORG}/training/pupils/${PUPIL}/backing`)).status).toBe(404);
    });
});

describe("the mentor's summary", () => {
    beforeEach(seed);

    it("lists the works in matters the mentor can open and only counts the others", async () => {
        const res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ org_id: ORG, trainee_user_id: PUPIL, works_without_access: 1 });
        expect(res.body.works).toHaveLength(1);
        expect(res.body.works[0]).toMatchObject({ surface: "chat", chat_id: OPEN_CHAT, project_id: OPEN_PROJECT, title: "Plazo" });
        expect(res.body.works[0].checks[0].conclusions[0].passage.excerpt).toBe("El plazo es de tres años.");
        expect(JSON.stringify(res.body)).not.toContain(SECRET_CHAT);
    });

    it("shows the person's marks and notes to the mentor", async () => {
        await as(PUPIL).put(`/training/me/chats/${OPEN_CHAT}/backing/${CHECK_OPEN}/conclusions/c2`).send({ person_verified: true, person_note: "porque sí" });
        const res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`);
        expect(res.body.works[0].checks[0].conclusions[1]).toMatchObject({ person_verified: true, person_note: "porque sí" });
    });

    it("hides checks that are not ready or have no conclusions, and a new mentor sees the rows", async () => {
        state.tables.training_backing_checks[0].conclusions = [];
        let res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`);
        expect(res.body.works).toEqual([]);
        seed();
        (state.tables.training_pupils[0] as Record<string, unknown>).mentor_user_id = OLD_MENTOR;
        expect((await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`)).status).toBe(404);
        res = await as(OLD_MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`);
        expect(res.status).toBe(200);
        expect(res.body.works).toHaveLength(1);
    });

    it("carries no score, rank, average, percentile or group totals", async () => {
        const res = await as(MENTOR).get(`/orgs/${ORG}/training/pupils/${PUPIL}/backing`);
        const mine = await as(PUPIL).get(`/training/me/chats/${OPEN_CHAT}/backing`);
        for (const body of [res.body, mine.body])
            expect(JSON.stringify(body)).not.toMatch(/score|rank|average|percentile|total/i);
    });
});
