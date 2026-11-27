import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { getChatTurnNotes } from "./trainingNotes.service";

// The contrast of a note is computed from the answer it follows. For a Word
// chat it is read only while the reader can open what the chat's answers drew
// on now; what the pupil wrote themselves is always theirs.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const PUPIL = id(1);
const WORD_CHAT = id(20);
const OWN_DOC = id(30);
const UNSHARED_DOC = id(31);
const DELETED_DOC = id(32);
const NOTE_MESSAGE = id(40);

const answer = (n: number, events: Row[]): Row => ({
    id: id(n), chat_id: WORD_CHAT, role: "assistant", files: null, citations: null,
    content: [...events, { type: "content", text: "answer" }], created_at: `2026-11-10T10:00:${String(n).padStart(2, "0")}Z`,
});
const snapshot = { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null };
const read = (document_id: string) => ({ type: "doc_read", filename: "x.docx", document_id });

function world(events: Row[]) {
    return memoryDb({
        documents: [
            { id: OWN_DOC, user_id: PUPIL, project_id: null, org_id: null },
            { id: UNSHARED_DOC, user_id: id(2), project_id: null, org_id: null },
        ],
        word_chats: [{ id: WORD_CHAT, user_id: PUPIL, title: null }],
        word_chat_messages: [
            { id: NOTE_MESSAGE, chat_id: WORD_CHAT, role: "user", files: null, citations: null, content: "typed", created_at: "2026-11-10T10:00:01Z" },
            answer(2, events),
        ],
        training_turn_notes: [
            { id: "n1", org_id: ORG, trainee_user_id: PUPIL, word_chat_id: WORD_CHAT, message_id: NOTE_MESSAGE, attempt: "MY-OWN-APPROACH", contrast: "CONTRAST-TEXT", contrast_status: "ready", foundation_question: "FOUNDATION-QUESTION", topics: ["t"], created_at: "2026-11-10T10:00:03Z" },
        ],
    });
}
const mine = async (events: Row[]) => {
    const result = await getChatTurnNotes(world(events).db, { actorId: PUPIL, actorEmail: "pupil@example.test", chatId: WORD_CHAT });
    if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
    return result.data.notes[0];
};

describe("the pupil's own turn notes of a Word chat", () => {
    it.each([
        ["the open document only", [snapshot]],
        ["no recorded source", []],
        ["a document they can open", [read(OWN_DOC)]],
    ])("shows the contrast of an answer drawn from %s", async (_name, events) => {
        expect(await mine(events)).toMatchObject({ attempt: "MY-OWN-APPROACH", contrast: "CONTRAST-TEXT", foundation_question: "FOUNDATION-QUESTION" });
    });

    it.each([
        ["a document no longer shared with them", [read(UNSHARED_DOC)]],
        ["a document that was deleted", [read(DELETED_DOC)]],
        ["a document it cannot identify", [{ type: "doc_read", filename: "legacy.docx" }]],
    ])("keeps what the pupil wrote and withholds what was computed from %s", async (_name, events) => {
        const shown = await mine(events);
        expect(shown).toMatchObject({ attempt: "MY-OWN-APPROACH", contrast: null, foundation_question: null, topics: null });
        expect(JSON.stringify(shown)).not.toMatch(/CONTRAST-TEXT|FOUNDATION-QUESTION/);
    });
});
