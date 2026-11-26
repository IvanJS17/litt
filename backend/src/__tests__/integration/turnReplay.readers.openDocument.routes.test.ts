import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// A Word chat's stored answers are judged when read, from the documents they
// name. The document open in Word is not a stored document: the engine records
// it as its fixed handle in a citation and as a read that names no document (a
// search stored in that shape is treated the same), and the chat's owner is
// served those answers whole.
// The rows below are produced by the engine's own writers (createCitation, the
// tool dispatcher, findInDocumentContent) wherever they can run, and are said
// to be copied from a writer's output where they cannot.
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
import { createCitation, parseCitations, CITATIONS_OPEN_TAG, CITATIONS_CLOSE_TAG } from "../../modules/chat/engine/citations";
import { findInDocumentContent } from "../../modules/chat/engine/tools/documentOps";
import { runToolCalls } from "../../modules/chat/engine/tools/toolDispatcher";
import { ACTIVE_WORD_DOCUMENT_ID } from "../../modules/chat/engine/wordPrompt";
import type { DocIndex, DocStore } from "../../modules/chat/engine/types";

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const READER = id("a", 1);
const COLLEAGUE = id("a", 2);
const CHAT = id("c", 1);
const WCHAT = id("c", 9);
const TURN = id("e", 1);
const WORD_DOC = id("b", 1);
const WORD_ROW = id("b", 2);
const OPEN_DOC = id("d", 1);
const CLOSED_DOC = id("d", 2);
const THEIR_WF = id("9", 1);
const THEIR_WF_FILE = id("9", 2);
const MY_WF = id("9", 3);
const MY_WF_FILE = id("9", 4);
const NO_FILE_WF = id("9", 5);
const OPEN_NAME = "Contract.docx";

const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`;
const SECRET = "text computed from the open document";

// The open document as the Word chat service puts it in the turn's store.
const openStore = (): DocStore =>
    new Map([
        [
            ACTIVE_WORD_DOCUMENT_ID,
            { storage_path: "inline:word-document:test", file_type: "text/markdown", filename: OPEN_NAME, inline_text: "The fee is 100. The term is 3 years." },
        ],
    ]);

/** The citation the engine stores for a model's citation of `docId` (parse, then createCitation, as the stream does). */
function citationOf(docId: string, docIndex: DocIndex = {}, docStore: DocStore = openStore()): Row {
    const json = JSON.stringify([{ ref: 1, doc_id: docId, quotes: [{ quote: "The fee is 100." }] }]);
    const [parsed] = parseCitations(`Answer.\n${CITATIONS_OPEN_TAG}\n${json}\n${CITATIONS_CLOSE_TAG}`);
    return JSON.parse(JSON.stringify(createCitation(parsed, docIndex, docStore)));
}

/** The frames a writer emitted, as the events the stream stores for them (the field mapping of the stream's batch recorder). */
const framesOf = (lines: string[]): Row[] =>
    lines.map((line) => JSON.parse(line.replace(/^data: /, "").trim()) as Row);

/** What the engine stores for a find in the open document: the frame findInDocumentContent writes, with the fields the stream keeps. */
async function findEventOnOpenDocument(): Promise<Row> {
    const lines: string[] = [];
    await findInDocumentContent({ docLabel: ACTIVE_WORD_DOCUMENT_ID, query: "fee", docStore: openStore(), write: (s) => lines.push(s), actor: { userId: READER, userEmail: null }, db: {} as never });
    const found = framesOf(lines).find((event) => event.type === "doc_find")!;
    const { filename, document_id, version_id, version_number, query, total_matches } = found;
    return JSON.parse(JSON.stringify({ type: "doc_find", filename, document_id, version_id, version_number, query, total_matches }));
}

/** What the engine stores for a read of the open document through read_document, from the real dispatcher. */
async function readEventOnOpenDocument(): Promise<Row> {
    const result = await runToolCalls(
        [{ id: "r1", function: { name: "read_document", arguments: JSON.stringify({ doc_id: ACTIVE_WORD_DOCUMENT_ID }) } }],
        openStore(),
        READER,
        {} as never,
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new Map(),
    );
    const [read] = result.docsRead;
    return JSON.parse(JSON.stringify({ type: "doc_read", filename: read.filename, document_id: read.document_id, version_id: read.version_id, version_number: read.version_number }));
}

function world(rows: Row[], table: "word_chat_messages" | "chat_messages" = "word_chat_messages") {
    const state = memoryDb({
        documents: [
            { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
            { id: CLOSED_DOC, user_id: COLLEAGUE, project_id: null, org_id: null },
            { id: THEIR_WF_FILE, user_id: COLLEAGUE, project_id: null, org_id: null, workflow_id: THEIR_WF },
            { id: MY_WF_FILE, user_id: READER, project_id: null, org_id: null, workflow_id: MY_WF },
        ],
        workflows: [THEIR_WF, MY_WF, NO_FILE_WF].map((wf) => ({ id: wf, user_id: wf === THEIR_WF ? COLLEAGUE : READER, org_id: null, visibility: "private", archived_at: null, title: "A playbook" })),
        workflow_shares: [],
        chats: [{ id: CHAT, user_id: READER, project_id: null, title: "A chat" }],
        chat_messages: [],
        word_documents: [{ id: WORD_ROW, user_id: READER, client_document_id: WORD_DOC }],
        word_chats: [{ id: WCHAT, user_id: READER, word_document_id: WORD_ROW, title: "A Word chat" }],
        word_chat_messages: [],
        word_document_edits: [],
        citation_support_checks: [],
        [table]: rows,
    });
    h.state = state;
    return state;
}

const message = (chatId: string, n: number, over: Row): Row => ({
    id: id("f", n),
    chat_id: chatId,
    role: "assistant",
    content: null,
    files: null,
    citations: null,
    created_at: `2026-11-10T10:00:0${n}Z`,
    ...over,
});
const answer = (chatId: string, events: Row[], citations: Row[] | null = null): Row[] => [
    message(chatId, 1, { role: "user", content: "question" }),
    message(chatId, 2, { content: [...events, { type: "content", text: "ANSWER_ONE" }], citations }),
    message(chatId, 3, { role: "user", content: "and now?" }),
    message(chatId, 4, { content: [{ type: "content", text: "ANSWER_TWO" }] }),
];
const applied = (workflowId: string): Row => ({ type: "workflow_applied", workflow_id: workflowId, title: "playbook" });
const delegation = (events: Row[]): Row => ({ type: "delegation", delegation_id: "d1", status: "done", events });

const readWord = async () => await request(app).get(`/word-chat/${WCHAT}?document_id=${WORD_DOC}`);
const reattaches = async () => {
    startAssistantTurnRun({ id: TURN, chatId: WCHAT, userId: READER, assistantMessageId: TURN, surface: "word", clientDocumentId: WORD_DOC, persistChat: true, sourceDocumentIds: [OPEN_DOC] })!.write(
        frame({ type: "content_delta", text: SECRET }),
    );
    getStreamRun(TURN)?.finish();
    return (await request(app).get(`/word-chat/${WCHAT}/turn/${TURN}/stream?document_id=${WORD_DOC}`)).status;
};

async function expectWhole(rows: Row[]) {
    world(rows);
    const res = await readWord();
    expect(res.status).toBe(200);
    const messages = res.body.messages as Row[];
    expect(messages.some((m) => m.unreadable)).toBe(false);
    expect(messages[1]).toMatchObject({ content: rows[1].content, citations: rows[1].citations });
    expect(messages[3]).toMatchObject({ content: [{ type: "content", text: "ANSWER_TWO" }] });
    expect(await reattaches()).toBe(200);
}
async function expectWithheld(rows: Row[], reason: "no_access" | "source_unknown", reattach: number) {
    world(rows);
    const messages = (await readWord()).body.messages as Row[];
    expect(messages[1]).toMatchObject({ content: [], unreadable: true, unreadable_reason: reason });
    expect(JSON.stringify(messages)).not.toContain("ANSWER_ONE");
    expect(await reattaches()).toBe(reattach);
}

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    h.caller.id = READER;
});

describe("a Word chat answer that names the document open in Word, read by the owner of the chat", () => {
    it("serves whole an answer whose citation is the open document (written by createCitation)", async () => {
        const citation = citationOf(ACTIVE_WORD_DOCUMENT_ID);
        // The writer's own output: the open document is named by its fixed handle, nested only.
        expect(citation).toMatchObject({ document: { document_id: ACTIVE_WORD_DOCUMENT_ID }, doc_id: ACTIVE_WORD_DOCUMENT_ID });
        expect(citation.document_id).toBeUndefined();
        await expectWhole(answer(WCHAT, [], [citation]));
    });

    it("serves whole an answer that cites the open document and read it (the dispatcher's read)", async () => {
        await expectWhole(answer(WCHAT, [await readEventOnOpenDocument()], [citationOf(ACTIVE_WORD_DOCUMENT_ID)]));
    });

    it("serves whole an answer that cites the open document and a stored document the owner can open", async () => {
        const index: DocIndex = { "doc-0": { document_id: OPEN_DOC, filename: "open.docx", version_id: null, version_number: null } as never };
        const store = openStore();
        store.set("doc-0", { storage_path: "x", file_type: "docx", filename: "open.docx" });
        await expectWhole(answer(WCHAT, [], [citationOf(ACTIVE_WORD_DOCUMENT_ID, index, store), citationOf("doc-0", index, store)]));
    });

    it("serves whole an answer that searched inside the open document (the frame findInDocumentContent writes)", async () => {
        const find = await findEventOnOpenDocument();
        expect(find).toMatchObject({ type: "doc_find", filename: OPEN_NAME, version_id: null, version_number: null });
        expect(find.document_id).toBeUndefined();
        await expectWhole(answer(WCHAT, [find]));
    });

    it("serves whole a search of the open document made inside a delegation", async () => {
        await expectWhole(answer(WCHAT, [delegation([await findEventOnOpenDocument()])]));
    });

    it("serves whole a search of the open document in an answer that applied workflows none of which has a stored file", async () => {
        await expectWhole(answer(WCHAT, [applied(NO_FILE_WF), await findEventOnOpenDocument()]));
    });

    it("serves whole a search of the open document in an answer that applied a workflow of the owner's with a file and one without", async () => {
        await expectWhole(answer(WCHAT, [applied(MY_WF), applied(NO_FILE_WF), await findEventOnOpenDocument()]));
    });

    it("serves whole the read of the open document (the dispatcher's read: the snapshot shape)", async () => {
        await expectWhole(answer(WCHAT, [await readEventOnOpenDocument()]));
    });
});

describe("a Word chat answer that still names something the owner cannot open", () => {
    it("withholds, and refuses reattaching, a search with no document in an answer that applied a workflow with a file the owner lost", async () => {
        await expectWithheld(answer(WCHAT, [applied(THEIR_WF), applied(NO_FILE_WF), await findEventOnOpenDocument()]), "no_access", 404);
    });

    it("withholds, and refuses reattaching, that search made inside a delegation", async () => {
        await expectWithheld(answer(WCHAT, [applied(THEIR_WF), delegation([await findEventOnOpenDocument()])]), "no_access", 404);
    });

    it("withholds, and refuses reattaching, a citation of a real document the owner lost, next to a citation of the open document", async () => {
        const lost = { type: "citation_data", document: { document_id: CLOSED_DOC, title: "closed.docx" }, document_id: CLOSED_DOC, quote: "q" };
        await expectWithheld(answer(WCHAT, [], [citationOf(ACTIVE_WORD_DOCUMENT_ID), lost]), "no_access", 404);
        const nestedOnly = { type: "citation_data", document: { document_id: CLOSED_DOC, title: "closed.docx" }, quote: "q" };
        await expectWithheld(answer(WCHAT, [], [nestedOnly, citationOf(ACTIVE_WORD_DOCUMENT_ID)]), "no_access", 404);
    });

    it("withholds a citation whose id is neither a stored document nor the open document's handle", async () => {
        await expectWithheld(answer(WCHAT, [], [citationOf("some-other-handle")]), "source_unknown", 200);
        await expectWithheld(answer(WCHAT, [], [citationOf("Active-Word-Document")]), "source_unknown", 200);
    });

    it("still withholds a search across documents whose result list is not a list, and keeps one stored with no list as before", async () => {
        const search = { type: "doc_search", search_id: "s1", scope: "project", match_count: 2 };
        await expectWithheld(answer(WCHAT, [{ ...search, document_ids: null }]), "source_unknown", 200);
        await expectWhole(answer(WCHAT, [search]));
    });

    it("still withholds a search of the old shape that has a version", async () => {
        const find = { ...(await findEventOnOpenDocument()), version_id: id("7", 1), version_number: 2 };
        await expectWithheld(answer(WCHAT, [find]), "source_unknown", 200);
    });
});

describe("the same rows in a web chat", () => {
    const webRead = async (rows: Row[]) => {
        world(rows, "chat_messages");
        return ((await request(app).get(`/chat/${CHAT}`)).body.messages as Row[]);
    };

    it("leaves a citation of the open document's handle withheld as an unknown source", async () => {
        const messages = await webRead(answer(CHAT, [], [citationOf(ACTIVE_WORD_DOCUMENT_ID)]));
        expect(messages[1]).toMatchObject({ content: [], unreadable: true, unreadable_reason: "source_unknown" });
    });

    it("leaves a search that names no document withheld as an unknown source", async () => {
        const messages = await webRead(answer(CHAT, [await findEventOnOpenDocument()]));
        expect(messages[1]).toMatchObject({ content: [], unreadable: true, unreadable_reason: "source_unknown" });
    });
});
