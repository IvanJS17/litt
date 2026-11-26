import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { getMyCriteriaContrasts, getPupilCriteriaContrasts } from "../training-criteria-contrast/trainingCriteriaContrast.service";
import { getPupilBacking } from "../training-backing/trainingBacking.service";
import { getChatTurnNotes } from "../training-notes/trainingNotes.service";
import { getMySupervision } from "./trainingSupervision.service";

// What the pupil reads of their own work in a matter is computed from the
// matter's documents (reviews, the questions of a defense, the contrast of an
// approach with the answer). They read it only while they can open that matter
// now, by the same test that lets their mentor read it. What they wrote
// themselves is theirs and stays.
const matters = vi.hoisted(() => ({ open: new Set<string>() }));
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => ({ ok: matters.open.has(`${projectId}:${userId}`) })),
    loadOpenableProjects: vi.fn(async (_db: unknown, userId: string, _email: unknown, projectIds: string[]) =>
        new Map(projectIds.filter((projectId) => matters.open.has(`${projectId}:${userId}`)).map((projectId) => [projectId, { orgId: null }])),
    ),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const PUPIL = id(1);
const MENTOR = id(2);
const OPEN_MATTER = id(30);
const CLOSED_MATTER = id(31);
const OPEN_CHAT = id(50);
const CLOSED_CHAT = id(51);

const review = (n: number, chat: string): Row => ({
    id: id(n), org_id: ORG, trainee_user_id: PUPIL, chat_id: chat, word_chat_id: null, tabular_chat_id: null,
    status: "ready", covered_through: `2026-11-1${n % 10}T10:00:00Z`, updated_at: "2026-11-10T10:00:00Z",
    proposed: [{ text: `Hallazgo del asunto ${chat}` }], ai_corrected: null, doubts: null, unverified: null, signals: {},
});
const defense = (n: number, over: Row): Row => ({
    id: id(n), org_id: ORG, trainee_user_id: PUPIL, practice: null, work_review_id: null,
    questions: [{ kind: "base", text: "Pregunta sobre Acme", listen_for: "razón" }], questions_status: "ready",
    outcome: "approved", outcome_reason: "razonamiento_solido", outcome_note: "Nota sobre Acme",
    held_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z", ...over,
});
const contrast = (n: number, chat: string): Row => ({
    id: id(n), org_id: ORG, trainee_user_id: PUPIL, chat_id: chat, message_id: id(70), routes: [{ name: "a", status: "ready" }],
    briefs: ["brief sobre Acme"], status: "ready", person_explanation: "mi propia explicación",
    comparison: "comparación sobre Acme", created_at: "2026-11-10T10:00:00Z",
});
const note = (n: number, column: string, chat: string): Row => ({
    id: id(n), org_id: ORG, trainee_user_id: PUPIL, message_id: id(70), attempt: "mi propio enfoque",
    contrast: "contraste sobre Acme", contrast_status: "ready", created_at: "2026-11-10T10:00:00Z", [column]: chat,
    confidence: 3, foundation_question: "pregunta sobre Acme", topics: ["tema de Acme"],
});

function world(extra: Record<string, Row[]> = {}) {
    return memoryDb(
        {
            training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
            user_profiles: [{ user_id: MENTOR, email: "mentor@example.test" }],
            training_work_reviews: [review(40, OPEN_CHAT), review(41, CLOSED_CHAT)],
            training_defenses: [],
            training_urgency_passes: [],
            training_criteria_contrasts: [],
            training_turn_notes: [],
            chats: [
                { id: OPEN_CHAT, project_id: OPEN_MATTER, title: "abierto" },
                { id: CLOSED_CHAT, project_id: CLOSED_MATTER, title: "cerrado" },
            ],
            ...extra,
        },
        { training_can_read_learning: () => true },
    );
}

beforeEach(() => {
    // The mentor can open both matters; the pupil only the first.
    matters.open = new Set([`${OPEN_MATTER}:${PUPIL}`, `${OPEN_MATTER}:${MENTOR}`, `${CLOSED_MATTER}:${MENTOR}`]);
});

const supervision = async (extra: Record<string, Row[]> = {}) => {
    const result = await getMySupervision(world(extra).db, { userId: PUPIL, userEmail: "pupil@example.test", orgId: ORG } as never);
    if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
    return result.data;
};

describe("the pupil's own supervision view", () => {
    it("lists the reviews of works in matters the pupil can open and leaves out the others", async () => {
        const data = await supervision();
        expect(data.work_reviews.map((r) => r.chat_id)).toEqual([OPEN_CHAT]);
        expect(JSON.stringify(data)).not.toContain(CLOSED_CHAT);
    });

    it("lists every review to a pupil who can open both matters", async () => {
        matters.open.add(`${CLOSED_MATTER}:${PUPIL}`);
        const data = await supervision();
        expect(data.work_reviews.map((r) => r.chat_id).sort()).toEqual([OPEN_CHAT, CLOSED_CHAT].sort());
    });

    it("withholds the questions and the note of a defense on work in a matter the pupil can no longer open", async () => {
        const data = await supervision({
            training_defenses: [defense(60, { work_review_id: id(40) }), defense(61, { work_review_id: id(41) })],
        });
        const byId = new Map(data.defenses.map((d) => [d.id, d]));
        expect(byId.get(id(60))!.questions).toHaveLength(1);
        expect(byId.get(id(60))!.outcome_note).toBe("Nota sobre Acme");
        expect(byId.get(id(61))).toMatchObject({ questions: null, outcome_note: null, outcome: "approved" });
    });
});

describe("the pupil's own criteria contrasts", () => {
    const mine = async (rows: Row[]) => {
        const result = await getMyCriteriaContrasts(world({ training_criteria_contrasts: rows }).db, {
            userId: PUPIL,
            userEmail: "pupil@example.test",
        } as never);
        if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
        return new Map(result.data.contrasts.map((c) => [c.id, c]));
    };

    it("keeps what the pupil wrote and withholds what was computed from a matter they can no longer open", async () => {
        const byId = await mine([contrast(80, OPEN_CHAT), contrast(81, CLOSED_CHAT)]);
        expect(byId.get(id(80))).toMatchObject({ comparison: "comparación sobre Acme", briefs: ["brief sobre Acme"] });
        expect(byId.get(id(81))).toMatchObject({ person_explanation: "mi propia explicación", comparison: null, briefs: null });
        expect(JSON.stringify([...byId.values()].filter((c) => c.id === id(81)))).not.toContain("Acme");
    });
});

describe("the pupil's own turn notes", () => {
    const mine = async (chat: string) => {
        const result = await getChatTurnNotes(world({ training_turn_notes: [note(90, "chat_id", chat)] }).db, {
            actorId: PUPIL,
            actorEmail: "pupil@example.test",
            chatId: chat,
        });
        if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
        return result.data.notes[0];
    };

    it("shows the contrast of a note in a matter the pupil can open", async () => {
        expect(await mine(OPEN_CHAT)).toMatchObject({ attempt: "mi propio enfoque", contrast: "contraste sobre Acme" });
    });

    it("keeps the pupil's own approach and withholds what was computed when the matter is closed to them", async () => {
        const shown = await mine(CLOSED_CHAT);
        expect(shown).toMatchObject({ attempt: "mi propio enfoque", contrast: null });
        expect(JSON.stringify(shown)).not.toContain("Acme");
    });
});

// A chat's title is written from what the person typed and the files they
// attached (lib/chatReadAccess): the mentor's training screens show it only
// while the mentor can open every file attached to that chat.
describe("the chat titles on the mentor's training screens", () => {
    const CLOSED_DOC = id(90);
    const OPEN_DOC = id(91);
    const mentor = { actorId: MENTOR, actorEmail: "mentor@example.test", orgId: ORG, traineeId: PUPIL };
    const titles = async (attached: string) => {
        const { db } = world({
            training_criteria_contrasts: [contrast(80, OPEN_CHAT)],
            documents: [
                { id: CLOSED_DOC, user_id: PUPIL, project_id: null, org_id: null },
                { id: OPEN_DOC, user_id: MENTOR, project_id: null, org_id: null },
            ],
            chat_messages: [
                { id: id(92), chat_id: OPEN_CHAT, role: "user", content: "pregunta", files: [{ filename: "a.docx", document_id: attached }], created_at: "2026-11-10T10:00:00Z" },
            ],
        });
        const result = await getPupilCriteriaContrasts(db, mentor);
        if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
        return result.data.contrasts.map((c) => c.title);
    };

    it("shows the title of a chat whose attachments the mentor can open", async () => {
        expect(await titles(OPEN_DOC)).toEqual(["abierto"]);
    });

    it("shows no title for a chat with an attachment the mentor cannot open", async () => {
        expect(await titles(CLOSED_DOC)).toEqual([null]);
    });

    it("applies to the titles of the works the mentor reads in the backing view too", async () => {
        const check = (n: number): Row => ({
            id: id(n), org_id: ORG, trainee_user_id: PUPIL, chat_id: OPEN_CHAT, word_chat_id: null, tabular_chat_id: null,
            message_id: id(93), status: "ready", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z",
            conclusions: [{ id: "c1", text: "t", citation_ref: null, status: "unbacked", unverified_references: [], person_verified: false, person_note: null }],
        });
        const titleWith = async (attached: string) => {
            const { db } = world({
                training_backing_checks: [check(95)],
                documents: [
                    { id: CLOSED_DOC, user_id: PUPIL, project_id: null, org_id: null },
                    { id: OPEN_DOC, user_id: MENTOR, project_id: null, org_id: null },
                ],
                chat_messages: [
                    { id: id(92), chat_id: OPEN_CHAT, role: "user", content: "pregunta", files: [{ filename: "a.docx", document_id: attached }], created_at: "2026-11-10T10:00:00Z" },
                    { id: id(93), chat_id: OPEN_CHAT, role: "assistant", content: null, citations: [], created_at: "2026-11-10T10:00:01Z" },
                ],
            });
            const result = await getPupilBacking(db, mentor);
            if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
            return result.data.works.map((work) => work.title);
        };
        expect(await titleWith(OPEN_DOC)).toEqual(["abierto"]);
        expect(await titleWith(CLOSED_DOC)).toEqual([null]);
    });
});
