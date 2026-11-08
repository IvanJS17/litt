import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../__tests__/helpers/memoryDb";
import type { Db } from "../../lib/supabase";
import { recordChatEgress, recordChatEgressOrThrow, type ResolvedChatRoute } from "./user.chatRoute";

const resolved: ResolvedChatRoute = {
    ok: true,
    route: { provider: "claude", model: "claude-sonnet-4-5", credentialRef: "platform" },
    apiKeys: {},
};
const args = { userId: "u1", orgId: "o1", chatId: "c1", surface: "training_backing", resolved };

describe("the egress record of a call that must not go unrecorded (W1)", () => {
    it("writes the same row as recordChatEgress", async () => {
        const a = memoryDb({ audit_events: [] });
        const b = memoryDb({ audit_events: [] });
        await recordChatEgress(a.db as Db, args);
        await recordChatEgressOrThrow(b.db as Db, args);
        const bare = (rows: Record<string, unknown>[]) => rows.map(({ id: _id, created_at: _at, ...rest }) => rest);
        expect(bare(b.tables.audit_events)).toEqual(bare(a.tables.audit_events));
        expect(b.tables.audit_events[0]).toMatchObject({ action: "llm.egress", surface: "training_backing" });
    });

    it("writes the comparison of a criteria contrast under its own label", async () => {
        const { db, tables } = memoryDb({ audit_events: [] });
        await recordChatEgressOrThrow(db as Db, { ...args, surface: "training_contrast" });
        expect(tables.audit_events[0]).toMatchObject({ action: "llm.egress", surface: "training_contrast" });
    });

    it("throws when the row cannot be written, while recordChatEgress still swallows it", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { db, failNext } = memoryDb({ audit_events: [] });
        failNext("audit_events", "insert", { message: "down" });
        await expect(recordChatEgressOrThrow(db as Db, args)).rejects.toThrow();
        failNext("audit_events", "insert", { message: "down" });
        await expect(recordChatEgress(db as Db, args)).resolves.toBeUndefined();
    });
});
