import { describe, expect, it } from "vitest";
import {
    filterReadableChatMessages,
    nextTurnSourceDocumentIds,
    selectCompleteChatMessages,
    withReadableTitles,
} from "../tabularReadAccess";
import { saveTabularChatTurn } from "../../modules/tabular/tabular.chats";

type Row = Record<string, unknown>;

/** Messages table behind a PostgREST-like cap of `maxRows` per response. */
function messagesDb(rows: Row[], maxRows: number, withCount = true) {
    return {
        from: () => {
            let window: [number, number] = [0, Infinity];
            let counted = false;
            const builder: any = {
                select: (_c: string, options?: { count?: string }) => {
                    counted = options?.count === "exact";
                    return builder;
                },
                in: () => builder,
                order: () => builder,
                range: (from: number, to: number) => {
                    window = [from, to];
                    return builder;
                },
                then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({
                        data: rows.slice(
                            window[0],
                            Math.min(window[1] + 1, window[0] + maxRows),
                        ),
                        error: null,
                        count: counted && withCount ? rows.length : null,
                    }).then(resolve),
            };
            return builder;
        },
    } as any;
}

/** A db that records what a write path inserts and nothing else. */
function recordingDb() {
    const inserts: { table: string; payload: Row }[] = [];
    const db = {
        from: (table: string) => {
            const builder: any = {
                insert: (payload: Row) => {
                    inserts.push({ table, payload });
                    return builder;
                },
                update: () => builder,
                eq: () => builder,
                then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({ data: null, error: null }).then(resolve),
            };
            return builder;
        },
    } as any;
    return { db, inserts };
}

// 1000 messages from Y, then one whose sources include X: past one page.
const longChat = (): Row[] => [
    ...Array.from({ length: 1000 }, (_, i) => ({
        id: `m-${i}`,
        source_document_ids: ["doc-y"],
    })),
    { id: "m-x", source_document_ids: ["doc-x", "doc-y"] },
];

describe("chat provenance reads are complete or fail closed", () => {
    it("inherits a source that only appears past the first page", async () => {
        await expect(
            nextTurnSourceDocumentIds(
                messagesDb(longChat(), 1000),
                "chat",
                ["doc-y"],
            ),
        ).resolves.toEqual(["doc-x", "doc-y"]);
    });

    it("keeps an ordinary chat's sources unchanged", async () => {
        const db = messagesDb(
            [{ id: "m", source_document_ids: ["doc-y"] }],
            1000,
        );
        await expect(
            nextTurnSourceDocumentIds(db, "chat", ["doc-z"]),
        ).resolves.toEqual(["doc-y", "doc-z"]);
    });

    it("throws when the server caps pages below the requested size", async () => {
        await expect(
            selectCompleteChatMessages(
                messagesDb(longChat(), 500),
                ["chat"],
                "*",
            ),
        ).rejects.toThrow("Incomplete chat message read");
        await expect(
            nextTurnSourceDocumentIds(messagesDb(longChat(), 500), "chat", []),
        ).rejects.toThrow();
    });

    it("throws when completeness cannot be proven without an exact count", async () => {
        await expect(
            selectCompleteChatMessages(
                messagesDb(longChat(), 1000, false),
                ["chat"],
                "*",
            ),
        ).rejects.toThrow("count unavailable");
    });
});

describe("unknown provenance is never laundered", () => {
    it("keeps a legacy message from making its chat readable", async () => {
        const readable = await filterReadableChatMessages(
            messagesDb([], 1000),
            [
                { id: "a", source_document_ids: ["doc-a"] },
                { id: "legacy", source_document_ids: null },
            ],
            "u1",
            "u1@example.test",
        );
        expect(readable.map((m) => m.id)).toEqual([]);
    });

    it("makes the next turn's provenance unknown when an earlier turn is", async () => {
        await expect(
            nextTurnSourceDocumentIds(
                messagesDb([{ id: "legacy", source_document_ids: null }], 1000),
                "chat",
                ["doc-a"],
            ),
        ).resolves.toBeNull();
    });

    it("clears a chat title unless the whole transcript is readable", () => {
        const chats = [
            { id: "c1", title: "Readable" },
            { id: "c2", title: "Partly withheld" },
        ];
        const all = [
            { chat_id: "c1", source_document_ids: ["doc-a"] },
            { chat_id: "c2", source_document_ids: ["doc-a"] },
            { chat_id: "c2", source_document_ids: ["doc-b"] },
        ];
        const readable = all.filter(
            (m) => m.chat_id === "c1" || m.source_document_ids[0] === "doc-a",
        );
        expect(withReadableTitles(chats, all, readable)).toEqual([
            { id: "c1", title: "Readable" },
            { id: "c2", title: null },
        ]);
    });
});

describe("assistant turns carry the turn's provenance", () => {
    it("writes source_document_ids on the stored answer", async () => {
        const { db, inserts } = recordingDb();
        await saveTabularChatTurn(db, {
            chatId: "chat-1",
            messageId: "msg-1",
            authorUserId: "u1",
            memoryInputMessageId: "input-1",
            content: [{ type: "content", text: "answer" }],
            annotations: [],
            sourceDocumentIds: ["doc-a", "doc-b"],
            touch: "when-saved",
        });
        expect(inserts[0].table).toBe("tabular_review_chat_messages");
        expect(inserts[0].payload).toMatchObject({
            role: "assistant",
            source_document_ids: ["doc-a", "doc-b"],
        });
    });

    it("keeps unknown provenance unknown instead of writing an empty set", async () => {
        const { db, inserts } = recordingDb();
        await saveTabularChatTurn(db, {
            chatId: "chat-1",
            messageId: "msg-2",
            authorUserId: "u1",
            memoryInputMessageId: "input-2",
            content: [],
            annotations: [],
            sourceDocumentIds: null,
            touch: "never",
        });
        expect(inserts[0].payload.source_document_ids).toBeNull();
    });
});
