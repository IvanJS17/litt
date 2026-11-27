import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    MENTOR_ACTOR,
    OPEN_DOCUMENT_ONLY,
    ORG,
    PUPIL,
    PUPIL_EMAIL,
    RETAKE,
    WITHHELD_SOURCE,
    trainingWorld,
} from "../../__tests__/helpers/wordChatTrainingWorld";

// What would be sent to the model, and the route it would be sent on.
const { sent } = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("../../lib/trainingSupervisionAi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/trainingSupervisionAi")>()),
    completeSupervision: vi.fn(async (args: { user: string }) => {
        sent.push(args.user);
        return JSON.stringify({ question: "¿Qué dice la cláusula?" });
    }),
}));
vi.mock("./trainingCriterion.retakeRoute", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./trainingCriterion.retakeRoute")>()),
    retakeRoute: vi.fn(async () => ({ ok: true, data: { route: { model: "m", model_provider: "p", credential_ref: null }, apiKeys: {} } })),
}));
vi.mock("../user/user.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../user/user.service")>()),
    recordChatEgress: vi.fn(async () => undefined),
    chatRouteColumns: vi.fn(() => ({})),
}));

import { getMyCriterion, getPupilCriterion } from "./trainingCriterion.view";
import { answerRetake, startRetake } from "./trainingCriterion.retakes";

const person = { userId: PUPIL, userEmail: PUPIL_EMAIL };
const NOW = Date.UTC(2026, 10, 20);
const ANSWER = "Mi respuesta explica con detalle lo que dice la cláusula y por qué importa para el caso en cuestión.";

beforeEach(() => {
    sent.length = 0;
});

describe("the mentor's criterion view and a Word chat's sources", () => {
    it("shows no topic label and no retake made from notes whose source is withheld", async () => {
        const result = await getPupilCriterion(trainingWorld(WITHHELD_SOURCE).db, { ...MENTOR_ACTOR, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        const text = JSON.stringify(result.data);
        expect(text).not.toContain("Topic Label");
        expect(text).not.toContain("RETAKE-QUESTION");
        expect(text).not.toContain("RETAKE-CONTRAST");
    });

    it("shows the label and the retake when the answers read only the open document", async () => {
        const result = await getPupilCriterion(trainingWorld(OPEN_DOCUMENT_ONLY).db, { ...MENTOR_ACTOR, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        const text = JSON.stringify(result.data);
        expect(text).toContain("Topic Label");
        expect(text).toContain("RETAKE-QUESTION");
        expect(text).toContain("RETAKE-CONTRAST");
    });
});

describe("the pupil's own criterion and a Word chat's sources", () => {
    it("shows no topic label and no retake text for notes whose source is withheld", async () => {
        const result = await getMyCriterion(trainingWorld(WITHHELD_SOURCE).db, { userId: PUPIL, orgId: ORG, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        const text = JSON.stringify(result.data);
        expect(text).not.toContain("Topic Label");
        expect(text).not.toContain("RETAKE-QUESTION");
        expect(text).not.toContain("RETAKE-CONTRAST");
        // the retake is still listed, marked as withheld, without its text
        expect(result.data.retakes).toHaveLength(1);
        expect(result.data.retakes[0]).toMatchObject({ text_hidden: true, topic_key: "", topic_label: "", question: null, answer: null, contrast: null });
    });

    it("shows them when the answers read only the open document", async () => {
        const result = await getMyCriterion(trainingWorld(OPEN_DOCUMENT_ONLY).db, { userId: PUPIL, orgId: ORG, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        expect(result.data.retakes[0]).toMatchObject({ text_hidden: false });
        const text = JSON.stringify(result.data);
        expect(text).toContain("Topic Label");
        expect(text).toContain("RETAKE-QUESTION");
    });
});

describe("what a retake sends to the model", () => {
    it("starting one sends no note whose source is withheld", async () => {
        const world = trainingWorld(WITHHELD_SOURCE, { training_retakes: [] });
        const result = await startRetake(world.db, { ...person, orgId: ORG, body: { topic_key: "topic label" }, now: NOW });
        expect(result).toMatchObject({ ok: false, code: "training_retake_not_due" });
        expect(sent.join("\n")).not.toContain("ATTEMPT-TEXT");
    });

    it("starting one sends the notes when the answers read only the open document", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_retakes: [] });
        const result = await startRetake(world.db, { ...person, orgId: ORG, body: { topic_key: "topic label" }, now: NOW });
        expect(result.ok).toBe(true);
        expect(sent.join("\n")).toContain("ATTEMPT-TEXT");
    });

    it("a topic whose notes are mostly of a work with a withheld source is not due, by the notes that can be seen", async () => {
        const OTHER_CHAT = "00000000-0000-4000-8000-0000000000d1";
        const base = trainingWorld(WITHHELD_SOURCE).tables;
        const world = trainingWorld(WITHHELD_SOURCE, {
            training_retakes: [],
            word_chats: [...base.word_chats, { id: OTHER_CHAT, user_id: PUPIL, title: "other" }],
            word_chat_messages: [
                ...base.word_chat_messages,
                { id: "00000000-0000-4000-8000-0000000000d2", chat_id: OTHER_CHAT, role: "user", files: null, citations: null, content: "typed", created_at: "2026-11-10T10:00:01Z" },
                { id: "00000000-0000-4000-8000-0000000000d3", chat_id: OTHER_CHAT, role: "assistant", files: null, citations: null, content: [...OPEN_DOCUMENT_ONLY, { type: "content", text: "a" }], created_at: "2026-11-10T10:00:02Z" },
            ],
            // two notes of the work with the withheld source, one of the work that read only the open document
            training_turn_notes: base.training_turn_notes.map((note, index) => (index === 2 ? { ...note, word_chat_id: OTHER_CHAT } : note)),
        });
        const result = await startRetake(world.db, { ...person, orgId: ORG, body: { topic_key: "topic label" }, now: NOW });
        expect(result).toMatchObject({ ok: false, code: "training_retake_not_due" });
        expect(sent).toEqual([]);
    });

    const open = (extra: Record<string, unknown> = {}) => ({
        training_retakes: [{
            id: RETAKE, org_id: ORG, trainee_user_id: PUPIL, topic_key: "topic label", topic_label: "Topic Label", status: "open",
            question: "¿Qué dice la cláusula?", contrast: null, answer: null, verdict: null,
            source_note_ids: ["00000000-0000-4000-8000-000000000050"], created_at: "2026-11-11T10:00:00Z", updated_at: "2026-11-11T10:00:00Z", answered_at: null, ...extra,
        }],
    });

    it("answering one whose source is withheld is refused as a retake that is not waiting for an answer, and sends nothing", async () => {
        const world = trainingWorld(WITHHELD_SOURCE, open());
        const result = await answerRetake(world.db, { ...person, retakeId: RETAKE, body: { answer: ANSWER } });
        expect(result).toMatchObject({ ok: false, kind: "conflict", code: "training_retake_not_open" });
        expect(sent.join("\n")).not.toContain("ATTEMPT-TEXT");
    });

    it("answering one sends the note when the answers read only the open document", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, open());
        // (the stub answers with a question, so the judgement itself is not parsed: what matters is what was sent)
        await answerRetake(world.db, { ...person, retakeId: RETAKE, body: { answer: ANSWER } });
        expect(sent.join("\n")).toContain("ATTEMPT-TEXT-0");
    });
});

describe("a retake whose text is withheld holds no slot and shows no verdict", () => {
    const SECOND_CHAT = "00000000-0000-4000-8000-0000000000e1";
    const SECOND_NOTES = [0, 1, 2].map((n) => `00000000-0000-4000-8000-0000000000e${n + 2}`);
    const retakeOf = (noteIds: string[], over: Record<string, unknown> = {}) => ({
        id: RETAKE, org_id: ORG, trainee_user_id: PUPIL, topic_key: "topic label", topic_label: "Topic Label", status: "open",
        question: "RETAKE-QUESTION", contrast: null, answer: null, verdict: null, source_note_ids: noteIds,
        created_at: "2026-11-11T10:00:00Z", updated_at: new Date(NOW).toISOString(), answered_at: null, ...over,
    });
    /** The Word chat of the first retake has a withheld source; a second Word chat, with a second topic, read only the open document. */
    const twoTopics = (retakes: Record<string, unknown>[], secondOpen = true) => {
        const base = trainingWorld(WITHHELD_SOURCE).tables;
        return trainingWorld(WITHHELD_SOURCE, {
            training_retakes: retakes,
            word_chats: [...base.word_chats, { id: SECOND_CHAT, user_id: PUPIL, title: "second" }],
            word_chat_messages: [
                ...base.word_chat_messages,
                { id: "00000000-0000-4000-8000-0000000000e8", chat_id: SECOND_CHAT, role: "user", files: null, citations: null, content: "typed", created_at: "2026-11-10T10:00:01Z" },
                { id: "00000000-0000-4000-8000-0000000000e9", chat_id: SECOND_CHAT, role: "assistant", files: null, citations: null, content: [...(secondOpen ? OPEN_DOCUMENT_ONLY : WITHHELD_SOURCE), { type: "content", text: "a" }], created_at: "2026-11-10T10:00:02Z" },
            ],
            training_turn_notes: [
                ...base.training_turn_notes,
                ...SECOND_NOTES.map((id, index) => ({
                    ...base.training_turn_notes[0], id, word_chat_id: SECOND_CHAT, message_id: "00000000-0000-4000-8000-0000000000e8",
                    attempt: `SECOND-ATTEMPT-${index}`, topics: ["Second Topic"], created_at: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
                })),
            ],
        });
    };
    const withheldRetake = () => retakeOf(NOTE_IDS_OF_FIRST, { verdict: "no_coincide" });
    const NOTE_IDS_OF_FIRST = ["00000000-0000-4000-8000-000000000050"];

    it("lists it on the person's map with no verdict, and it does not name it as the open one", async () => {
        const world = twoTopics([withheldRetake()]);
        const result = await getMyCriterion(world.db, { userId: PUPIL, orgId: ORG, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        expect(result.data.open_retake_id).toBeNull();
        expect(result.data.retakes).toHaveLength(1);
        expect(result.data.retakes[0]).toMatchObject({ text_hidden: true, verdict: null, question: null });
    });

    it("still names an ordinary live retake as the open one", async () => {
        const world = twoTopics([retakeOf(SECOND_NOTES, { topic_key: "second topic", topic_label: "Second Topic" })]);
        const result = await getMyCriterion(world.db, { userId: PUPIL, orgId: ORG, now: NOW });
        if (!result.ok) throw new Error(result.kind);
        expect(result.data.open_retake_id).toBe(RETAKE);
        expect(result.data.retakes[0]).toMatchObject({ text_hidden: false, question: "RETAKE-QUESTION" });
    });

    it("starting a new one closes the withheld one and goes ahead", async () => {
        const world = twoTopics([withheldRetake()]);
        const result = await startRetake(world.db, { ...person, orgId: ORG, body: { topic_key: "second topic" }, now: NOW });
        expect(result.ok).toBe(true);
        const stored = world.tables.training_retakes;
        expect(stored.find((row) => row.id === RETAKE)?.status).toBe("failed");
        expect(stored).toHaveLength(2);
        expect(sent.join("\n")).toContain("SECOND-ATTEMPT");
        expect(sent.join("\n")).not.toContain("ATTEMPT-TEXT");
    });

    it("starting a new one is still refused while an ordinary retake is live", async () => {
        const world = twoTopics([retakeOf(SECOND_NOTES, { topic_key: "second topic", topic_label: "Second Topic" })]);
        const result = await startRetake(world.db, { ...person, orgId: ORG, body: { topic_key: "topic label" }, now: NOW });
        expect(result).toMatchObject({ ok: false, code: "training_retake_in_progress" });
        expect(world.tables.training_retakes[0].status).toBe("open");
    });
});
