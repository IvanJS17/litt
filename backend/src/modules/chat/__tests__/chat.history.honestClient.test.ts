import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { loadChatHistory } from "../chat.history";

// What the web client sends with a continuation is its own transcript: each
// stored message as `{ role, content, files, workflow, playbook }`, an answer
// with its prose (and text cards) as `content`. The stored conversation, read
// back, must give the model the same conversation.
const CHAT = "c0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const DOC = "d0000000-0000-4000-8000-000000000001";
const msg = (n: number, over: Row): Row => ({
    id: `m${n}`,
    chat_id: CHAT,
    role: "assistant",
    content: null,
    citations: null,
    created_at: `2026-11-10T10:00:${String(n).padStart(2, "0")}Z`,
    ...over,
});
const FILES = [{ filename: "a.docx", document_id: DOC }];
const ask = { type: "ask_inputs", event_id: "e1", items: [{ id: "q1", kind: "text", question: "Court?" }] };

const rows = (pausedProse: string): Row[] => [
    msg(1, { role: "user", content: "First question", files: FILES }),
    msg(2, { content: [{ type: "content", text: "First answer" }] }),
    msg(3, { role: "user", content: "Second question" }),
    msg(4, { content: [{ type: "doc_read", filename: "a.docx", document_id: DOC }, { type: "content", text: "Read it. " }, { type: "content", text: "Done." }] }),
    msg(5, { role: "user", content: "Third question" }),
    msg(6, { content: [...(pausedProse ? [{ type: "content", text: pausedProse }] : []), ask] }),
];

// The same, as the client builds it from its own transcript.
const clientSends = (pausedProse: string) => [
    { role: "user", content: "First question", files: FILES },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Second question" },
    { role: "assistant", content: "Read it. Done." },
    { role: "user", content: "Third question" },
    { role: "assistant", content: pausedProse },
];

const stored = async (r: Row[]) =>
    loadChatHistory(
        memoryDb({ chat_messages: r, chats: [], citation_support_checks: [], document_edits: [], document_versions: [], documents: [{ id: DOC, user_id: USER, project_id: null, org_id: null }] }).db,
        CHAT,
        { userId: USER, userEmail: null },
        { exactlyAsTheWebSends: true },
    );

describe("the stored conversation against what the web client sends", () => {
    it("is the same conversation when the paused message has words of its own", async () => {
        expect(JSON.parse(JSON.stringify(await stored(rows("I need two facts."))))).toEqual(clientSends("I need two facts."));
    });

    it("carries an answer's text cards in place, as the client replays them", async () => {
        const r = rows("I need two facts.");
        r[3] = msg(4, { content: [{ type: "content", text: "Here:" }, { type: "text_card", title: "Draft", text: "Body." }, { type: "content", text: "Done." }] });
        expect((await stored(r))[3]).toEqual({ role: "assistant", content: "Here:\n\nDraft\nBody.\n\nDone." });
    });

    it("keeps the paused message, empty as the client sends it, when it has no words", async () => {
        expect(JSON.parse(JSON.stringify(await stored(rows(""))))).toEqual(clientSends(""));
    });
});
