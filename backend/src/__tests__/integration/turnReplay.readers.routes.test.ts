import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Replaying the stream of a turn that is running (or just ended), and reading
// a Word chat's transcript: what is streamed or stored was computed from
// documents, so the reader is checked when they read, against the documents
// they can open now (keepReadableDerived). The person whose turn it is, who
// can open everything it drew on, is never locked out.
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

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { resetAssistantTurnRunsForTests, startAssistantTurnRun } from "../../lib/assistantTurnRuns";
import { getStreamRun } from "../../lib/streamRuns";

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const READER = id("a", 1);
const COLLEAGUE = id("a", 2);
const CHAT = id("c", 1);
const TURN = id("e", 1);
const WORD_DOC = id("b", 1);
const WORD_ROW = id("b", 2);
const OPEN_DOC = id("d", 1);
const CLOSED_DOC = id("d", 2);
const SECRET = "text computed from the closed file";

const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`;

function world(extra: Record<string, Row[]> = {}) {
    const state = memoryDb({
        documents: [
            { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
            { id: CLOSED_DOC, user_id: COLLEAGUE, project_id: null, org_id: null },
        ],
        chats: [{ id: CHAT, user_id: READER, project_id: null, title: "A chat" }],
        chat_messages: [],
        word_documents: [{ id: WORD_ROW, user_id: READER, client_document_id: WORD_DOC }],
        word_chats: [{ id: CHAT, user_id: READER, word_document_id: WORD_ROW, title: "A Word chat" }],
        word_chat_messages: [],
        word_document_edits: [],
        citation_support_checks: [],
        ...extra,
    });
    h.state = state;
    return state;
}

type Surface = {
    name: string;
    surface: "chat" | "word";
    url: string;
    extra: Record<string, unknown>;
    messagesTable: string;
};
const SURFACES: Surface[] = [
    { name: "chat", surface: "chat", url: `/chat/${CHAT}/turn/${TURN}/stream`, extra: {}, messagesTable: "chat_messages" },
    {
        name: "Word chat",
        surface: "word",
        url: `/word-chat/${CHAT}/turn/${TURN}/stream?document_id=${WORD_DOC}`,
        extra: { clientDocumentId: WORD_DOC, persistChat: true },
        messagesTable: "word_chat_messages",
    },
];

function startRun(s: Surface, sourceDocumentIds: string[] | null | undefined, text = SECRET) {
    const run = startAssistantTurnRun({
        id: TURN,
        chatId: CHAT,
        userId: READER,
        assistantMessageId: TURN,
        surface: s.surface,
        ...(sourceDocumentIds === undefined ? {} : { sourceDocumentIds }),
        ...s.extra,
    })!;
    run.write(frame({ type: "content_delta", text }));
    return run;
}

// The turn has ended by the time the reader asks: its frames replay and the response closes.
const watch = (url: string) => {
    getStreamRun(TURN)?.finish();
    return request(app).get(url);
};

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    h.caller.id = READER;
});

describe.each(SURFACES)("replaying the stream of a $name turn", (s) => {
    it("gives the frames to a reader who can open every document the turn is built on", async () => {
        world();
        startRun(s, [OPEN_DOC]);
        const res = await watch(s.url);
        expect(res.status).toBe(200);
        expect(res.text).toContain(SECRET);
    });

    it("gives the frames of a turn that is built on no document", async () => {
        world();
        startRun(s, []);
        const res = await watch(s.url);
        expect(res.status).toBe(200);
        expect(res.text).toContain(SECRET);
    });

    it("answers like a turn that is gone when the reader cannot open a document it is built on", async () => {
        world();
        startRun(s, [OPEN_DOC, CLOSED_DOC]);
        const res = await watch(s.url);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("turn_not_found");
        expect(res.text).not.toContain(SECRET);
    });

    it("answers like a turn that is gone when the turn's sources are unknown", async () => {
        world();
        startRun(s, undefined);
        const res = await watch(s.url);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(SECRET);
    });

    it("answers like a turn that is gone when a frame names a document the reader cannot open", async () => {
        world();
        const run = startRun(s, [OPEN_DOC]);
        run.write(frame({ type: "doc_read", document_id: CLOSED_DOC, filename: "closed.docx" }));
        const res = await watch(s.url);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(SECRET);
    });

    it("still gives the frames when the documents the frames name are all open", async () => {
        world();
        const run = startRun(s, [OPEN_DOC]);
        run.write(frame({ type: "doc_read", document_id: OPEN_DOC, filename: "open.docx" }));
        const res = await watch(s.url);
        expect(res.status).toBe(200);
        expect(res.text).toContain("open.docx");
    });

    it("answers like a turn that is gone when an earlier answer of the chat was built on a document the reader cannot open", async () => {
        world({
            [s.messagesTable]: [
                {
                    id: id("f", 1),
                    chat_id: CHAT,
                    role: "assistant",
                    content: [{ type: "content", text: "earlier" }],
                    citations: [{ document_id: CLOSED_DOC, quote: "q" }],
                    files: null,
                    created_at: "2026-11-10T10:00:01Z",
                },
            ],
        });
        startRun(s, [OPEN_DOC]);
        const res = await watch(s.url);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(SECRET);
    });

    it("keeps the frames of the person whose turn it is when the chat holds only answers they can open", async () => {
        world({
            [s.messagesTable]: [
                {
                    id: id("f", 1),
                    chat_id: CHAT,
                    role: "assistant",
                    content: [{ type: "content", text: "earlier" }],
                    citations: [{ document_id: OPEN_DOC, quote: "q" }],
                    files: null,
                    created_at: "2026-11-10T10:00:01Z",
                },
            ],
        });
        startRun(s, [OPEN_DOC]);
        const res = await watch(s.url);
        expect(res.status).toBe(200);
        expect(res.text).toContain(SECRET);
    });
});

describe("a Word chat transcript", () => {
    const message = (n: number, over: Row): Row => ({
        id: id("f", n),
        chat_id: CHAT,
        role: "assistant",
        content: null,
        files: null,
        citations: null,
        created_at: `2026-11-10T10:00:0${n}Z`,
        ...over,
    });

    it("keeps in place, emptied and marked, an answer built on a document the reader can no longer open", async () => {
        world({
            word_chat_messages: [
                message(1, { role: "user", content: "typed question", files: [{ filename: "closed.docx", document_id: CLOSED_DOC }] }),
                message(2, { content: [{ type: "content", text: SECRET }], citations: [{ document_id: CLOSED_DOC, quote: "secret clause" }] }),
            ],
        });
        const res = await request(app).get(`/word-chat/${CHAT}?document_id=${WORD_DOC}`);
        expect(res.status).toBe(200);
        const messages = res.body.messages as Row[];
        expect(messages.map((m) => m.id)).toEqual([id("f", 1), id("f", 2)]);
        expect(messages[0]).toMatchObject({ role: "user", content: "typed question" });
        expect(messages[1]).toMatchObject({ role: "assistant", content: [], citations: null, unreadable: true });
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
        expect(JSON.stringify(res.body)).not.toContain("secret clause");
        expect(JSON.stringify(res.body)).not.toContain("closed.docx");
    });

    it("shows every message to a reader who can open every document it names", async () => {
        world({
            word_chat_messages: [
                message(1, { role: "user", content: "typed question", files: [{ filename: "open.docx", document_id: OPEN_DOC }] }),
                message(2, { content: [{ type: "content", text: "an answer" }], citations: [{ document_id: OPEN_DOC, quote: "q" }] }),
            ],
        });
        const res = await request(app).get(`/word-chat/${CHAT}?document_id=${WORD_DOC}`);
        expect(res.status).toBe(200);
        const messages = res.body.messages as Row[];
        expect(messages[1]).toMatchObject({ content: [{ type: "content", text: "an answer" }] });
        expect(messages.some((m) => m.unreadable)).toBe(false);
    });

    it("keeps a chat with no document in it whole", async () => {
        world({
            word_chat_messages: [
                message(1, { role: "user", content: "typed question" }),
                message(2, { content: [{ type: "content", text: "an answer from the open Word document" }] }),
            ],
        });
        const res = await request(app).get(`/word-chat/${CHAT}?document_id=${WORD_DOC}`);
        expect((res.body.messages as Row[])[1]).toMatchObject({ content: [{ type: "content", text: "an answer from the open Word document" }] });
    });
});
