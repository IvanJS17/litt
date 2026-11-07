import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Oral defenses and promotion by evidence (training layer 2) over HTTP,
// against an in-memory database whose training_can_read_learning is the SQL
// rule's own statement (the pupil, or their current mentor, both members).
// The SQL itself (the function, the once-only outcome, the pass that ends
// with a mentor change) is covered against PostgreSQL in
// performance.litt-training-*.sql. The mentor's BYOK route, the model call
// and the matter rule are stubbed at their facades so each test can see
// exactly what was (not) called.
const h = vi.hoisted(() => {
    process.env.RATE_LIMIT_CHAT_MAX = "10000";
    return {
        caller: { id: "" },
        state: null as null | { db: unknown; tables: Record<string, Row[]> },
        openable: new Set<string>(),
    };
});
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
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => ({
        ok: h.openable.has(`${projectId}:${userId}`),
    })),
}));
vi.mock("../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/audit")>()),
    recordAudit: vi.fn(async () => undefined),
}));
vi.mock("../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm")>()),
    completeText: vi.fn(),
}));
vi.mock("../../modules/user/user.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/user/user.service")>()),
    resolveUserChatSelection: vi.fn(),
    listChatCredentialOptions: vi.fn(),
    pinChatRoute: vi.fn(),
    loadPinnedChatRoute: vi.fn(),
    recordChatEgress: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { recordAudit } from "../../lib/audit";
import { completeText } from "../../lib/llm";
import {
    listChatCredentialOptions,
    loadPinnedChatRoute,
    pinChatRoute,
    recordChatEgress,
    resolveUserChatSelection,
} from "../../modules/user/user.service";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const PUPIL = id(1);
const MENTOR = id(2);
const FORMER_MENTOR = id(3);
const OWNER = id(4);
const ADMIN = id(5);
const MEMBER = id(6);
const OUTSIDER = id(7);
const CHAT = id(200);
const MATTER_CHAT = id(201);
const PROJECT = id(300);
const REVIEW = id(600);
const MATTER_REVIEW = id(601);

const ATTEMPT = "Considero que procede la rescisión por falta de pago, conforme al art. 1949 del Código Civil.";
const CONTRAST = "Coincide\n- La vía\nNo coincide\n- El plazo aplicable\nFaltó\n- Revisar la cláusula penal";
const NOTE = "Respondió bien el cambio de hechos sobre el plazo de gracia.";
const MENTOR_ROUTE = { provider: "claude", model: "mentor-model", credentialRef: `user:${MENTOR}:claude:v1` };
const MENTOR_KEYS = { claude: "mentor-secret", disabledProviders: ["openai"] };
const question = (kind: string, text: string) => ({ kind, text, listen_for: `Que justifique: ${text}` });
const QUESTIONS = [
    question("base", "¿Por qué eligió la rescisión y no el cumplimiento forzoso?"),
    question("base", "¿Cómo acredita la falta de pago?"),
    question("base", "¿Qué dice el art. 1949 sobre el pacto comisorio?"),
    question("base", "¿Qué plazo aplica a la acción?"),
    question("cambio_de_hechos", "¿Y si el deudor hubiera pagado la mitad antes de la demanda?"),
];
const MODEL_ANSWER = JSON.stringify({ questions: QUESTIONS });

function note(noteId: string, chat: Row, createdAt: string): Row {
    return {
        id: noteId,
        org_id: ORG,
        trainee_user_id: PUPIL,
        chat_id: null,
        word_chat_id: null,
        tabular_chat_id: null,
        ...chat,
        message_id: id(450),
        attempt: ATTEMPT,
        contrast: CONTRAST,
        contrast_status: "ready",
        created_at: createdAt,
    };
}
function review(reviewId: string, chatId: string, reviewedAt: string | null): Row {
    return {
        id: reviewId,
        org_id: ORG,
        trainee_user_id: PUPIL,
        chat_id: chatId,
        word_chat_id: null,
        tabular_chat_id: null,
        status: "ready",
        reviewed_at: reviewedAt,
        updated_at: new Date().toISOString(),
    };
}

function seed() {
    const now = new Date().toISOString();
    h.state = memoryDb(
        {
            organizations: [{ id: ORG, kind: "team" }],
            org_members: [
                { org_id: ORG, user_id: PUPIL, role: "member" },
                { org_id: ORG, user_id: MENTOR, role: "member" },
                { org_id: ORG, user_id: FORMER_MENTOR, role: "member" },
                { org_id: ORG, user_id: OWNER, role: "owner" },
                { org_id: ORG, user_id: ADMIN, role: "admin" },
                { org_id: ORG, user_id: MEMBER, role: "member" },
                { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
            ],
            training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
            training_stages: [
                { id: id(700), org_id: ORG, trainee_user_id: PUPIL, practice: null, stage: "pasante", updated_at: "2026-01-01T00:00:00.000Z" },
            ],
            training_turn_notes: [note("n1", { chat_id: CHAT }, now), note("n2", { chat_id: MATTER_CHAT }, now)],
            chats: [
                { id: CHAT, project_id: null, title: "Rescisión" },
                { id: MATTER_CHAT, project_id: PROJECT, title: "Asunto privado" },
            ],
            projects: [{ id: PROJECT, practice: "Laboral" }],
            training_work_reviews: [review(REVIEW, CHAT, null), review(MATTER_REVIEW, MATTER_CHAT, null)],
            training_defenses: [],
            training_version_approvals: [],
        },
        {
            // training_can_read_learning, as 20261107_60 states it.
            training_can_read_learning: ({ p_actor, p_org, p_trainee }, tables) => {
                const member = (user: unknown) =>
                    tables.org_members.some((m) => m.org_id === p_org && m.user_id === user);
                if (!member(p_actor) || !member(p_trainee)) return false;
                if (p_actor === p_trainee) return true;
                return tables.training_pupils.some(
                    (p) => p.org_id === p_org && p.trainee_user_id === p_trainee && p.mentor_user_id === p_actor,
                );
            },
        },
    );
}

const pupilBase = `/orgs/${ORG}/training/pupils/${PUPIL}`;
const defenses = `${pupilBase}/defenses`;
const promotion = `${pupilBase}/promotion`;
const as = (user: string) => {
    h.caller.id = user;
    return request(app);
};
const trainingEvents = () =>
    vi.mocked(recordAudit).mock.calls.map(([, event]) => event).filter((event) => event.action.startsWith("training."));

async function newDefense(body: Record<string, unknown> = {}) {
    const res = await as(MENTOR).post(defenses).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string; practice: string | null };
}

beforeEach(() => {
    seed();
    h.openable.clear();
    vi.mocked(recordAudit).mockClear();
    vi.mocked(recordChatEgress).mockClear();
    vi.mocked(completeText).mockReset().mockResolvedValue(MODEL_ANSWER);
    vi.mocked(resolveUserChatSelection).mockReset().mockResolvedValue({ ok: true, selectedModel: "mentor-model" } as never);
    vi.mocked(listChatCredentialOptions).mockReset().mockResolvedValue({
        provider: "claude",
        options: [{ credential_ref: MENTOR_ROUTE.credentialRef, source: "personal" }],
        default: MENTOR_ROUTE.credentialRef,
    } as never);
    vi.mocked(pinChatRoute).mockReset().mockResolvedValue({ ok: true, route: MENTOR_ROUTE, apiKeys: MENTOR_KEYS } as never);
    vi.mocked(loadPinnedChatRoute).mockReset().mockResolvedValue({ ok: true, route: MENTOR_ROUTE, apiKeys: MENTOR_KEYS } as never);
});

describe("privacy by role", () => {
    it.each([
        ["the former mentor", FORMER_MENTOR],
        ["an owner", OWNER],
        ["an admin", ADMIN],
        ["another member", MEMBER],
        ["someone from another organization", OUTSIDER],
        ["the pupil, on the mentor's routes", PUPIL],
    ])("answers %s the same 404 on every defense and promotion route", async (_label, user) => {
        const defense = await newDefense();
        vi.mocked(recordAudit).mockClear();
        const unknown = await as(user).get(`/orgs/${ORG}/training/pupils/${id(999)}/defenses`);
        for (const res of [
            await as(user).get(defenses),
            await as(user).post(defenses).send({}),
            await as(user).post(`${defenses}/${defense.id}/questions`).send({}),
            await as(user).put(`${defenses}/${defense.id}/outcome`).send({ outcome: "approved", reason: "otro" }),
            await as(user).get(promotion),
            await as(user).post(promotion).send({ practice: null, to: "junior" }),
        ]) {
            expect(res.status).toBe(404);
            expect(res.body).toEqual(unknown.body);
        }
        expect(completeText).not.toHaveBeenCalled();
        expect(trainingEvents()).toEqual([]);
        expect(h.state!.tables.training_defenses).toHaveLength(1);
        expect(h.state!.tables.training_defenses[0].outcome ?? null).toBeNull();
        expect(h.state!.tables.training_stages[0].stage).toBe("pasante");
    });

    it("moves with the pupil: the new mentor sees the defenses, the former one gets the 404", async () => {
        await newDefense();
        h.state!.tables.training_pupils[0].mentor_user_id = FORMER_MENTOR;
        expect((await as(MENTOR).get(defenses)).status).toBe(404);
        const now = await as(FORMER_MENTOR).get(defenses);
        expect(now.status).toBe(200);
        expect(now.body.defenses).toHaveLength(1);
    });

    it("never answers a score, an average or a ranking", async () => {
        const defense = await newDefense();
        await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        const text = JSON.stringify([(await as(MENTOR).get(defenses)).body, (await as(MENTOR).get(promotion)).body]);
        expect(text).not.toMatch(/score|average|promedio|rank|percentile|grade/i);
    });
});

describe("creating a defense", () => {
    it("takes the practice area of the linked work's matter by default", async () => {
        h.openable.add(`${PROJECT}:${MENTOR}`);
        const defense = await newDefense({ work_review_id: MATTER_REVIEW });
        expect(defense).toMatchObject({ practice: "laboral", work_review_id: MATTER_REVIEW, questions_status: "none" });
    });

    it("refuses a work in a matter the mentor cannot open, with the same 404", async () => {
        const res = await as(MENTOR).post(defenses).send({ work_review_id: MATTER_REVIEW });
        expect(res.status).toBe(404);
        expect((await as(MENTOR).post(defenses).send({ work_review_id: id(999) })).body).toEqual(res.body);
        expect(h.state!.tables.training_defenses).toHaveLength(0);
    });

    it("normalizes an explicit practice area and refuses a blank one", async () => {
        expect((await newDefense({ practice: "  Civil  " })).practice).toBe("civil");
        expect((await newDefense()).practice).toBeNull();
        expect((await as(MENTOR).post(defenses).send({ practice: "  " })).status).toBe(400);
    });
});

describe("the questions", () => {
    it("are five, exactly one a change of facts, on the mentor's route", async () => {
        const defense = await newDefense({ work_review_id: REVIEW });
        const res = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(res.status).toBe(200);
        expect(res.body.questions_status).toBe("ready");
        expect(res.body.questions).toHaveLength(5);
        expect(res.body.questions.filter((q: { kind: string }) => q.kind === "cambio_de_hechos")).toHaveLength(1);
        expect(res.body).toMatchObject({ model_provider: "claude", model: "mentor-model" });
        expect(res.body).not.toHaveProperty("credential_ref");
        expect(h.state!.tables.training_defenses[0]).toMatchObject({
            credential_ref: MENTOR_ROUTE.credentialRef,
            generated_by: MENTOR,
        });
        // The pupil's text is fenced with the call's nonce.
        const prompt = vi.mocked(completeText).mock.calls[0][0].user;
        expect(prompt).toMatch(/<trainee-attempt nonce="[0-9a-f]{16}">/);
        expect(prompt).toContain(ATTEMPT);
    });

    it("use the mentor's key, never the pupil's, and record the egress first", async () => {
        const defense = await newDefense({ work_review_id: REVIEW });
        await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({ credential_ref: MENTOR_ROUTE.credentialRef });
        expect(pinChatRoute).toHaveBeenCalledTimes(1);
        expect(vi.mocked(pinChatRoute).mock.calls[0][1]).toEqual({
            userId: MENTOR,
            orgId: ORG,
            model: "mentor-model",
            requestedCredentialRef: MENTOR_ROUTE.credentialRef,
        });
        const routeCalls = [
            ...vi.mocked(pinChatRoute).mock.calls,
            ...vi.mocked(loadPinnedChatRoute).mock.calls,
            ...vi.mocked(resolveUserChatSelection).mock.calls,
            ...vi.mocked(listChatCredentialOptions).mock.calls,
        ].map(([, args]) => (args as { userId: string }).userId);
        expect(routeCalls).not.toContain(PUPIL);
        expect(vi.mocked(completeText).mock.calls[0][0]).toMatchObject({ model: "mentor-model", apiKeys: MENTOR_KEYS });
        expect(vi.mocked(recordChatEgress).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(completeText).mock.invocationCallOrder[0],
        );
        const egress = vi.mocked(recordChatEgress).mock.calls[0][1];
        expect(egress).toMatchObject({ userId: MENTOR, orgId: ORG, chatId: CHAT, surface: "training_supervision" });
        expect(egress.extra).toEqual({ defense_id: defense.id });
    });

    it("never fall back: no key means no model call", async () => {
        vi.mocked(listChatCredentialOptions).mockResolvedValue({ provider: "claude", options: [], default: null } as never);
        const defense = await newDefense();
        expect((await as(MENTOR).get(defenses)).body.generation).toEqual({
            available: false,
            code: "training_review_key_required",
        });
        const res = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("training_review_key_required");
        expect(pinChatRoute).not.toHaveBeenCalled();
        expect(recordChatEgress).not.toHaveBeenCalled();
        expect(completeText).not.toHaveBeenCalled();
        expect(h.state!.tables.training_defenses[0].questions_status).toBe("none");
    });

    it("never fall back: a stored route that no longer serves fails closed", async () => {
        const defense = await newDefense();
        await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        vi.mocked(pinChatRoute).mockClear();
        vi.mocked(completeText).mockClear();
        vi.mocked(loadPinnedChatRoute).mockResolvedValue({
            ok: false,
            status: 409,
            code: "chat_route_credential_unavailable",
            detail: "gone",
        } as never);
        const res = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("chat_route_credential_unavailable");
        expect(pinChatRoute).not.toHaveBeenCalled();
        expect(completeText).not.toHaveBeenCalled();
        expect(h.state!.tables.training_defenses[0].questions_status).toBe("ready");
    });

    it.each([
        ["prose", "Aquí van unas preguntas para la defensa."],
        ["four questions", JSON.stringify({ questions: QUESTIONS.slice(0, 4) })],
        ["no change of facts", JSON.stringify({ questions: QUESTIONS.map((q) => ({ ...q, kind: "base" })) })],
        [
            "an article the pupil never cited",
            JSON.stringify({ questions: [question("base", "¿Aplica el artículo 2000?"), ...QUESTIONS.slice(1)] }),
        ],
    ])("are failed, with nothing written, on %s", async (_label, answer) => {
        vi.mocked(completeText).mockResolvedValue(answer);
        const defense = await newDefense();
        const res = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ questions_status: "failed", questions: null });
        expect(h.state!.tables.training_defenses[0].questions ?? null).toBeNull();
    });

    it("run one at a time", async () => {
        const defense = await newDefense();
        Object.assign(h.state!.tables.training_defenses[0], { questions_status: "pending", updated_at: new Date().toISOString() });
        const res = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("training_review_in_progress");
        expect(completeText).not.toHaveBeenCalled();
    });

    it("need some work of the pupil the mentor can see", async () => {
        h.state!.tables.training_turn_notes = [];
        const defense = await newDefense();
        expect((await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({})).status).toBe(400);
        expect(completeText).not.toHaveBeenCalled();
    });

    it("rest only on works in the defense's practice area the mentor can open", async () => {
        const defense = await newDefense({ practice: "laboral" });
        // The only laboral work is in a matter the mentor cannot open.
        expect((await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({})).status).toBe(400);
        h.openable.add(`${PROJECT}:${MENTOR}`);
        expect((await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({})).body.questions_status).toBe("ready");
        expect(vi.mocked(recordChatEgress).mock.calls[0][1]).toMatchObject({ chatId: null });
    });
});

describe("the outcome", () => {
    it("is recorded once, also without questions", async () => {
        const defense = await newDefense();
        const outcome = `${defenses}/${defense.id}/outcome`;
        const first = await as(MENTOR).put(outcome).send({ outcome: "approved", reason: "razonamiento_solido", note: NOTE });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
            questions_status: "none",
            outcome: "approved",
            outcome_reason: "razonamiento_solido",
            outcome_note: NOTE,
            held_at: expect.any(String),
        });
        const again = await as(MENTOR).put(outcome).send({ outcome: "not_approved", reason: "otro" });
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("training_defense_already_recorded");
        expect(h.state!.tables.training_defenses[0]).toMatchObject({ outcome: "approved", recorded_by: MENTOR });
        // No questions after the fact either.
        const questions = await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        expect(questions.status).toBe(409);
        expect(questions.body.code).toBe("training_defense_already_recorded");
        expect(completeText).not.toHaveBeenCalled();
    });

    it.each([
        ["no outcome", { reason: "otro" }],
        ["an unknown outcome", { outcome: "maybe", reason: "otro" }],
        ["no reason", { outcome: "approved" }],
        ["a reason outside the list", { outcome: "approved", reason: "excelente" }],
        ["a note over 500 characters", { outcome: "approved", reason: "otro", note: "x".repeat(501) }],
    ])("refuses %s", async (_label, body) => {
        const defense = await newDefense();
        expect((await as(MENTOR).put(`${defenses}/${defense.id}/outcome`).send(body)).status).toBe(400);
        expect(h.state!.tables.training_defenses[0].outcome ?? null).toBeNull();
    });

    it("keeps the questions, reason and note from the pupil until it is recorded", async () => {
        const defense = await newDefense();
        await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        const me = () => as(PUPIL).get(`/training/me/supervision?org_id=${ORG}`);
        const before = (await me()).body.defenses[0];
        expect(before).toMatchObject({ id: defense.id, questions_status: "ready", questions: null, outcome: null });
        await as(MENTOR).put(`${defenses}/${defense.id}/outcome`).send({ outcome: "not_approved", reason: "sin_sustento", note: NOTE });
        const after = (await me()).body.defenses[0];
        expect(after.questions).toHaveLength(5);
        expect(after).toMatchObject({ outcome: "not_approved", outcome_reason: "sin_sustento", outcome_note: NOTE });
    });
});

describe("audit", () => {
    it("records the defense's id only: never its outcome, reason, note or questions", async () => {
        const defense = await newDefense({ work_review_id: REVIEW });
        await as(MENTOR).post(`${defenses}/${defense.id}/questions`).send({});
        await as(MENTOR).put(`${defenses}/${defense.id}/outcome`).send({ outcome: "approved", reason: "razonamiento_solido", note: NOTE });
        const events = trainingEvents();
        expect(events.map((event) => event.action)).toEqual(["training.defense_created", "training.defense_recorded"]);
        for (const event of events) {
            expect(event).toMatchObject({ userId: MENTOR, orgId: ORG, surface: "organization" });
            expect(event.detail).toEqual({ org_id: ORG, target_user_id: PUPIL, defense_id: defense.id });
        }
        const logged = JSON.stringify([events, vi.mocked(recordChatEgress).mock.calls.map(([, e]) => e.extra)]);
        for (const text of [NOTE, "razonamiento_solido", "approved", ATTEMPT, "cumplimiento forzoso", "plazo"])
            expect(logged).not.toContain(text);
    });
});

describe("promotion by evidence", () => {
    async function earnEvidence() {
        const t = h.state!.tables;
        for (const [i, chatId] of [id(210), id(211), id(212)].entries()) {
            t.chats.push({ id: chatId, project_id: null, title: `Trabajo ${i}` });
            t.training_work_reviews.push(review(id(610 + i), chatId, new Date().toISOString()));
        }
        for (let i = 0; i < 2; i++) {
            const defense = await newDefense();
            await as(MENTOR).put(`${defenses}/${defense.id}/outcome`).send({ outcome: "approved", reason: "razonamiento_solido" });
        }
        vi.mocked(recordAudit).mockClear();
    }

    it("proposes nothing without evidence, and says what is needed", async () => {
        const res = await as(MENTOR).get(promotion);
        expect(res.status).toBe(200);
        expect(res.body.proposals).toEqual([
            expect.objectContaining({
                practice: null,
                from: "pasante",
                to: "junior",
                proposed: false,
                approved_defenses: [],
                reviewed_works: [],
                required: { approved_defenses: 2, reviewed_works: 3 },
            }),
        ]);
        const refused = await as(MENTOR).post(promotion).send({ practice: null, to: "junior" });
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe("training_promotion_not_proposed");
        expect(h.state!.tables.training_stages[0].stage).toBe("pasante");
        expect(trainingEvents()).toEqual([]);
    });

    it("proposes with the evidence, and the mentor's acceptance goes through setStage", async () => {
        await earnEvidence();
        const proposal = (await as(MENTOR).get(promotion)).body.proposals[0];
        expect(proposal).toMatchObject({ proposed: true, to: "junior" });
        expect(proposal.approved_defenses).toHaveLength(2);
        expect(proposal.reviewed_works).toHaveLength(3);
        const res = await as(MENTOR).post(promotion).send({ practice: null, to: "junior" });
        expect(res.status).toBe(200);
        expect(h.state!.tables.training_stages[0]).toMatchObject({ stage: "junior", updated_by: MENTOR });
        expect(trainingEvents().map((event) => event.action)).toEqual(["training.stage_set", "training.promotion_accepted"]);
        for (const event of trainingEvents()) expect(event.detail).toEqual({ org_id: ORG, target_user_id: PUPIL });
        // The stage changed: the evidence starts again.
        expect(res.body.proposals[0]).toMatchObject({ from: "junior", to: "abogado", proposed: false });
    });

    it("turns a junior into a lawyer through removeStage", async () => {
        h.state!.tables.training_stages[0].stage = "junior";
        await earnEvidence();
        const res = await as(MENTOR).post(promotion).send({ practice: null, to: "abogado" });
        expect(res.status).toBe(200);
        expect(h.state!.tables.training_stages).toHaveLength(0);
        expect(res.body.proposals).toEqual([]);
    });

    it("counts a marked review only when the mentor can open its matter", async () => {
        await earnEvidence();
        // Two of the three reviewed works move into the closed matter.
        for (const chat of h.state!.tables.chats.filter((c) => [id(210), id(211)].includes(String(c.id))))
            chat.project_id = PROJECT;
        expect((await as(MENTOR).get(promotion)).body.proposals[0]).toMatchObject({ proposed: false });
        expect((await as(MENTOR).get(promotion)).body.proposals[0].reviewed_works).toHaveLength(1);
    });

    it("refuses a proposal that is no longer in force", async () => {
        await earnEvidence();
        const defense = await newDefense();
        await as(MENTOR).put(`${defenses}/${defense.id}/outcome`).send({ outcome: "not_approved", reason: "razonamiento_incompleto" });
        expect((await as(MENTOR).get(promotion)).body.proposals[0]).toMatchObject({
            proposed: false,
            blocked_by: "not_approved_after",
        });
        expect((await as(MENTOR).post(promotion).send({ practice: null, to: "junior" })).status).toBe(409);
        expect(h.state!.tables.training_stages[0].stage).toBe("pasante");
    });
});
