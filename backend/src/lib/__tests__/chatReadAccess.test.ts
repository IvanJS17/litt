import { describe, expect, it } from "vitest";
import { cumulativeChatSourceRefs, readableChatMessages } from "../chatReadAccess";

type Row = Record<string, unknown>;

const DOC_MINE = "00000000-0000-4000-8000-000000000001";
const DOC_WALLED = "00000000-0000-4000-8000-000000000002";
const DOC_GONE = "00000000-0000-4000-8000-000000000003";

// Personal documents: readable by the reader who owns them.
function documentsDb(docs: Row[], failure: string | null = null) {
    const lookups: string[][] = [];
    return {
        lookups,
        db: {
            from: () => {
                let rows: Row[] = [];
                const builder: any = {
                    select: () => builder,
                    in: (_c: string, ids: string[]) => {
                        lookups.push(ids);
                        rows = docs.filter((doc) => ids.includes(doc.id as string));
                        return builder;
                    },
                    then: (resolve: (v: unknown) => unknown) =>
                        Promise.resolve(
                            failure ? { data: null, error: { message: failure } } : { data: rows, error: null },
                        ).then(resolve),
                };
                return builder;
            },
        } as any,
    };
}
const docs = (): Row[] => [
    { id: DOC_MINE, user_id: "reader", project_id: null, org_id: null },
    { id: DOC_WALLED, user_id: "other", project_id: null, org_id: null },
];
const reader = { userId: "reader", userEmail: "reader@example.test" };
const ids = (rows: Row[]) => rows.map((row) => row.id);
// The versions one message names, read on its own and strictly.
const refsOf = (message: Row) => cumulativeChatSourceRefs([message])[0];
const sourcesOf = (message: Row) => refsOf(message) && [...new Set(refsOf(message)!.map((ref) => ref.documentId))];

const user = (id: string, over: Row = {}): Row => ({ id, chat_id: "c1", role: "user", content: `typed ${id}`, files: null, ...over });
const assistant = (id: string, over: Row = {}): Row => ({ id, chat_id: "c1", role: "assistant", content: [{ type: "content", text: `answer ${id}` }], citations: null, ...over });

describe("the documents a message names", () => {
    it("names the documents a message attaches, cites, reads, finds, creates, edits and copies", () => {
        const sources = sourcesOf(
            assistant("a", {
                citations: [{ type: "citation_data", document_id: DOC_MINE }],
                content: [
                    { type: "doc_read", filename: "a.docx", document_id: DOC_WALLED },
                    { type: "delegation", events: [{ type: "doc_find", filename: "b.docx", document_id: DOC_GONE }] },
                    { type: "doc_replicated", filename: "c.docx", copies: [{ document_id: "00000000-0000-4000-8000-000000000004" }] },
                ],
            }),
        );
        expect(sources && [...sources].sort()).toEqual([
            DOC_MINE, DOC_WALLED, DOC_GONE, "00000000-0000-4000-8000-000000000004",
        ].sort());
        expect(sourcesOf(user("u", { files: [{ filename: "x.docx", document_id: DOC_MINE }] }))).toEqual([DOC_MINE]);
        expect(sourcesOf(user("plain"))).toEqual([]);
    });

    it("is unknown when a message names a document without an identifier", () => {
        expect(sourcesOf(assistant("a", { content: [{ type: "doc_read", filename: "old.docx" }] }))).toBeNull();
        expect(sourcesOf(user("u", { files: [{ filename: "x.docx" }] }))).toBeNull();
        expect(sourcesOf(assistant("a", { citations: [{ type: "citation_data", doc_id: "doc-0" }] }))).toBeNull();
    });
});

describe("the versions a message names", () => {
    const V1 = "00000000-0000-4000-8000-0000000000a1";
    it("keeps the version each reference names, from citations, events, delegated events and copies", () => {
        const refs = refsOf(
            assistant("a", {
                citations: [
                    { document_id: DOC_MINE, version_number: 2 },
                    { document: { document_id: DOC_WALLED, version_id: V1, version_number: 3 } },
                ],
                content: [
                    { type: "doc_find", document_id: DOC_MINE, version_id: V1, version_number: 1 },
                    { type: "delegation", events: [{ type: "doc_edited", document_id: DOC_GONE }] },
                    { type: "doc_replicated", copies: [{ document_id: DOC_WALLED, version_id: V1 }] },
                ],
            }),
        );
        expect(refs).toEqual(
            expect.arrayContaining([
                { documentId: DOC_MINE, versionId: null, versionNumber: 2 },
                { documentId: DOC_WALLED, versionId: V1, versionNumber: 3 },
                { documentId: DOC_MINE, versionId: V1, versionNumber: 1 },
                { documentId: DOC_GONE, versionId: null, versionNumber: null },
                { documentId: DOC_WALLED, versionId: V1, versionNumber: null },
            ]),
        );
        expect(refs).toHaveLength(5);
    });
});

describe("cumulativeChatSourceRefs", () => {
    it("carries what earlier messages of the same chat named, per chat, and unknown onward", () => {
        const out = cumulativeChatSourceRefs([
            assistant("a1", { chat_id: "c1", citations: [{ document_id: DOC_MINE, version_number: 1 }] }),
            assistant("a2", { chat_id: "c1" }),
            assistant("b1", { chat_id: "c2" }),
            assistant("a3", { chat_id: "c1", citations: [{ filename: "x" }] }),
            assistant("a4", { chat_id: "c1" }),
        ]);
        expect(out[0]).toEqual([{ documentId: DOC_MINE, versionId: null, versionNumber: 1 }]);
        expect(out[1]).toEqual(out[0]);
        expect(out[2]).toEqual([]);
        expect(out[3]).toBeNull();
        expect(out[4]).toBeNull();
    });
});

describe("readableChatMessages", () => {
    it("keeps the typed text of the person and withholds answers whose sources they cannot open", async () => {
        const { db } = documentsDb(docs());
        const messages = [
            user("u1", { files: [{ filename: "m.docx", document_id: DOC_MINE }, { filename: "w.docx", document_id: DOC_WALLED }] }),
            assistant("a1", { citations: [{ document_id: DOC_WALLED }] }),
            user("u2"),
            assistant("a2"),
        ];
        const out = await readableChatMessages(db, reader, messages, "chat_messages");
        // a1 quotes the walled document; a2 follows it in the same chat and
        // can repeat it, so it is withheld too. The person's own words stay.
        expect(ids(out.messages)).toEqual(["u1", "u2"]);
        expect(out.messages[0].files).toEqual([{ filename: "m.docx", document_id: DOC_MINE }]);
        expect(out.messages[0].content).toBe("typed u1");
        expect(out.messages[1]).toEqual(messages[2]);
        expect([...out.withheld]).toEqual(["c1"]);
    });

    it("takes a read of the document open in Word as no stored document only in a Word chat, and only in its two stored forms", async () => {
        const { db } = documentsDb(docs());
        const live = { type: "doc_read", filename: "Active Word document (live)" };
        const snapshot = { type: "doc_read", filename: "Contract.docx", version_id: null, version_number: null };
        const unidentified = { type: "doc_read", filename: "old.docx" };
        const read = (event: Row, table: "chat_messages" | "word_chat_messages") =>
            readableChatMessages(db, reader, [assistant("a1", { content: [event] })], table, "live");
        for (const event of [live, snapshot]) {
            expect(ids((await read(event, "word_chat_messages")).messages)).toEqual(["a1"]);
            expect(ids((await read(event, "chat_messages")).messages)).toEqual([]);
        }
        expect(ids((await read(unidentified, "word_chat_messages")).messages)).toEqual([]);
        expect(ids((await read({ ...live, document_id: DOC_WALLED }, "word_chat_messages")).messages)).toEqual([]);
    });

    it("withholds a message with no recoverable source list, and what follows it", async () => {
        const { db } = documentsDb(docs());
        const out = await readableChatMessages(db, reader, [
            assistant("a0"),
            assistant("a1", { content: [{ type: "doc_read", filename: "old.docx" }] }),
            assistant("a2"),
        ], "chat_messages");
        expect(ids(out.messages)).toEqual(["a0"]);
    });

    it("judges each chat on its own, with one lookup for all of them", async () => {
        const { db, lookups } = documentsDb(docs());
        const out = await readableChatMessages(db, reader, [
            assistant("a1", { chat_id: "c1", citations: [{ document_id: DOC_WALLED }] }),
            assistant("b1", { chat_id: "c2", citations: [{ document_id: DOC_MINE }] }),
            assistant("g1", { chat_id: "c3", citations: [{ document_id: DOC_GONE }] }),
        ], "chat_messages");
        expect(ids(out.messages)).toEqual(["b1"]);
        expect([...out.withheld].sort()).toEqual(["c1", "c3"]);
        expect(lookups).toHaveLength(1);
    });

    it("keeps everything for a reader who can open every source, and withholds nothing", async () => {
        const { db } = documentsDb(docs());
        const messages = [
            user("u1", { files: [{ document_id: DOC_MINE }] }),
            assistant("a1", { citations: [{ document_id: DOC_MINE }], content: [{ type: "doc_read", document_id: DOC_MINE }] }),
        ];
        const out = await readableChatMessages(db, reader, messages, "chat_messages");
        expect(out.messages).toEqual(messages);
        expect(out.withheld.size).toBe(0);
    });

    it("fails closed when the access lookup fails", async () => {
        const { db } = documentsDb(docs(), "unavailable");
        await expect(
            readableChatMessages(db, reader, [assistant("a1", { citations: [{ document_id: DOC_MINE }] })], "chat_messages"),
        ).rejects.toThrow();
    });
});

describe("assistant searches as sources", () => {
    const search = (over: Row = {}) => ({ type: "doc_search", search_id: "s", scope: "library", query: "fee", offset: 0, ...over });

    it("names the documents a search returned, delegated searches included", () => {
        const direct = assistant("a", { content: [search({ match_count: 2, document_ids: [DOC_MINE, DOC_WALLED] })] });
        expect(sourcesOf(direct)?.slice().sort()).toEqual([DOC_MINE, DOC_WALLED].sort());
        const delegated = assistant("a", { content: [{ type: "delegation", events: [search({ match_count: 1, document_ids: [DOC_GONE] })] }] });
        expect(sourcesOf(delegated)).toEqual([DOC_GONE]);
        expect(refsOf(direct)).toHaveLength(2);
    });

    it("is unknown when a search lists an identifier that names no document", () => {
        expect(sourcesOf(assistant("a", { content: [search({ match_count: 1, document_ids: ["no-id"] })] }))).toBeNull();
    });

    it("a search that returned nothing names nothing", () => {
        expect(sourcesOf(assistant("a", { content: [search({ match_count: 0 })] }))).toEqual([]);
    });
});

describe("a search stored without its documents, read without a gate", () => {
    const search = (over: Row = {}) => ({ type: "doc_search", search_id: "s", scope: "library", query: "fee", offset: 0, ...over });
    const read = (event: Row, chat = "c1") => cumulativeChatSourceRefs([assistant("a", { chat_id: chat, content: [event] })])[0];

    it("is unknown provenance when it had results, whatever its scope", () => {
        expect(read(search({ match_count: 3 }))).toBeNull();
        expect(read(search({ scope: "project", match_count: 3 }))).toBeNull();
        expect(read(search({ scope: "document", match_count: 1 }))).toBeNull();
    });

    it("names nothing when it returned nothing or failed", () => {
        expect(read(search({ match_count: 0 }))).toEqual([]);
        expect(read(search({ error_code: "unavailable" }))).toEqual([]);
    });

    it("still reads a workflow's file reference as unknown", () => {
        expect(read({ type: "doc_read", filename: "f.docx" })).toBeNull();
        expect(cumulativeChatSourceRefs([assistant("a", { citations: [{ document_id: "workflow-asset-00000000-0000-4000-8000-0000000000e2-1" }] })])[0]).toBeNull();
    });
});
