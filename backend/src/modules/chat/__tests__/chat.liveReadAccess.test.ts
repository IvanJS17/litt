import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { resetAssistantTurnRunsForTests, startAssistantTurnRun } from "../../../lib/assistantTurnRuns";
import { loadChatHistory, readChatTurn } from "../chat.history";
import { getChatMessages } from "../chat.messages";
import { withReadableChatTitles } from "../../../lib/chatReadAccess";

// A stored transcript holds copies of the documents it names. Who may read a
// copy is decided when it is read, from the documents the reader can open then.
const CHAT = "c0000000-0000-4000-8000-000000000001";
const READER = "u0000000-0000-4000-8000-000000000001";
const OTHER = "u0000000-0000-4000-8000-000000000002";
const OPEN_DOC = "d0000000-0000-4000-8000-000000000001";
const CLOSED_DOC = "d0000000-0000-4000-8000-000000000002";
const reader = { userId: READER, userEmail: "reader@example.test" };

const message = (id: string, over: Row): Row => ({
    id,
    chat_id: CHAT,
    role: "assistant",
    content: null,
    files: null,
    citations: null,
    created_at: `2026-11-10T10:00:0${id.slice(-1)}Z`,
    ...over,
});
const answer = (id: string, text: string, over: Row = {}) =>
    message(id, { content: [{ type: "content", text }], ...over });

function world(extra: Row[] = []) {
    return memoryDb({
        documents: [
            { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
            { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
        ],
        chat_messages: [
            message("m1", { role: "user", content: "typed question", files: [{ filename: "closed.docx", document_id: CLOSED_DOC }, { filename: "open.docx", document_id: OPEN_DOC }] }),
            answer("m2", "quote from the closed file", { citations: [{ document_id: CLOSED_DOC, quote: "secret clause" }] }),
            message("m3", { role: "user", content: "second question" }),
            answer("m4", "later answer that may repeat the earlier one"),
            ...extra,
        ],
        chats: [],
        citation_support_checks: [],
        document_edits: [],
        document_versions: [],
    });
}

beforeEach(() => resetAssistantTurnRunsForTests());

describe("getChatMessages for a reader", () => {
    it("keeps in place, emptied and marked, the answers built on a document the reader cannot open, and keeps what they typed", async () => {
        const { db } = world();
        const messages = await getChatMessages(db, CHAT, reader);
        expect(messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
        expect((messages[0].files as Row[]).map((f) => f.document_id)).toEqual([OPEN_DOC]);
        expect(messages[0]).not.toHaveProperty("unreadable");
        expect(messages[1]).toMatchObject({ role: "assistant", content: [], citations: null, unreadable: true });
        // A later answer is written over the whole earlier transcript, so it can repeat the withheld one.
        expect(messages[3]).toMatchObject({ role: "assistant", content: [], citations: null, unreadable: true });
        expect(messages[2]).toMatchObject({ role: "user", content: "second question" });
        expect(JSON.stringify(messages)).not.toContain("secret clause");
        expect(JSON.stringify(messages)).not.toContain("quote from the closed file");
        expect(JSON.stringify(messages)).not.toContain("closed.docx");
    });

    it("shows a later answer that is itself readable when nothing before it is withheld", async () => {
        const { db, tables } = world();
        tables.chat_messages.splice(0, 2);
        const messages = await getChatMessages(db, CHAT, reader);
        expect(messages.map((m) => [m.id, m.unreadable])).toEqual([["m3", undefined], ["m4", undefined]]);
    });

    it("keeps everything for a reader who can open every document", async () => {
        const { db, tables } = world();
        tables.documents[1].user_id = READER;
        const messages = await getChatMessages(db, CHAT, reader);
        expect(messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
        expect(messages.some((m) => m.unreadable)).toBe(false);
    });

    it("fails when the access lookup fails, instead of serving the transcript", async () => {
        const { db, failNext } = world();
        failNext("documents", "select", { message: "down" });
        await expect(getChatMessages(db, CHAT, reader)).rejects.toThrow();
    });
});

// A chat stored before searches recorded their documents is judged as it was
// before: a library or templates search without them does not withhold by
// itself, so whoever may open every document sees the same transcript. A read
// or a citation that names no usable document stays withheld.
describe("getChatMessages over older stored shapes", () => {
    const stored = (events: Row[], citations: unknown = null) =>
        memoryDb({
            documents: [{ id: OPEN_DOC, user_id: READER, project_id: null, org_id: null }],
            chat_messages: [
                message("m1", { role: "user", content: "q1" }),
                message("m2", { content: [...events, { type: "content", text: "a1" }], citations }),
                message("m3", { role: "user", content: "q2" }),
                message("m4", { content: [{ type: "content", text: "a2" }] }),
            ],
            chats: [],
            citation_support_checks: [],
            document_edits: [],
            document_versions: [],
        });
    const shown = async (events: Row[], citations: unknown = null) =>
        (await getChatMessages(stored(events, citations).db, CHAT, reader)).map((m) => [m.id, m.unreadable === true]);

    it.each([
        ["a library search", { type: "doc_search", search_id: "s1", scope: "library", query: "change of control", offset: 0, match_count: 3, next_offset: null }],
        ["a templates search", { type: "doc_search", search_id: "s1", scope: "templates", query: "nda", offset: 0, match_count: 2, next_offset: null }],
        ["a project search", { type: "doc_search", search_id: "s1", scope: "project", query: "rent", offset: 0, match_count: 2, next_offset: null }],
    ])("shows the owner of every document the whole transcript of %s stored without its documents", async (_name, search) => {
        expect(await shown([search])).toEqual([["m1", false], ["m2", false], ["m3", false], ["m4", false]]);
    });

    it("judges a search that recorded its documents by them", async () => {
        const { db, tables } = stored([{ type: "doc_search", search_id: "s1", scope: "library", query: "q", offset: 0, match_count: 1, document_ids: [CLOSED_DOC], next_offset: null }]);
        tables.documents.push({ id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null });
        const messages = await getChatMessages(db, CHAT, reader);
        expect(messages.map((m) => [m.id, m.unreadable === true])).toEqual([["m1", false], ["m2", true], ["m3", false], ["m4", true]]);
    });

    it("withholds, marked, an answer that read a document without naming it, and what follows", async () => {
        expect(await shown([{ type: "doc_read", filename: "contract.docx" }])).toEqual([["m1", false], ["m2", true], ["m3", false], ["m4", true]]);
    });

    it("withholds, marked, an answer with a citation whose document cannot be resolved", async () => {
        const citation = [{ type: "citation_data", kind: "document", ref: 1, document: { document_id: "doc-9", title: "doc-9", quotes: [] }, doc_id: "doc-9", filename: "doc-9", page: 1, quote: "x" }];
        expect(await shown([], citation)).toEqual([["m1", false], ["m2", true], ["m3", false], ["m4", true]]);
    });
});

describe("loadChatHistory for a reader", () => {
    it("replays only what the reader can open into a new turn", async () => {
        const { db } = world();
        const history = await loadChatHistory(db, CHAT, reader);
        expect(JSON.stringify(history)).not.toContain("closed");
        expect(JSON.stringify(history)).not.toContain("secret clause");
        expect(history.map((entry) => entry.role)).toEqual(["user", "user"]);
    });
});

describe("readChatTurn for a reader", () => {
    const read = (db: Parameters<typeof readChatTurn>[0], id: string) => readChatTurn(db, { chatId: CHAT, turnId: id }, reader);

    it("states an answer built on a document the reader cannot open without its words or citations", async () => {
        const { db } = world();
        for (const id of ["m2", "m4"]) {
            const state = await read(db, id);
            expect(state, id).toMatchObject({ messageId: id, text: "", citations: [], unreadable: true });
            expect(JSON.stringify(state)).not.toContain("secret clause");
        }
    });

    it("states an answer whose documents the reader can open", async () => {
        const { db, tables } = world();
        tables.documents[1].user_id = READER;
        expect(await read(db, "m2")).toMatchObject({ messageId: "m2", text: "quote from the closed file", status: "completed" });
        expect(await read(db, "m2")).not.toHaveProperty("unreadable");
    });

    it("keeps the true state of a turn it cannot show: failed, stopped, needing input", async () => {
        const { db, tables } = world();
        const stateOf = async (content: Row[]) => {
            tables.chat_messages.find((m) => m.id === "m2")!.content = [{ type: "doc_read", filename: "closed.docx", document_id: CLOSED_DOC }, ...content];
            return read(db, "m2");
        };
        for (const [event, status] of [["error", "failed"], ["stopped", "stopped"], ["ask_inputs", "needs_input"]] as const) {
            const state = await stateOf([{ type: event, message: "secret clause" }]);
            expect(state, event).toMatchObject({ status, text: "", citations: [], unreadable: true, errorMessage: null });
            expect(JSON.stringify(state)).not.toContain("secret clause");
        }
    });

    it("does not read the transcript while the turn is still being written, only once it has finished", async () => {
        const { db, tables } = world();
        tables.chat_messages.find((m) => m.id === "m4")!.content = null;
        const run = startAssistantTurnRun({ id: "m4", chatId: CHAT, userId: READER, assistantMessageId: "m4" })!;
        const asked: string[] = [];
        const from = db.from.bind(db);
        db.from = ((table: string) => (asked.push(table), from(table))) as typeof db.from;
        expect(await read(db, "m4")).toMatchObject({ status: "generating" });
        expect(await read(db, "m4")).toMatchObject({ status: "generating" });
        expect(asked.filter((table) => table === "documents")).toEqual([]);
        expect(asked).toEqual(["chat_messages", "chat_messages"]);
        run.finish();
        tables.chat_messages.find((m) => m.id === "m4")!.content = [{ type: "content", text: "done" }];
        expect(await read(db, "m4")).toMatchObject({ status: "completed", unreadable: true });
        expect(asked).toContain("documents");
    });
});

// What a transcript withholds, and why. A reader who lost access to a document
// that still exists loses every later answer of the chat (a later answer is
// written over the earlier ones). The owner of the chat, whose own history it
// is, loses only the one answer whose source cannot be established or whose
// document no longer exists.
describe("getChatMessages: which answers are withheld, and for which reason", () => {
    const GONE_DOC = "d0000000-0000-4000-8000-0000000000ff";
    const unresolved = [{ type: "citation_data", kind: "document", ref: 1, document: { document_id: "doc-9", title: "doc-9", quotes: [] }, doc_id: "doc-9", filename: "doc-9", page: 1, quote: "x" }];
    const chat = (owner: string) => [{ id: CHAT, user_id: owner }];
    const transcript = (m2: Row, owner: string | null = READER) =>
        memoryDb({
            documents: [
                { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
                { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
            ],
            chat_messages: [
                message("m1", { role: "user", content: "q1" }),
                message("m2", { content: [{ type: "content", text: "a1" }], ...m2 }),
                message("m3", { role: "user", content: "q2" }),
                answer("m4", "a2"),
                message("m5", { role: "user", content: "q3" }),
                answer("m6", "a3"),
            ],
            chats: owner ? chat(owner) : [],
            citation_support_checks: [],
            document_edits: [],
            document_versions: [],
        });
    const verdicts = async (m2: Row, owner: string | null = READER) =>
        (await getChatMessages(transcript(m2, owner).db, CHAT, reader))
            .filter((m) => m.role === "assistant")
            .map((m) => [m.id, m.unreadable === true ? (m.unreadable_reason ?? "none") : null]);

    const unknownSources: [string, Row][] = [
        ["a citation that does not resolve", { citations: unresolved }],
        ["a document read stored without an id", { content: [{ type: "doc_read", filename: "contract.docx" }, { type: "content", text: "a1" }] }],
        ["a citation of a document that was deleted", { citations: [{ document_id: GONE_DOC, quote: "q" }] }],
        ["a read of a document that was deleted", { content: [{ type: "doc_read", filename: "gone.pdf", document_id: GONE_DOC }, { type: "content", text: "a1" }] }],
    ];

    it.each(unknownSources)("withholds only the answer with %s, for the owner of the chat", async (_name, m2) => {
        expect(await verdicts(m2)).toEqual([["m2", "source_unknown"], ["m4", null], ["m6", null]]);
    });

    it.each(unknownSources)("keeps the full rule for another reader of a shared chat: %s", async (_name, m2) => {
        const out = await verdicts(m2, OTHER);
        // A reader who does not own the chat is always told they have no access, never that a source cannot be identified.
        expect(out).toEqual([["m2", "no_access"], ["m4", "no_access"], ["m6", "no_access"]]);
    });

    it("keeps the full rule when the chat's owner cannot be established", async () => {
        const out = await verdicts(unknownSources[0][1], null);
        expect(out).toEqual([["m2", "no_access"], ["m4", "no_access"], ["m6", "no_access"]]);
    });

    it("withholds every later answer, for the reason of lost access, from an answer built on a document that still exists but the reader cannot open", async () => {
        expect(await verdicts({ citations: [{ document_id: CLOSED_DOC, quote: "q" }] })).toEqual([["m2", "no_access"], ["m4", "no_access"], ["m6", "no_access"]]);
    });

    it("states lost access, not an unknown source, for another reader of a shared chat whose own answer is built on a closed document", async () => {
        const out = await verdicts({ citations: [{ document_id: CLOSED_DOC, quote: "q" }] }, OTHER);
        expect(out).toEqual([["m2", "no_access"], ["m4", "no_access"], ["m6", "no_access"]]);
    });

    it("does not let an answer with an unknown source hide a closed document it also named from the answers after it", async () => {
        const out = await verdicts({ citations: [...unresolved, { document_id: CLOSED_DOC, quote: "q" }] });
        expect(out).toEqual([["m2", "no_access"], ["m4", "no_access"], ["m6", "no_access"]]);
    });

    it("withholds nothing from the owner of every document when no source is unknown", async () => {
        expect(await verdicts({})).toEqual([["m2", null], ["m4", null], ["m6", null]]);
    });

    it("tells readChatTurn's reader the same: the answer after an unknown source is shown to the owner", async () => {
        const { db } = transcript(unknownSources[0][1]);
        expect(await readChatTurn(db, { chatId: CHAT, turnId: "m4" }, reader)).toMatchObject({ text: "a2", status: "completed" });
        expect(await readChatTurn(db, { chatId: CHAT, turnId: "m2" }, reader)).toMatchObject({ text: "", unreadable: true, unreadableReason: "source_unknown" });
    });

    it("tells readChatTurn's reader who does not own the chat that they have no access, never an unidentified source", async () => {
        const { db } = transcript(unknownSources[0][1], OTHER);
        expect(await readChatTurn(db, { chatId: CHAT, turnId: "m2" }, reader)).toMatchObject({ unreadable: true, unreadableReason: "no_access" });
    });
});

// A document attached to a person's message counts like one an answer names.
describe("getChatMessages: attachments of the person's messages", () => {
    const GONE_DOC = "d0000000-0000-4000-8000-0000000000ff";
    const idLessRead = { content: [{ type: "doc_read", filename: "contract.docx" }, { type: "content", text: "a1" }] };
    const transcript = (attached: string, owner: string, m2: Row = {}) =>
        memoryDb({
            documents: [
                { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
                { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
            ],
            chat_messages: [
                message("m1", { role: "user", content: "q1", files: [{ filename: "attached.docx", document_id: attached }] }),
                message("m2", { content: [{ type: "content", text: "a1" }], ...m2 }),
                message("m3", { role: "user", content: "q2" }),
                answer("m4", "a2"),
            ],
            chats: [{ id: CHAT, user_id: owner }],
            citation_support_checks: [],
            document_edits: [],
            document_versions: [],
        });
    const verdicts = async (attached: string, owner: string, m2: Row = {}) =>
        (await getChatMessages(transcript(attached, owner, m2).db, CHAT, reader)).map((m) => [m.id, m.unreadable === true ? (m.unreadable_reason ?? "none") : null]);

    it("withholds, for lost access, every answer after an attachment of an existing document the owner cannot open, even when an answer read without an id", async () => {
        expect(await verdicts(CLOSED_DOC, READER, idLessRead)).toEqual([["m1", null], ["m2", "no_access"], ["m3", null], ["m4", "no_access"]]);
    });

    it.each([[READER], [OTHER]])("withholds the plain answers after such an attachment from the reader of a chat owned by %s", async (owner) => {
        expect(await verdicts(CLOSED_DOC, owner)).toEqual([["m1", null], ["m2", "no_access"], ["m3", null], ["m4", "no_access"]]);
    });

    it("never writes a verdict for the person's own message: what they typed stays", async () => {
        const messages = await getChatMessages(transcript(CLOSED_DOC, READER).db, CHAT, reader);
        expect(messages[0]).toMatchObject({ id: "m1", content: "q1", files: [] });
        expect(messages[0]).not.toHaveProperty("unreadable");
        expect(messages[2]).toMatchObject({ id: "m3", content: "q2" });
    });

    it("treats an attachment of a deleted document as a deleted document named by an answer: it holds nothing back from the owner", async () => {
        expect(await verdicts(GONE_DOC, READER)).toEqual([["m1", null], ["m2", null], ["m3", null], ["m4", null]]);
    });

    it("tells another reader of the chat they have no access when the attached document was deleted", async () => {
        expect(await verdicts(GONE_DOC, OTHER)).toEqual([["m1", null], ["m2", "no_access"], ["m3", null], ["m4", "no_access"]]);
    });

    it("keeps the full rule for another reader when an attachment names no usable document, and not for the owner", async () => {
        expect(await verdicts("not-a-document-id", OTHER)).toEqual([["m1", null], ["m2", "no_access"], ["m3", null], ["m4", "no_access"]]);
        expect(await verdicts("not-a-document-id", READER)).toEqual([["m1", null], ["m2", null], ["m3", null], ["m4", null]]);
    });

    it("shows everything to a reader who can open the attachment", async () => {
        expect(await verdicts(OPEN_DOC, READER, idLessRead)).toEqual([["m1", null], ["m2", "source_unknown"], ["m3", null], ["m4", null]]);
    });
});

describe("getChatMessages: a failed lookup of the owner or of what still exists fails closed", () => {
    const build = () =>
        memoryDb({
            documents: [
                { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
                { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
            ],
            chat_messages: [
                message("m1", { role: "user", content: "q1" }),
                message("m2", { content: [{ type: "content", text: "a1" }], citations: [{ document_id: CLOSED_DOC, quote: "q" }] }),
            ],
            chats: [{ id: CHAT, user_id: READER }],
            citation_support_checks: [],
            document_edits: [],
            document_versions: [],
        });

    it("fails when the owner lookup fails", async () => {
        const { db, failNext } = build();
        failNext("chats", "select", { message: "down" });
        await expect(getChatMessages(db, CHAT, reader)).rejects.toThrow();
    });

    it("fails when the existence lookup fails, instead of reading the document as deleted", async () => {
        const probe = build();
        let calls = 0;
        const counting = { from: (table: string) => (table === "documents" && calls++, probe.db.from(table)), rpc: probe.db.rpc.bind(probe.db) };
        await getChatMessages(counting as unknown as typeof probe.db, CHAT, reader);
        const total = calls;
        const { db, failNext } = build();
        let seen = 0;
        const failing = {
            from: (table: string) => {
                if (table === "documents" && ++seen === total) failNext("documents", "select", { message: "down" });
                return db.from(table);
            },
            rpc: db.rpc.bind(db),
        };
        await expect(getChatMessages(failing as unknown as typeof db, CHAT, reader)).rejects.toThrow();
    });
});

describe("the live rule for a search stored without a document list", () => {
    const withSearch = (search: Row) =>
        memoryDb({
            documents: [
                { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
                { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
            ],
            chat_messages: [
                message("m1", { role: "user", content: "q1" }),
                message("m2", { content: [search, { type: "content", text: "a1" }] }),
            ],
            chats: [],
            citation_support_checks: [],
            document_edits: [],
            document_versions: [],
        });
    const base = { type: "doc_search", search_id: "s1", scope: "library", query: "q", offset: 0, match_count: 3, next_offset: null };
    const shown = async (search: Row) => (await getChatMessages(withSearch(search).db, CHAT, reader)).map((m) => m.unreadable === true);

    it("does not withhold a search that has no document list at all", async () => {
        expect(await shown(base)).toEqual([false, false]);
    });

    it.each([
        ["null", null],
        ["a string", CLOSED_DOC],
        ["an object", { 0: CLOSED_DOC }],
    ])("withholds a search whose document list is %s: an unknown source", async (_name, list) => {
        expect(await shown({ ...base, document_ids: list })).toEqual([false, true]);
    });
});

describe("readChatTurn while the run is still registered", () => {
    it("judges an answer that is already saved, even though the run has not finished", async () => {
        const { db } = world();
        startAssistantTurnRun({ id: "m2", chatId: CHAT, userId: READER, assistantMessageId: "m2" });
        const state = await readChatTurn(db, { chatId: CHAT, turnId: "m2" }, reader);
        expect(state).toMatchObject({ status: "generating", text: "", citations: [], unreadable: true });
        expect(JSON.stringify(state)).not.toContain("secret clause");
    });

    it("shows the saved answer of a registered run to a reader who can open its documents", async () => {
        const { db, tables } = world();
        tables.documents[1].user_id = READER;
        startAssistantTurnRun({ id: "m2", chatId: CHAT, userId: READER, assistantMessageId: "m2" });
        expect(await readChatTurn(db, { chatId: CHAT, turnId: "m2" }, reader)).toMatchObject({ status: "generating", text: "quote from the closed file" });
    });
});

// A title is written from what the person typed and the names of the files they
// attached: it is shown while the reader can open every file attached to the chat.
describe("withReadableChatTitles", () => {
    const CHATS = ["c1", "c2", "c3", "c4", "c5"].map((id) => `c0000000-0000-4000-8000-0000000000${id.slice(1)}a`.replace(/a$/, "0"));
    const [A, B, C, D, E] = CHATS;
    const attach = (chat: string, n: number, files: Row[]) =>
        message(`m${n}`, { chat_id: chat, role: "user", content: "typed", files });
    const titled = async (files: Record<string, Row[]>, chats = CHATS) => {
        const { db } = memoryDb({
            documents: [
                { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
                { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
            ],
            chat_messages: Object.entries(files).map(([chat, list], n) => attach(chat, n + 1, list)),
            chats: [],
        });
        const out = await withReadableChatTitles(db, reader, chats.map((id) => ({ id, title: `title of ${id.slice(-4)}` })));
        return out.map((chat) => chat.title);
    };

    it("judges every chat of a list, not only the first", async () => {
        const titles = await titled({
            [A]: [{ filename: "closed.docx", document_id: CLOSED_DOC }],
            [B]: [{ filename: "open.docx", document_id: OPEN_DOC }],
            [D]: [{ filename: "closed.docx", document_id: CLOSED_DOC }],
            [E]: [{ filename: "closed.docx", document_id: CLOSED_DOC }, { filename: "open.docx", document_id: OPEN_DOC }],
        });
        expect(titles).toEqual([null, `title of ${B.slice(-4)}`, `title of ${C.slice(-4)}`, null, null]);
    });

    it("keeps the title of a chat whose attachment names no document, and withholds one that names something that is not a document", async () => {
        const titles = await titled({
            [A]: [{ filename: "pasted.txt" }],
            [B]: [{ filename: "odd.docx", document_id: "not-a-document-id" }],
        });
        expect(titles.slice(0, 3)).toEqual([`title of ${A.slice(-4)}`, null, `title of ${C.slice(-4)}`]);
    });

    it("fails when the lookup fails, instead of showing the titles", async () => {
        const { db, failNext } = memoryDb({ documents: [], chat_messages: [attach(A, 1, [{ filename: "x", document_id: CLOSED_DOC }])], chats: [] });
        failNext("chat_messages", "select", { message: "down" });
        await expect(withReadableChatTitles(db, reader, [{ id: A, title: "t" }])).rejects.toThrow();
    });
});
