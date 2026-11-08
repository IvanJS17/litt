import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The two-minute review (training layer 2) over HTTP, against an in-memory
// database whose training_can_read_learning is the SQL rule's own statement
// (the pupil, or their current mentor, both members). The SQL function itself
// is covered against PostgreSQL in performance.litt-training-supervision.sql.
// The mentor's BYOK route, the model call and the matter rule are stubbed at
// their facades so each test can see exactly what was (not) called.
const h = vi.hoisted(() => {
    // Every test here generates reviews; the chat lane's budget is not under test.
    process.env.RATE_LIMIT_CHAT_MAX = "10000";
    return {
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
    leaky: { owners: false },
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
const ASSISTANT_MSG = id(400);
const VERSION_HELD = id(500);
const VERSION_APPROVED = id(501);

const ATTEMPT = "Considero que procede la rescisión por falta de pago, con base en lo pactado en el contrato.";
const CONTRAST = "Coincide\n- La vía\nNo coincide\n- El plazo aplicable\nFaltó\n- Revisar la cláusula penal";
const MENTOR_ROUTE = { provider: "claude", model: "mentor-model", credentialRef: `user:${MENTOR}:claude:v1` };
const MENTOR_KEYS = { claude: "mentor-secret", disabledProviders: ["openai"] };
const MODEL_ANSWER = JSON.stringify({
    ai_corrected: [{ text: "El plazo aplicable era otro", note: "N1" }],
    doubts: [{ text: "Rechazó la edición propuesta" }],
});

function seed() {
    const now = new Date().toISOString();
    h.state = memoryDb(
        {
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
            training_turn_notes: [
                note("n1", { chat_id: CHAT }, now),
                note("n2", { chat_id: MATTER_CHAT }, now),
            ],
            chats: [
                { id: CHAT, project_id: null, title: "Rescisión" },
                { id: MATTER_CHAT, project_id: PROJECT, title: "Asunto privado" },
            ],
            chat_messages: [
                { id: id(401), chat_id: CHAT, role: "user", content: null, citations: null },
                {
                    id: ASSISTANT_MSG,
                    chat_id: CHAT,
                    role: "assistant",
                    content: [
                        { type: "doc_created", version_id: VERSION_HELD },
                        { type: "doc_edited", version_id: VERSION_APPROVED },
                    ],
                    citations: [
                        { verified: true, filename: "contrato.pdf", quote: "verificada" },
                        { verified: false, filename: "contrato.pdf", quote: "la pena convencional" },
                    ],
                },
            ],
            document_edits: [
                { chat_message_id: ASSISTANT_MSG, version_id: VERSION_APPROVED, status: "rejected" },
            ],
            document_versions: [
                version(VERSION_HELD, "borrador.docx", "h1"),
                version(VERSION_APPROVED, "aprobado.docx", "h2"),
            ],
            training_version_approvals: [{ document_version_id: VERSION_APPROVED, content_sha256: "h2" }],
            training_work_reviews: [],
            user_profiles: [{ user_id: MENTOR, email: `${MENTOR}@test.local` }],
        },
        {
            // training_can_read_learning, as 20261107_60 states it.
            training_can_read_learning: ({ p_actor, p_org, p_trainee }, tables) => {
                const member = (user: unknown) =>
                    tables.org_members.some((m) => m.org_id === p_org && m.user_id === user);
                if (!member(p_actor) || !member(p_trainee)) return false;
                if (p_actor === p_trainee) return true;
                if (
                    tables.training_pupils.some(
                        (p) => p.org_id === p_org && p.trainee_user_id === p_trainee && p.mentor_user_id === p_actor,
                    )
                )
                    return true;
                // The negative control's leak: owners and admins too.
                return (
                    h.leaky.owners &&
                    tables.org_members.some(
                        (m) => m.org_id === p_org && m.user_id === p_actor && ["owner", "admin"].includes(String(m.role)),
                    )
                );
            },
        },
    );
}
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
function version(versionId: string, filename: string, sha: string): Row {
    return {
        id: versionId,
        filename,
        training_stage: "pasante",
        training_author_user_id: PUPIL,
        content_sha256: sha,
        deleted_at: null,
    };
}

const works = `/orgs/${ORG}/training/pupils/${PUPIL}/works`;
const review = (chat = CHAT) => `${works}/chat/${chat}/review`;
const as = (user: string) => {
    h.caller.id = user;
    return request(app);
};

beforeEach(() => {
    seed();
    h.leaky.owners = false;
    h.openable.clear();
    vi.mocked(recordAudit).mockClear();
    vi.mocked(recordChatEgress).mockClear();
    vi.mocked(completeText).mockReset().mockResolvedValue(MODEL_ANSWER);
    vi.mocked(resolveUserChatSelection).mockReset().mockResolvedValue({
        ok: true,
        selectedModel: "mentor-model",
    } as never);
    vi.mocked(listChatCredentialOptions).mockReset().mockResolvedValue({
        provider: "claude",
        options: [{ credential_ref: MENTOR_ROUTE.credentialRef, source: "personal" }],
        default: MENTOR_ROUTE.credentialRef,
    } as never);
    vi.mocked(pinChatRoute).mockReset().mockResolvedValue({
        ok: true,
        route: MENTOR_ROUTE,
        apiKeys: MENTOR_KEYS,
    } as never);
    vi.mocked(loadPinnedChatRoute).mockReset().mockResolvedValue({
        ok: true,
        route: MENTOR_ROUTE,
        apiKeys: MENTOR_KEYS,
    } as never);
});

describe("privacy by role", () => {
    const denied: [string, string][] = [
        ["the former mentor", FORMER_MENTOR],
        ["an owner", OWNER],
        ["an admin", ADMIN],
        ["another member", MEMBER],
        ["someone from another organization", OUTSIDER],
        ["the pupil, on the mentor's routes", PUPIL],
    ];

    it("lets the current mentor list, generate and mark", async () => {
        const list = await as(MENTOR).get(works);
        expect(list.status).toBe(200);
        expect(list.body.works.map((w: { chat_id: string }) => w.chat_id)).toEqual([CHAT]);
        expect((await as(MENTOR).post(review()).send({})).status).toBe(200);
        expect((await as(MENTOR).put(`${review()}/reviewed`)).status).toBe(200);
    });

    it.each(denied)("answers %s the same 404 on every route", async (_label, user) => {
        // Make the mentor's review exist, so 404 cannot mean "nothing there".
        await as(MENTOR).post(review()).send({});
        vi.mocked(completeText).mockClear();
        const unknown = await as(user).get(`/orgs/${ORG}/training/pupils/${id(999)}/works`);
        for (const res of [
            await as(user).get(works),
            await as(user).post(review()).send({}),
            await as(user).put(`${review()}/reviewed`),
        ]) {
            expect(res.status).toBe(404);
            expect(res.body).toEqual(unknown.body);
        }
        expect(completeText).not.toHaveBeenCalled();
        expect(h.state!.tables.training_work_reviews[0].reviewed_at ?? null).toBeNull();
    });

    it("negative control: a rule that also lets owners read would expose the pupil's works", async () => {
        h.leaky.owners = true;
        const res = await as(OWNER).get(works);
        expect(res.status).toBe(200);
        expect(res.body.works).toHaveLength(1);
    });

    it("stops serving the former mentor the moment the pupil is reassigned", async () => {
        await as(MENTOR).post(review()).send({});
        h.state!.tables.training_pupils[0].mentor_user_id = FORMER_MENTOR;
        expect((await as(MENTOR).get(works)).status).toBe(404);
        const now = await as(FORMER_MENTOR).get(works);
        expect(now.status).toBe(200);
        expect(now.body.works[0].review.status).toBe("ready");
    });

    it("shows the pupil their own reviews, read-only", async () => {
        await as(MENTOR).post(review()).send({});
        const me = await as(PUPIL).get(`/training/me/supervision?org_id=${ORG}`);
        expect(me.status).toBe(200);
        expect(me.body.work_reviews).toHaveLength(1);
        expect(me.body.work_reviews[0]).toMatchObject({ surface: "chat", chat_id: CHAT, word_chat_id: null });
        expect(me.body.work_reviews[0]).not.toHaveProperty("credential_ref");
    });

    it("never answers a score, an average or a ranking", async () => {
        await as(MENTOR).post(review()).send({});
        const text = JSON.stringify((await as(MENTOR).get(works)).body);
        expect(text).not.toMatch(/score|average|promedio|rank|percentile|grade/i);
    });
});

describe("works in a matter the mentor cannot open", () => {
    it("are only counted, and their review and notes are refused", async () => {
        const list = await as(MENTOR).get(works);
        expect(list.body.works_without_access).toBe(1);
        expect(JSON.stringify(list.body)).not.toContain(MATTER_CHAT);
        expect((await as(MENTOR).post(review(MATTER_CHAT)).send({})).status).toBe(404);
        expect((await as(MENTOR).get(`/training-notes/chats/${MATTER_CHAT}`)).status).toBe(404);
        // The pupil still reads their own notes there.
        expect((await as(PUPIL).get(`/training-notes/chats/${MATTER_CHAT}`)).status).toBe(200);
        expect(completeText).not.toHaveBeenCalled();
    });

    it("control: once the mentor can open the matter, the work is theirs to review", async () => {
        h.openable.add(`${PROJECT}:${MENTOR}`);
        const list = await as(MENTOR).get(works);
        expect(list.body.works_without_access).toBe(0);
        expect(list.body.works).toHaveLength(2);
        expect((await as(MENTOR).post(review(MATTER_CHAT)).send({})).status).toBe(200);
        expect((await as(MENTOR).get(`/training-notes/chats/${MATTER_CHAT}`)).status).toBe(200);
    });
});

describe("what the pupil reads is what the mentor sees", () => {
    const readyRow = (chat: Row): Row => ({
        id: id(700),
        org_id: ORG,
        trainee_user_id: PUPIL,
        chat_id: null,
        word_chat_id: null,
        tabular_chat_id: null,
        status: "ready",
        covered_through: new Date().toISOString(),
        proposed: [],
        ai_corrected: [],
        doubts: [],
        unverified: [],
        signals: {},
        updated_at: new Date().toISOString(),
        ...chat,
    });
    const mine = async () =>
        (await as(PUPIL).get(`/training/me/supervision?org_id=${ORG}`)).body.work_reviews.map(
            (r: { chat_id: string }) => r.chat_id,
        );

    it("leaves out the review of a matter the current mentor cannot open", async () => {
        h.state!.tables.training_work_reviews.push(readyRow({ chat_id: MATTER_CHAT }));
        await as(MENTOR).post(review()).send({});
        expect(await mine()).toEqual([CHAT]);
        // The mentor's own tab lists the same single work.
        const list = await as(MENTOR).get(works);
        expect(list.body.works.map((w: { chat_id: string }) => w.chat_id)).toEqual([CHAT]);
    });

    it("control: lists it once the mentor can open that matter", async () => {
        h.state!.tables.training_work_reviews.push(readyRow({ chat_id: MATTER_CHAT }));
        h.openable.add(`${PROJECT}:${MENTOR}`);
        expect(await mine()).toEqual([MATTER_CHAT]);
    });

    it("follows the CURRENT mentor, not the one who generated it", async () => {
        h.state!.tables.training_work_reviews.push(readyRow({ chat_id: MATTER_CHAT }));
        h.openable.add(`${PROJECT}:${MENTOR}`);
        expect(await mine()).toEqual([MATTER_CHAT]);
        h.state!.tables.training_pupils[0].mentor_user_id = FORMER_MENTOR;
        expect(await mine()).toEqual([]);
    });

    it("lists nothing when the pupil has no mentor, since nobody reads it", async () => {
        h.state!.tables.training_work_reviews.push(readyRow({ chat_id: CHAT }));
        h.state!.tables.training_pupils.length = 0;
        expect(await mine()).toEqual([]);
    });
});

describe("the review", () => {
    it("computes what it can and asks the model only to order the rest", async () => {
        const res = await as(MENTOR).post(review()).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            status: "ready",
            surface: "chat",
            chat_id: CHAT,
            word_chat_id: null,
            tabular_chat_id: null,
            model_provider: "claude",
            model: "mentor-model",
            proposed: [{ source: "attempt", text: ATTEMPT, ref: "n1" }],
            ai_corrected: [{ source: "contrast", text: "El plazo aplicable era otro", ref: "n1" }],
            doubts: [{ source: "inferred", text: "Rechazó la edición propuesta", ref: null }],
            signals: {
                notes: 1,
                citations: 2,
                citations_unverified: 1,
                edits_rejected: 1,
                held_versions: 1,
            },
        });
        // Unverified: the citation the server did not verify, the pupil's
        // draft still held (not the approved one) and «Faltó».
        expect(res.body.unverified).toEqual([
            { source: "citation", text: "Cita sin verificar (contrato.pdf): «la pena convencional»", ref: ASSISTANT_MSG },
            { source: "version", text: "Borrador de pasante sin aprobar: borrador.docx", ref: VERSION_HELD },
            { source: "contrast", text: "Faltó: Revisar la cláusula penal", ref: "n1" },
        ]);
        expect(res.body.covered_through).toBe(h.state!.tables.training_turn_notes[0].created_at);
    });

    it("serves a Word work through its own column (chat_id is null there)", async () => {
        const WORD_CHAT = id(202);
        const t = h.state!.tables;
        t.training_turn_notes.push(note("n3", { word_chat_id: WORD_CHAT }, new Date().toISOString()));
        t.word_chats = [{ id: WORD_CHAT, title: "Contrato en Word" }];
        t.word_chat_messages = [{ id: id(410), chat_id: WORD_CHAT, role: "assistant", citations: [{ quote: "sin verificar" }] }];
        const list = await as(MENTOR).get(works);
        expect(list.body.works.map((w: { surface: string }) => w.surface).sort()).toEqual(["chat", "word"]);
        const res = await as(MENTOR).post(`${works}/word/${WORD_CHAT}/review`).send({});
        expect(res.body).toMatchObject({
            status: "ready",
            surface: "word",
            chat_id: null,
            word_chat_id: WORD_CHAT,
            tabular_chat_id: null,
            signals: { citations: 1, citations_unverified: 1, held_versions: 0 },
        });
        // The surface names the table: a Word chat is not found as a web chat.
        expect((await as(MENTOR).post(`${works}/chat/${WORD_CHAT}/review`).send({})).status).toBe(404);
        expect((await as(MENTOR).post(`${works}/nope/${WORD_CHAT}/review`).send({})).status).toBe(404);
    });

    it("marks failed, with nothing written, when the model answers outside the format", async () => {
        vi.mocked(completeText).mockResolvedValue("Claro, aquí tienes un resumen en prosa.");
        const res = await as(MENTOR).post(review()).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "failed", proposed: null, ai_corrected: null, unverified: null });
        const row = h.state!.tables.training_work_reviews[0];
        expect(row).toMatchObject({ status: "failed", proposed: null, ai_corrected: null });
        // A failed review can be generated again; marking it is refused.
        expect((await as(MENTOR).put(`${review()}/reviewed`)).status).toBe(409);
        vi.mocked(completeText).mockResolvedValue(MODEL_ANSWER);
        expect((await as(MENTOR).post(review()).send({})).body.status).toBe("ready");
    });

    it("marks failed when the call itself fails", async () => {
        vi.mocked(completeText).mockRejectedValue(new Error("provider down"));
        const res = await as(MENTOR).post(review()).send({});
        expect(res.body.status).toBe("failed");
    });

    it("runs one generation at a time per work", async () => {
        await as(MENTOR).post(review()).send({});
        const row = h.state!.tables.training_work_reviews[0];
        Object.assign(row, { status: "pending", updated_at: new Date().toISOString() });
        // Whatever a row holds, its lists are shown only once ready.
        expect((await as(MENTOR).get(works)).body.works[0].review).toMatchObject({
            status: "pending",
            proposed: null,
            ai_corrected: null,
            unverified: null,
        });
        const res = await as(MENTOR).post(review()).send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("training_review_in_progress");
    });

    it("lets a stale pending generation be claimed again", async () => {
        await as(MENTOR).post(review()).send({});
        Object.assign(h.state!.tables.training_work_reviews[0], {
            status: "pending",
            updated_at: "2026-01-01T00:00:00.000Z",
        });
        expect((await as(MENTOR).get(works)).body.works[0].review.status).toBe("failed");
        expect((await as(MENTOR).post(review()).send({})).body.status).toBe("ready");
    });

    it("is marked reviewed once, and a regenerated review must be marked again", async () => {
        await as(MENTOR).post(review()).send({});
        const marked = await as(MENTOR).put(`${review()}/reviewed`);
        expect(marked.body.reviewed_at).toEqual(expect.any(String));
        expect((await as(MENTOR).put(`${review()}/reviewed`)).body.reviewed_at).toBe(marked.body.reviewed_at);
        expect((await as(MENTOR).post(review()).send({})).body.reviewed_at).toBeNull();
    });
});

describe("the mentor's BYOK route, without fallback", () => {
    it("generates on the mentor's route, recording the egress first", async () => {
        await as(MENTOR).post(review()).send({ credential_ref: MENTOR_ROUTE.credentialRef });
        expect(pinChatRoute).toHaveBeenCalledWith(expect.anything(), {
            userId: MENTOR,
            orgId: ORG,
            model: "mentor-model",
            requestedCredentialRef: MENTOR_ROUTE.credentialRef,
        });
        expect(completeText).toHaveBeenCalledTimes(1);
        expect(vi.mocked(completeText).mock.calls[0][0]).toMatchObject({
            model: "mentor-model",
            apiKeys: MENTOR_KEYS,
        });
        expect(vi.mocked(recordChatEgress).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(completeText).mock.invocationCallOrder[0],
        );
        const egress = vi.mocked(recordChatEgress).mock.calls[0][1];
        expect(egress).toMatchObject({ userId: MENTOR, orgId: ORG, chatId: CHAT, surface: "training_supervision" });
        expect(Object.keys(egress.extra ?? {})).toEqual(["work_review_id"]);
        // The route is stored on the row: identifiers only.
        expect(h.state!.tables.training_work_reviews[0]).toMatchObject({
            model_provider: "claude",
            model: "mentor-model",
            credential_ref: MENTOR_ROUTE.credentialRef,
            generated_by: MENTOR,
        });
    });

    it("is not offered, and never calls a model, when the mentor has no key", async () => {
        vi.mocked(listChatCredentialOptions).mockResolvedValue({ provider: "claude", options: [], default: null } as never);
        const list = await as(MENTOR).get(works);
        expect(list.body.generation).toEqual({ available: false, code: "training_review_key_required" });
        const res = await as(MENTOR).post(review()).send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("training_review_key_required");
        expect(pinChatRoute).not.toHaveBeenCalled();
        expect(recordChatEgress).not.toHaveBeenCalled();
        expect(completeText).not.toHaveBeenCalled();
        expect(h.state!.tables.training_work_reviews).toHaveLength(0);
    });

    it("is not offered when the mentor has no usable model either", async () => {
        vi.mocked(resolveUserChatSelection).mockResolvedValue({ ok: false, status: 400, code: "model_required", detail: "x" } as never);
        expect((await as(MENTOR).get(works)).body.generation.available).toBe(false);
        expect((await as(MENTOR).post(review()).send({})).body.code).toBe("training_review_key_required");
        expect(completeText).not.toHaveBeenCalled();
    });

    it("fails closed when the stored route no longer serves the caller, trying nothing else", async () => {
        await as(MENTOR).post(review()).send({});
        vi.mocked(pinChatRoute).mockClear();
        vi.mocked(completeText).mockClear();
        vi.mocked(recordChatEgress).mockClear();
        vi.mocked(loadPinnedChatRoute).mockResolvedValue({
            ok: false,
            status: 409,
            code: "chat_route_credential_unavailable",
            detail: "gone",
        } as never);
        const res = await as(MENTOR).post(review()).send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("chat_route_credential_unavailable");
        expect(loadPinnedChatRoute).toHaveBeenCalledWith(expect.anything(), {
            userId: MENTOR,
            orgId: ORG,
            route: MENTOR_ROUTE,
        });
        expect(pinChatRoute).not.toHaveBeenCalled();
        expect(recordChatEgress).not.toHaveBeenCalled();
        expect(completeText).not.toHaveBeenCalled();
        // The ready review is untouched.
        expect(h.state!.tables.training_work_reviews[0].status).toBe("ready");
    });

    it("passes a refused explicit key through, without another key", async () => {
        vi.mocked(pinChatRoute).mockResolvedValue({
            ok: false,
            status: 409,
            code: "chat_route_credential_unavailable",
            detail: "gone",
        } as never);
        const res = await as(MENTOR).post(review()).send({ credential_ref: `org:${ORG}:claude:v3` });
        expect(res.status).toBe(409);
        expect(pinChatRoute).toHaveBeenCalledTimes(1);
        expect(completeText).not.toHaveBeenCalled();
    });

    it("rejects a malformed credential reference", async () => {
        const res = await as(MENTOR).post(review()).send({ credential_ref: "not a ref" });
        expect(res.status).toBe(400);
        expect(completeText).not.toHaveBeenCalled();
    });
});

describe("audit", () => {
    it("records identifiers only, never the pupil's text or the review", async () => {
        await as(MENTOR).post(review()).send({});
        await as(MENTOR).put(`${review()}/reviewed`);
        const events = vi.mocked(recordAudit).mock.calls
            .map(([, event]) => event)
            .filter((event) => event.action.startsWith("training."));
        expect(events.map((event) => event.action)).toEqual([
            "training.work_review_generated",
            "training.work_review_marked",
        ]);
        for (const event of events) {
            expect(event).toMatchObject({ userId: MENTOR, orgId: ORG, chatId: CHAT, surface: "organization" });
            expect(Object.keys(event.detail ?? {}).sort()).toEqual(["org_id", "target_user_id"]);
        }
        const logged = JSON.stringify([events, vi.mocked(recordChatEgress).mock.calls.map(([, e]) => e.extra)]);
        for (const text of [ATTEMPT, "plazo aplicable", "cláusula penal", "pena convencional", "Rechazó"])
            expect(logged).not.toContain(text);
    });
});
