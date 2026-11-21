import { describe, expect, it } from "vitest";
import { chatMessageSources, readableChatMessages } from "../chatReadAccess";

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

const user = (id: string, over: Row = {}): Row => ({ id, chat_id: "c1", role: "user", content: `typed ${id}`, files: null, ...over });
const assistant = (id: string, over: Row = {}): Row => ({ id, chat_id: "c1", role: "assistant", content: [{ type: "content", text: `answer ${id}` }], citations: null, ...over });

describe("chatMessageSources", () => {
    it("names the documents a message attaches, cites, reads, finds, creates, edits and copies", () => {
        const sources = chatMessageSources(
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
        expect(chatMessageSources(user("u", { files: [{ filename: "x.docx", document_id: DOC_MINE }] }))).toEqual([DOC_MINE]);
        expect(chatMessageSources(user("plain"))).toEqual([]);
    });

    it("is unknown when a message names a document without an identifier", () => {
        expect(chatMessageSources(assistant("a", { content: [{ type: "doc_read", filename: "old.docx" }] }))).toBeNull();
        expect(chatMessageSources(user("u", { files: [{ filename: "x.docx" }] }))).toBeNull();
        expect(chatMessageSources(assistant("a", { citations: [{ type: "citation_data", doc_id: "doc-0" }] }))).toBeNull();
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
        const out = await readableChatMessages(db, reader, messages);
        // a1 quotes the walled document; a2 follows it in the same chat and
        // can repeat it, so it is withheld too. The person's own words stay.
        expect(ids(out.messages)).toEqual(["u1", "u2"]);
        expect(out.messages[0].files).toEqual([{ filename: "m.docx", document_id: DOC_MINE }]);
        expect(out.messages[0].content).toBe("typed u1");
        expect(out.messages[1]).toEqual(messages[2]);
        expect([...out.withheld]).toEqual(["c1"]);
    });

    it("withholds a message with no recoverable source list, and what follows it", async () => {
        const { db } = documentsDb(docs());
        const out = await readableChatMessages(db, reader, [
            assistant("a0"),
            assistant("a1", { content: [{ type: "doc_read", filename: "old.docx" }] }),
            assistant("a2"),
        ]);
        expect(ids(out.messages)).toEqual(["a0"]);
    });

    it("judges each chat on its own, with one lookup for all of them", async () => {
        const { db, lookups } = documentsDb(docs());
        const out = await readableChatMessages(db, reader, [
            assistant("a1", { chat_id: "c1", citations: [{ document_id: DOC_WALLED }] }),
            assistant("b1", { chat_id: "c2", citations: [{ document_id: DOC_MINE }] }),
            assistant("g1", { chat_id: "c3", citations: [{ document_id: DOC_GONE }] }),
        ]);
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
        const out = await readableChatMessages(db, reader, messages);
        expect(out.messages).toEqual(messages);
        expect(out.withheld.size).toBe(0);
    });

    it("fails closed when the access lookup fails", async () => {
        const { db } = documentsDb(docs(), "unavailable");
        await expect(
            readableChatMessages(db, reader, [assistant("a1", { citations: [{ document_id: DOC_MINE }] })]),
        ).rejects.toThrow();
    });
});
