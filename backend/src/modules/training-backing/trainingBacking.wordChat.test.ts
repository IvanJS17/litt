import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { getMyChatBacking } from "./trainingBacking.service";

// A backing check of a Word answer quotes the passages the answer cited. The
// pupil reads it only while they can open what the chat's answers drew on now:
// otherwise it is not found, as for a matter they can no longer open.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const PUPIL = id(1);
const WORD_CHAT = id(20);
const OWN_DOC = id(30);
const UNSHARED_DOC = id(31);
const ANSWER = id(41);

function world(events: Row[], citations: Row[] = []) {
    return memoryDb(
        {
            documents: [
                { id: OWN_DOC, user_id: PUPIL, project_id: null, org_id: null },
                { id: UNSHARED_DOC, user_id: id(2), project_id: null, org_id: null },
            ],
            word_chats: [{ id: WORD_CHAT, user_id: PUPIL, title: null }],
            word_chat_messages: [
                { id: id(40), chat_id: WORD_CHAT, role: "user", files: null, citations: null, content: "typed", created_at: "2026-11-10T10:00:01Z" },
                { id: ANSWER, chat_id: WORD_CHAT, role: "assistant", files: null, citations, content: [...events, { type: "content", text: "answer" }], created_at: "2026-11-10T10:00:02Z" },
            ],
            training_backing_checks: [
                {
                    id: id(50), org_id: ORG, trainee_user_id: PUPIL, chat_id: null, word_chat_id: WORD_CHAT, tabular_chat_id: null,
                    message_id: ANSWER, status: "ready", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z",
                    conclusions: [{ id: "c1", text: "CONCLUSION-TEXT", citation_ref: null, status: "unbacked", unverified_references: [], person_verified: false, person_note: null }],
                },
            ],
        },
        { training_can_read_learning: () => true },
    );
}
const mine = (events: Row[], citations?: Row[]) => getMyChatBacking(world(events, citations).db, { userId: PUPIL, userEmail: "pupil@example.test", chatId: WORD_CHAT });
const snapshot = { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null };

describe("the pupil's own backing checks of a Word chat", () => {
    it.each([
        ["the open document only", [snapshot], [{ type: "citation_data", document_id: "active-word-document", quote: "q" }]],
        ["a document they can open", [{ type: "doc_read", filename: "own.docx", document_id: OWN_DOC }], [{ type: "citation_data", document_id: OWN_DOC, quote: "q" }]],
    ])("shows the check of an answer drawn from %s", async (_name, events, citations) => {
        const result = await mine(events, citations);
        expect(result).toMatchObject({ ok: true });
        expect(JSON.stringify(result)).toContain("CONCLUSION-TEXT");
    });

    it("does not find the check of an answer drawn from a document no longer shared with them", async () => {
        const result = await mine([{ type: "doc_read", filename: "x.docx", document_id: UNSHARED_DOC }], [{ type: "citation_data", document_id: UNSHARED_DOC, quote: "QUOTE" }]);
        expect(result).toMatchObject({ ok: false, kind: "not_found" });
    });
});
