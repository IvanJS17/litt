import { describe, expect, it } from "vitest";
import { withoutConnectionId } from "../connectionId";
import { selectCompleteChatMessages } from "../tabularReadAccess";

describe("withoutConnectionId", () => {
    it("drops the id of the connection a row came from and keeps its origin and the app's name", () => {
        const row = { id: "m1", origin: "mcp", origin_label: "Claude", origin_grant_id: "g1", content: "hola" };
        expect(withoutConnectionId(row)).toEqual({ id: "m1", origin: "mcp", origin_label: "Claude", content: "hola" });
        expect(row.origin_grant_id).toBe("g1");
    });

    it("leaves a row that has none as it is", () => {
        expect(withoutConnectionId({ id: "m2" })).toEqual({ id: "m2" });
    });
});

describe("selectCompleteChatMessages", () => {
    it("never returns the connection's id, whatever columns are asked for", async () => {
        const rows = [
            { id: "m1", chat_id: "c1", role: "user", origin: "mcp", origin_label: "Claude", origin_grant_id: "g1", created_at: "2026-11-28T10:00:00Z" },
        ];
        const builder: Record<string, unknown> = {
            select: () => builder,
            in: () => builder,
            order: () => builder,
            range: () => builder,
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
        };
        const db = { from: () => builder };
        const read = await selectCompleteChatMessages(db as never, ["c1"], "*");
        expect(read).toHaveLength(1);
        expect(read[0]).toMatchObject({ origin: "mcp", origin_label: "Claude" });
        expect(read[0]).not.toHaveProperty("origin_grant_id");
    });
});
