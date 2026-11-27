import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../../../__tests__/helpers/memoryDb";
import { attachPriorReasoning, enrichWithPriorEvents } from "../contextBuilders";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../lib/observability/report")>()),
    reportError,
}));

// What is replayed to the model in a new turn comes from the previous stored
// answer only when the reader can open the documents THAT answer drew on, now.
// What the person themselves answered or decided is replayed in every case.
const CHAT = "c0000000-0000-4000-8000-000000000001";
const READER = "u0000000-0000-4000-8000-000000000001";
const OTHER = "u0000000-0000-4000-8000-000000000002";
const OPEN_DOC = "d0000000-0000-4000-8000-000000000001";
const CLOSED_DOC = "d0000000-0000-4000-8000-000000000002";
const reader = { userId: READER, userEmail: "reader@example.test" };
const TABLES = ["chat_messages", "word_chat_messages"] as const;
type Table = (typeof TABLES)[number];

beforeEach(() => reportError.mockClear());

const at = (n: number) => `2026-11-10T10:00:${String(n).padStart(2, "0")}Z`;
const row = (n: number, role: string, over: Row = {}): Row => ({
    id: `m${n}`,
    chat_id: CHAT,
    role,
    content: null,
    files: null,
    citations: null,
    created_at: at(n),
    ...over,
});

/** The last answer asked a question, and the person answered it. */
const askedAndAnswered = (n: number, extra: Row[] = []): Row =>
    row(n, "assistant", {
        content: [
            ...extra,
            { type: "content", text: "Which colour?" },
            { type: "ask_inputs", items: [{ id: "q1", kind: "text", question: "Which colour?" }] },
            { type: "ask_inputs_response", author_user_id: READER, responses: [{ id: "q1", kind: "text", answer: "BLUE-ANSWER" }] },
        ],
    });

const documents = () => [
    { id: OPEN_DOC, user_id: READER, project_id: null, org_id: null },
    { id: CLOSED_DOC, user_id: OTHER, project_id: null, org_id: null },
];

const request = [
    { role: "user" as const, content: "q1" },
    { role: "assistant" as const, content: "a1" },
    { role: "user" as const, content: "q2" },
    { role: "assistant" as const, content: "Which colour?" },
];

/** What an earlier answer (m2) of the chat stored, as ordinary use leaves it. */
const EARLIER: Record<string, Row> = {
    plain_answer: { content: [{ type: "content", text: "a1" }] },
    open_doc_read: { content: [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }, { type: "content", text: "a1" }] },
    legacy_library_search: { content: [{ type: "doc_search", search_id: "s1", scope: "library", query: "q", offset: 0, match_count: 3, next_offset: null }, { type: "content", text: "a1" }] },
    legacy_project_search: { content: [{ type: "doc_search", search_id: "s1", scope: "project", query: "q", offset: 0, match_count: 3, next_offset: null }, { type: "content", text: "a1" }] },
    unresolved_citation_slug: {
        content: [{ type: "content", text: "a1 [1]" }],
        citations: [{ type: "citation_data", kind: "document", ref: 1, document: { document_id: "doc-9", title: "doc-9", quotes: [] }, doc_id: "doc-9", filename: "doc-9", page: 1, quote: "x" }],
    },
    word_live_document_read: { content: [{ type: "doc_read", filename: "Active Word document (live)" }, { type: "content", text: "a1" }] },
    deleted_document_read: { content: [{ type: "doc_read", filename: "gone.pdf", document_id: "d0000000-0000-4000-8000-0000000000ff" }, { type: "content", text: "a1" }] },
};

describe.each(TABLES)("enrichWithPriorEvents over %s: a reader with full access", (table: Table) => {
    for (const [name, m2] of Object.entries(EARLIER)) {
        it(`still replays the last answer's summary and the person's own answer after an earlier answer with ${name}`, async () => {
            const { db } = memoryDb({
                documents: documents(),
                [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", m2), row(3, "user", { content: "q2" }), askedAndAnswered(4, [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }])],
                chats: [],
            });
            const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
            const text = String(out[3].content);
            expect(text).toContain("[Tool activity in your previous turn]");
            expect(text).toContain("open.pdf");
            expect(text).toContain("user answered:");
            expect(text).toContain("BLUE-ANSWER");
            expect(reportError).not.toHaveBeenCalled();
        });
    }

    it.each([
        ["a library search stored without its documents", { type: "doc_search", search_id: "s1", scope: "library", query: "q", offset: 0, match_count: 3, next_offset: null }],
        ["a templates search stored without its documents", { type: "doc_search", search_id: "s1", scope: "templates", query: "q", offset: 0, match_count: 3, next_offset: null }],
    ])("replays the summary of a last answer that holds %s", async (_name, search) => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), askedAndAnswered(4, [search, { type: "web_search", query: "WEB-QUERY", results: [{}] }])],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        expect(String(out[3].content)).toContain("WEB-QUERY");
        expect(String(out[3].content)).toContain("BLUE-ANSWER");
    });

    it("withholds the summary of a last answer that holds a search whose document list is not a list", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), askedAndAnswered(4, [{ type: "doc_search", search_id: "s1", scope: "library", query: "q", offset: 0, match_count: 3, document_ids: CLOSED_DOC, next_offset: null }, { type: "web_search", query: "WEB-QUERY", results: [{}] }])],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        expect(String(out[3].content)).not.toContain("WEB-QUERY");
        expect(String(out[3].content)).toContain("BLUE-ANSWER");
    });

    it("replays a Word live read of the open document in the last answer only for the Word chat table", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: [{ type: "content", text: "a1" }] }), row(3, "user", { content: "q2" }), askedAndAnswered(4, [{ type: "doc_read", filename: "Active Word document (live)" }, { type: "delegation", delegation_id: "d1", title: "t", status: "done", brief: "BRIEF-TEXT", events: [] }])],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        const text = String(out[3].content);
        expect(text).toContain("BLUE-ANSWER");
        if (table === "word_chat_messages") {
            expect(text).toContain("read_active_document");
            expect(text).toContain("BRIEF-TEXT");
        } else {
            // A read without an id of a file named like the live one, in an assistant chat, is a source that cannot be established.
            expect(text).not.toContain("read_active_document");
            expect(text).not.toContain("BRIEF-TEXT");
        }
    });
});

describe("enrichWithPriorEvents: a Word chat is judged as a Word chat", () => {
    // In a Word chat the open document is the add-in's own text: the answer's
    // snapshot read of it and its citation of it name no stored document, so
    // they hold nothing back. In an assistant chat the same references are a
    // source that cannot be established.
    const openDocumentAnswer = () =>
        askedAndAnswered(4, [
            { type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC },
            { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null },
        ]);
    const run = async (table: Table, over: Row) => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), { ...openDocumentAnswer(), ...over }],
            chats: [],
        });
        return String((await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader))[3].content);
    };
    const citesOpenDocument = { citations: [{ type: "citation_data", kind: "document", ref: 1, document_id: "active-word-document", quote: "x" }] };

    it("replays the summary of a last Word answer that read or cited only the open document", async () => {
        expect(await run("word_chat_messages", {})).toContain("open.pdf");
        expect(await run("word_chat_messages", citesOpenDocument)).toContain("open.pdf");
    });

    it("still withholds the same references in an assistant chat", async () => {
        expect(await run("chat_messages", {})).not.toContain("open.pdf");
    });

    it("withholds a last Word answer that also read a document the reader cannot open", async () => {
        const text = await run("word_chat_messages", {
            content: [
                { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
                { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null },
                { type: "ask_inputs", items: [{ id: "q1", kind: "text", question: "Which colour?" }] },
                { type: "ask_inputs_response", author_user_id: READER, responses: [{ id: "q1", kind: "text", answer: "BLUE-ANSWER" }] },
            ],
        });
        expect(text).not.toContain("closed-file.pdf");
        expect(text).toContain("BLUE-ANSWER");
    });
});

describe.each(TABLES)("enrichWithPriorEvents over %s: a last answer the reader cannot open", (table: Table) => {
    const closedAnswer = () =>
        askedAndAnswered(4, [
            { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
            { type: "delegation", delegation_id: "d1", title: "t", status: "done", brief: "BRIEF-TEXT", events: [] },
            { type: "doc_created", filename: "made.docx", document_id: CLOSED_DOC },
        ]);
    const world = () =>
        memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", EARLIER.plain_answer), row(3, "user", { content: "q2" }), closedAnswer()],
            chats: [],
        });

    it("withholds what it drew on but still replays what the person answered", async () => {
        const { db } = world();
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        const text = JSON.stringify(out);
        expect(text).not.toContain("closed-file.pdf");
        expect(text).not.toContain("made.docx");
        expect(text).not.toContain("BRIEF-TEXT");
        expect(String(out[3].content)).toContain("user answered:");
        expect(String(out[3].content)).toContain("BLUE-ANSWER");
    });

    it("is judged on its own sources: an earlier answer the reader cannot open does not withhold it", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [
                row(1, "user", { content: "q1" }),
                row(2, "assistant", { content: [{ type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC }, { type: "content", text: "a1" }] }),
                row(3, "user", { content: "q2" }),
                askedAndAnswered(4, [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }]),
            ],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        expect(String(out[3].content)).toContain("open.pdf");
        expect(JSON.stringify(out)).not.toContain("closed-file.pdf");
    });

    it("keeps what the person decided on an approval, and withholds its outcome text", async () => {
        const approval = { id: "ap1", kind: "approval", tool_name: "send_mail", connector_name: "Mail" };
        const { db } = memoryDb({
            documents: documents(),
            [table]: [
                row(1, "user", { content: "q1" }),
                row(4, "assistant", {
                    content: [
                        { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
                        { type: "ask_inputs", items: [approval] },
                        { type: "ask_inputs_response", author_user_id: READER, responses: [{ id: "ap1", kind: "approval", decision: "approve" }] },
                        { type: "mcp_tool_call", approval_id: "ap1", tool_name: "send_mail", status: "ok", result: "OUTCOME-TEXT" },
                    ],
                }),
            ],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        const text = String(out[3].content);
        expect(text).toContain("user approved");
        expect(text).not.toContain("OUTCOME-TEXT");
        expect(text).not.toContain("has no recorded outcome");
        expect(text).not.toContain("closed-file.pdf");
    });

    it("keeps a rejection and the instruction not to retry it", async () => {
        const approval = { id: "ap1", kind: "approval", tool_name: "send_mail", connector_name: "Mail" };
        const { db } = memoryDb({
            documents: documents(),
            [table]: [
                row(4, "assistant", {
                    content: [
                        { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
                        { type: "ask_inputs", items: [approval] },
                        { type: "ask_inputs_response", author_user_id: READER, responses: [{ id: "ap1", kind: "approval", decision: "reject" }] },
                    ],
                }),
            ],
            chats: [],
        });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        expect(String(out[3].content)).toContain("user rejected");
        expect(String(out[3].content)).toContain("do not retry a rejected action");
    });

    it("continues with only the person's own answers when the access lookup fails, and reports the failure once", async () => {
        const { db, failNext } = world();
        failNext("documents", "select", { message: "down" });
        const out = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        const text = JSON.stringify(out);
        expect(text).not.toContain("closed-file.pdf");
        expect(text).not.toContain("BRIEF-TEXT");
        expect(String(out[3].content)).toContain("BLUE-ANSWER");
        expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("judges the reader it is given, not another person", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), askedAndAnswered(4, [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }])],
            chats: [],
        });
        const asOther = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, { userId: OTHER, userEmail: "other@example.test" });
        expect(String(asOther[3].content)).not.toContain("open.pdf");
        const asReader = await enrichWithPriorEvents(request, CHAT, db, {}, "nonce", table, undefined, reader);
        expect(String(asReader[3].content)).toContain("open.pdf");
    });
});

describe.each(TABLES)("attachPriorReasoning over %s", (table: Table) => {
    const thought = (text: string, over: Row[] = []) => [{ type: "reasoning", text }, ...over, { type: "content", text: "a1" }];
    const history = [{ role: "user" as const, content: "q1" }, { role: "assistant" as const, content: "a1" }, { role: "user" as const, content: "q2" }];
    const attach = (db: Parameters<typeof attachPriorReasoning>[2], who = reader) =>
        attachPriorReasoning(history, CHAT, db, table, undefined, who);

    it("attaches the stored reasoning of an answer the reader can open", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: thought("OPEN-REASONING", [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }]) })],
            chats: [],
        });
        expect((await attach(db))[1].reasoning).toBe("OPEN-REASONING");
    });

    it("attaches nothing for an answer the reader cannot open, even when the client sends its text", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: thought("CLOSED-REASONING", [{ type: "doc_read", filename: "closed.pdf", document_id: CLOSED_DOC }]) })],
            chats: [],
        });
        expect(JSON.stringify(await attach(db))).not.toContain("CLOSED-REASONING");
    });

    it("judges the reader it is given", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: thought("OPEN-REASONING", [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }]) })],
            chats: [],
        });
        expect(JSON.stringify(await attach(db, { userId: OTHER, userEmail: "other@example.test" }))).not.toContain("OPEN-REASONING");
    });

    it("attaches the reasoning of an answer whose only unidentified read is the live read of the open Word document, in the Word chat only", async () => {
        const { db } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: thought("LIVE-REASONING", [{ type: "doc_read", filename: "Active Word document (live)" }]) })],
            chats: [],
        });
        const out = JSON.stringify(await attach(db));
        expect(out.includes("LIVE-REASONING")).toBe(table === "word_chat_messages");
    });

    it("attaches nothing, reports it, and goes on when the access lookup fails", async () => {
        const { db, failNext } = memoryDb({
            documents: documents(),
            [table]: [row(1, "user", { content: "q1" }), row(2, "assistant", { content: thought("OPEN-REASONING", [{ type: "doc_read", filename: "open.pdf", document_id: OPEN_DOC }]) })],
            chats: [],
        });
        failNext("documents", "select", { message: "down" });
        const out = await attach(db);
        expect(out).toEqual(history);
        expect(reportError).toHaveBeenCalledTimes(1);
    });
});

// From an answer the reader cannot open, only what the reader themselves gave is
// replayed: not the questions, option texts, labels or filenames of that answer.
const THIRD = "u0000000-0000-4000-8000-000000000003";
const third = { userId: THIRD, userEmail: "third@example.test" };

describe.each(TABLES)("enrichWithPriorEvents over %s: what a person's own answers replay from an answer the reader cannot open", (table: Table) => {
    const items = [
        { id: "q1", kind: "text", question: "TEXT-QUESTION" },
        { id: "q2", kind: "choice", question: "CHOICE-QUESTION", options: [{ value: "OPTION-SECRET", label: "L" }, { value: "OTHER-OPTION", label: "L2" }] },
        { id: "q3", kind: "multi_choice", question: "MULTI-QUESTION", options: [{ value: "MULTI-SECRET", label: "L" }, { value: "MULTI-SECOND", label: "L2" }], allow_other: true },
        { id: "q4", kind: "choice", question: "FREE-QUESTION", options: [{ value: "X", label: "L" }], allow_other: true },
        { id: "q5", kind: "text", question: "SKIPPED-SECRET" },
        { id: "q6", kind: "documents", question: "DOCS-QUESTION" },
        { id: "ap1", kind: "approval", tool_name: "TOOL-SECRET", connector_name: "CONNECTOR-SECRET", arguments: { to: "ARGS-SECRET" } },
    ];
    const responses = [
        { id: "q1", kind: "text", question: "TEXT-QUESTION", answer: "TYPED-ANSWER" },
        { id: "q2", kind: "choice", question: "CHOICE-QUESTION", answer: "OPTION-SECRET" },
        { id: "q3", kind: "multi_choice", question: "MULTI-QUESTION", answers: ["MULTI-SECRET", "MY-OWN-WORDS"] },
        { id: "q4", kind: "choice", question: "FREE-QUESTION", answer: "FREE-OTHER" },
        { id: "q5", skipped: true, question: "SKIPPED-SECRET" },
        { id: "q6", kind: "documents", filenames: ["FILENAME-SECRET.pdf"] },
        { id: "ap1", kind: "approval", decision: "approve" },
    ];
    const lastAnswer = (author: string | null | undefined, answered = responses) =>
        row(4, "assistant", {
            content: [
                { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
                { type: "delegation", delegation_id: "d1", title: "t", status: "done", brief: "BRIEF-TEXT", events: [] },
                { type: "ask_inputs", event_id: "e1", items },
                { type: "ask_inputs_response", ask_event_id: "e1", ...(author === undefined ? {} : { author_user_id: author }), responses: answered },
                { type: "mcp_tool_call", approval_id: "ap1", tool_name: "TOOL-SECRET", status: "ok", result: "OUTCOME-TEXT" },
            ],
        });
    const replay = async (last: Row, who = reader, extra?: (db: ReturnType<typeof memoryDb>) => void) => {
        const world = memoryDb({ documents: documents(), [table]: [row(1, "user", { content: "q1" }), last], chats: [] });
        extra?.(world);
        return String((await enrichWithPriorEvents(request, CHAT, world.db, {}, "nonce", table, undefined, who))[3].content);
    };

    it("replays the reader's own typed answer as typed, a choice as a chosen option, a skip and a decision without what they were about", async () => {
        const text = await replay(lastAnswer(READER));
        expect(text).toContain("user answered: ");
        expect(text).toContain("TYPED-ANSWER");
        expect(text).toContain("- user chose an option");
        expect(text).toContain("- user skipped an input");
        expect(text).toContain("- user approved an action");
        for (const secret of ["OPTION-SECRET", "MULTI-SECRET", "SKIPPED-SECRET", "FILENAME-SECRET", "user attached documents", "TOOL-SECRET", "CONNECTOR-SECRET", "ARGS-SECRET", "OUTCOME-TEXT", "BRIEF-TEXT", "closed-file.pdf", "QUESTION"])
            expect(text).not.toContain(secret);
    });

    it("replays a free answer the reader typed that is not among the options, as typed", async () => {
        const text = await replay(lastAnswer(READER));
        expect(text).toContain("FREE-OTHER");
        expect(text).toContain("MY-OWN-WORDS");
    });

    it("replays a rejection of the reader as a decision only", async () => {
        const text = await replay(lastAnswer(READER, [{ id: "ap1", kind: "approval", decision: "reject" }]));
        expect(text).toContain("user rejected an action; it did not run");
        expect(text).not.toContain("TOOL-SECRET");
    });

    it("replays nothing of another person's answers, nor of an answer with no author recorded", async () => {
        for (const author of [OTHER, null, undefined]) {
            const text = await replay(lastAnswer(author as string | null | undefined));
            expect(text).not.toContain("TYPED-ANSWER");
            expect(text).not.toContain("user chose an option");
            expect(text).not.toContain("user skipped");
            expect(text).not.toContain("user approved");
        }
    });

    it("gives a second member of a shared chat, who cannot open the answer, none of the first person's answers", async () => {
        const text = await replay(lastAnswer(READER), third);
        expect(text).not.toContain("TYPED-ANSWER");
        expect(text).not.toContain("FREE-OTHER");
        expect(text).not.toContain("user chose");
        expect(text).not.toContain("user skipped");
    });

    it("replays the same limited set when the access lookup fails", async () => {
        const text = await replay(lastAnswer(READER), reader, ({ failNext }) => failNext("documents", "select", { message: "down" }));
        expect(text).toContain("TYPED-ANSWER");
        expect(text).toContain("- user chose an option");
        expect(text).not.toContain("OPTION-SECRET");
        expect(text).not.toContain("SKIPPED-SECRET");
        expect(text).not.toContain("FILENAME-SECRET");
        expect(text).not.toContain("TOOL-SECRET");
    });

    it("replays a choice as a chosen option when the question it answered cannot be found", async () => {
        const last = row(4, "assistant", {
            content: [
                { type: "doc_read", filename: "closed-file.pdf", document_id: CLOSED_DOC },
                { type: "ask_inputs_response", ask_event_id: "unknown-event", author_user_id: READER, responses: [{ id: "q2", kind: "choice", answer: "OPTION-SECRET" }] },
            ],
        });
        const text = await replay(last);
        expect(text).toContain("- user chose an option");
        expect(text).not.toContain("OPTION-SECRET");
    });

    it("replays all of it, as before, when the reader can open the answer", async () => {
        const world = memoryDb({ documents: documents(), [table]: [row(1, "user", { content: "q1" }), { ...lastAnswer(READER), content: (lastAnswer(READER).content as Row[]).filter((ev) => ev.type !== "doc_read") }], chats: [] });
        const text = String((await enrichWithPriorEvents(request, CHAT, world.db, {}, "nonce", table, undefined, reader))[3].content);
        for (const shown of ["OPTION-SECRET", "MULTI-SECRET", "SKIPPED-SECRET", "FILENAME-SECRET", "TOOL-SECRET", "OUTCOME-TEXT", "BRIEF-TEXT"]) expect(text).toContain(shown);
    });
});
