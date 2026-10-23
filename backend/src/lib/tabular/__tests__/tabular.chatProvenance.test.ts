import { describe, expect, it } from "vitest";
import {
    nextTurnSourceDocumentIds,
    selectCompleteChatMessages,
} from "../tabular.chatProvenance";

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
            nextTurnSourceDocumentIds(messagesDb(longChat(), 1000), "chat", ["doc-y"]),
        ).resolves.toEqual(["doc-x", "doc-y"]);
    });

    it("keeps an ordinary chat's sources unchanged", async () => {
        const db = messagesDb([{ id: "m", source_document_ids: ["doc-y"] }], 1000);
        await expect(nextTurnSourceDocumentIds(db, "chat", ["doc-z"])).resolves.toEqual([
            "doc-y",
            "doc-z",
        ]);
    });

    it("throws when the server caps pages below the requested size", async () => {
        await expect(
            selectCompleteChatMessages(messagesDb(longChat(), 500), ["chat"], "*"),
        ).rejects.toThrow("Incomplete chat message read");
        await expect(
            nextTurnSourceDocumentIds(messagesDb(longChat(), 500), "chat", []),
        ).rejects.toThrow();
    });

    it("throws when completeness cannot be proven without an exact count", async () => {
        await expect(
            selectCompleteChatMessages(messagesDb(longChat(), 1000, false), ["chat"], "*"),
        ).rejects.toThrow("count unavailable");
    });
});
