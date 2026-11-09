import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The gym (training layer 4) over HTTP, against an in-memory database whose
// training_can_read_learning is the SQL rule's own statement. Who may read
// learning data in general is covered by the layer 2 and 3 suites and by
// performance.litt-training-supervision.sql; here only what the gym adds.
const h = vi.hoisted(() => {
    process.env.RATE_LIMIT_CHAT_MAX = "10000";
    return {
        caller: { id: "" },
        state: null as null | { db: unknown; tables: Record<string, Row[]> },
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
import { completeText } from "../../lib/llm";
import {
    listChatCredentialOptions,
    pinChatRoute,
    resolveUserChatSelection,
} from "../../modules/user/user.service";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const PUPIL = id(1);
const MENTOR = id(2);
const OTHER_MENTOR = id(3);
const OWNER = id(4);
const ADMIN = id(5);

const MENTOR_ROUTE = { provider: "claude", model: "mentor-model", credentialRef: `user:${MENTOR}:claude:v1` };
const EXPLANATION = "El artículo fue derogado; la explicación solo se ve al entregar.";
const CASE_BODY = {
    practice: "Mercantil",
    title: "Pagaré ficticio",
    paragraphs: ["Uno.", "Dos.", "Tres.", "Cuatro."],
    errors: [
        { paragraph: 3, kind: "repealed_article", explanation: EXPLANATION, hint: "Revisa la vigencia." },
        { paragraph: 1, kind: "other", explanation: "Otra explicación." },
    ],
    time_limit_minutes: 30,
    fictitious: true,
};

const attemptsUrl = `/orgs/${ORG}/training/pupils/${PUPIL}/gym/attempts`;
const casesUrl = `/orgs/${ORG}/training/gym/cases`;
const mine = (attemptId: string) => `/training/me/gym/attempts/${attemptId}`;
const as = (user: string) => {
    h.caller.id = user;
    return request(app);
};
const rows = (table: string) => h.state!.tables[table];

beforeEach(() => {
    h.state = memoryDb(
        {
            organizations: [{ id: ORG, kind: "team" }],
            org_members: [PUPIL, MENTOR, OTHER_MENTOR].map((user) => ({ org_id: ORG, user_id: user, role: "member" }))
                .concat([{ org_id: ORG, user_id: OWNER, role: "owner" }, { org_id: ORG, user_id: ADMIN, role: "admin" }]),
            training_mentors: [{ org_id: ORG, user_id: MENTOR }, { org_id: ORG, user_id: OTHER_MENTOR }],
            training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
            training_gym_cases: [],
            training_gym_attempts: [],
        },
        {
            // training_can_read_learning, as 20261107_60 states it.
            training_can_read_learning: ({ p_actor, p_org, p_trainee }, tables) => {
                const member = (user: unknown) => tables.org_members.some((m) => m.org_id === p_org && m.user_id === user);
                if (!member(p_actor) || !member(p_trainee)) return false;
                if (p_actor === p_trainee) return true;
                return tables.training_pupils.some(
                    (p) => p.org_id === p_org && p.trainee_user_id === p_trainee && p.mentor_user_id === p_actor,
                );
            },
        },
    );
    vi.mocked(completeText).mockReset();
    vi.mocked(resolveUserChatSelection).mockReset().mockResolvedValue({ ok: true, selectedModel: "mentor-model" } as never);
    vi.mocked(listChatCredentialOptions).mockReset().mockResolvedValue({
        provider: "claude",
        options: [{ credential_ref: MENTOR_ROUTE.credentialRef, source: "personal" }],
        default: MENTOR_ROUTE.credentialRef,
    } as never);
    vi.mocked(pinChatRoute).mockReset().mockResolvedValue({ ok: true, route: MENTOR_ROUTE, apiKeys: { claude: "k" } } as never);
});

/** The mentor writes the case and assigns it; returns the attempt. */
async function assigned() {
    const made = await as(MENTOR).post(casesUrl).send(CASE_BODY);
    expect(made.status).toBe(201);
    const res = await as(MENTOR).post(attemptsUrl).send({ case_id: made.body.id });
    expect(res.status).toBe(201);
    return { caseId: made.body.id as string, attempt: res.body as { id: string } };
}

describe("the gym", () => {
    it("never sends the pupil the errors before submitting, and does after", async () => {
        const { attempt } = await assigned();
        await as(PUPIL).post(`${mine(attempt.id)}/start`).expect(200);
        const saved = await as(PUPIL)
            .put(`${mine(attempt.id)}/findings`)
            .send({ findings: [{ paragraph: 3, kind: "other", note: "Creo que está derogado." }] });
        expect(saved.status).toBe(200);
        for (const body of [
            saved.body,
            (await as(PUPIL).get(mine(attempt.id))).body,
            (await as(PUPIL).get(`/training/me/gym/attempts?org_id=${ORG}`)).body,
        ]) {
            expect(JSON.stringify(body)).not.toContain(EXPLANATION);
            expect(JSON.stringify(body)).not.toContain("repealed_article");
        }
        expect(saved.body).toMatchObject({ errors: null, result: null, status: "in_progress" });
        expect(typeof saved.body.server_now).toBe("string");

        // A hint skips the paragraph already marked and never shows the explanation.
        const hint = await as(PUPIL).post(`${mine(attempt.id)}/hint`);
        expect(hint.status).toBe(409);
        await as(PUPIL).put(`${mine(attempt.id)}/findings`).send({ findings: [] }).expect(200);
        const revealed = await as(PUPIL).post(`${mine(attempt.id)}/hint`);
        expect(revealed.body.hints).toEqual(["Revisa la vigencia."]);
        expect(JSON.stringify(revealed.body)).not.toContain(EXPLANATION);

        await as(PUPIL)
            .put(`${mine(attempt.id)}/findings`)
            .send({ findings: [{ paragraph: 3, kind: "other", note: "" }, { paragraph: 2, kind: "other", note: "" }] })
            .expect(200);
        const done = await as(PUPIL).post(`${mine(attempt.id)}/submit`);
        expect(done.status).toBe(200);
        expect(done.body.errors).toHaveLength(2);
        expect(done.body.result).toEqual({
            found: [{ error_index: 1, paragraph: 3, kind_matches: false }],
            missed: [{ error_index: 0, paragraph: 1 }],
            extra: [{ paragraph: 2 }],
        });
    });

    it("closes an overdue attempt with what was saved and refuses later writes", async () => {
        const { attempt } = await assigned();
        await as(PUPIL).post(`${mine(attempt.id)}/start`).expect(200);
        await as(PUPIL).put(`${mine(attempt.id)}/findings`).send({ findings: [{ paragraph: 1, kind: "other", note: "x" }] }).expect(200);
        const deadline = new Date(Date.now() - 60_000).toISOString();
        Object.assign(rows("training_gym_attempts")[0], { deadline_at: deadline });

        const late = await as(PUPIL).put(`${mine(attempt.id)}/findings`).send({ findings: [] });
        expect(late.status).toBe(409);
        expect(late.body.code).toBe("training_gym_closed");
        expect(rows("training_gym_attempts")[0]).toMatchObject({
            status: "submitted",
            submitted_at: deadline,
            findings: [{ paragraph: 1, kind: "other", note: "x" }],
        });
        const read = await as(PUPIL).get(mine(attempt.id));
        expect(read.body).toMatchObject({ status: "submitted", submitted_at: deadline });
        expect(read.body.result.found).toHaveLength(1);
    });

    it("lets only the current mentor in: the owner, an admin and another mentor get 404", async () => {
        const { caseId } = await assigned();
        for (const user of [OWNER, ADMIN, OTHER_MENTOR, PUPIL]) {
            expect((await as(user).get(attemptsUrl)).status).toBe(404);
            expect((await as(user).post(attemptsUrl).send({ case_id: caseId })).status).toBe(404);
        }
        // Cases: only a designated mentor, and only their own.
        for (const user of [OWNER, ADMIN, PUPIL]) {
            expect((await as(user).get(casesUrl)).status).toBe(404);
            expect((await as(user).post(casesUrl).send(CASE_BODY)).status).toBe(404);
        }
        expect((await as(OTHER_MENTOR).put(`${casesUrl}/${caseId}`).send(CASE_BODY)).status).toBe(404);
        expect((await as(OTHER_MENTOR).delete(`${casesUrl}/${caseId}`)).status).toBe(404);
        expect((await as(OTHER_MENTOR).get(casesUrl)).body).toEqual([]);
        expect((await as(MENTOR).get(attemptsUrl)).body[0].errors).toHaveLength(2);
        // Nobody else's attempt is the pupil's.
        const [row] = rows("training_gym_attempts");
        expect((await as(OWNER).get(mine(row.id as string))).status).toBe(404);
    });

    it("gives another attempt only after the previous one was submitted", async () => {
        const { caseId, attempt } = await assigned();
        const again = await as(MENTOR).post(attemptsUrl).send({ case_id: caseId });
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("training_gym_attempt_open");

        await as(PUPIL).post(`${mine(attempt.id)}/start`).expect(200);
        await as(PUPIL).post(`${mine(attempt.id)}/submit`).expect(200);
        expect((await as(MENTOR).post(attemptsUrl).send({ case_id: caseId })).status).toBe(201);
        expect(rows("training_gym_attempts")).toHaveLength(2);

        // Deleting the case keeps the history: the attempts hold their copy.
        expect((await as(MENTOR).delete(`${casesUrl}/${caseId}`)).status).toBe(204);
        expect(rows("training_gym_attempts")[0]).toMatchObject({ title: CASE_BODY.title });
    });

    it("fails the AI draft when the answer cannot be read, and saves nothing", async () => {
        const body = { practice: "mercantil", topic: "Pagaré", error_count: 1 };
        vi.mocked(completeText).mockResolvedValue("Aquí tienes un caso: {no es json");
        const failed = await as(MENTOR).post(`${casesUrl}/draft`).send(body);
        expect(failed.status).toBe(503);
        expect(rows("training_gym_cases")).toHaveLength(0);

        vi.mocked(completeText).mockResolvedValue(
            JSON.stringify({
                title: "Borrador",
                paragraphs: ["Uno.", "Dos."],
                errors: [{ paragraph: 2, kind: "invented_citation", explanation: "Cita inventada.", hint: "Busca la cita." }],
            }),
        );
        const draft = await as(MENTOR).post(`${casesUrl}/draft`).send(body);
        expect(draft.status).toBe(200);
        expect(draft.body).toMatchObject({ practice: "mercantil", fictitious: true, time_limit_minutes: 30 });
        expect(rows("training_gym_cases")).toHaveLength(0);

        // The wrong number of errors is not repaired either.
        const two = await as(MENTOR).post(`${casesUrl}/draft`).send({ ...body, error_count: 2 });
        expect(two.status).toBe(503);
    });
});
