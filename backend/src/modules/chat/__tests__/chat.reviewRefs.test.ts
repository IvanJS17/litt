import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { getChatMessages } from "../chat.messages";

// A chat's transcript carries, per assistant answer, only the refs of its
// low-band citations. The route has already authorised the chat; this pins
// what is attached and what is not.
const asked: { table: string; filters: Record<string, unknown> }[] = [];

function fakeDb(tables: Record<string, unknown[]>): Db {
    return {
        from(table: string) {
            const call = { table, filters: {} as Record<string, unknown> };
            asked.push(call);
            const builder: Record<string, unknown> = {
                select: () => builder,
                eq: (c: string, v: unknown) => ((call.filters[c] = v), builder),
                in: (c: string, v: unknown) => ((call.filters[c] = v), builder),
                order: () => builder,
                limit: () => builder,
                gt: () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }),
                then: (ok: (v: unknown) => unknown) =>
                    Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok),
            };
            return builder;
        },
    } as unknown as Db;
}

const MESSAGES = [
    { id: "u1", role: "user", content: "pregunta", created_at: "2026-11-16T10:00:00Z" },
    { id: "a1", role: "assistant", content: [{ type: "content", text: "Respuesta [1] [2]" }], created_at: "2026-11-16T10:00:01Z" },
    { id: "a2", role: "assistant", content: [{ type: "content", text: "Otra [1]" }], created_at: "2026-11-16T10:00:02Z" },
];

describe("getChatMessages review refs", () => {
    beforeEach(() => {
        asked.length = 0;
        vi.stubEnv("LITT_CITATION_CHECK", "enabled");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("adds review_refs to the answers that have low-band citations and to no other message", async () => {
        const db = fakeDb({
            chat_messages: MESSAGES,
            citation_support_checks: [
                { id: "k1", message_id: "a1", citation_ref: 2 },
            ],
        });
        const messages = await getChatMessages(db, "chat-1", { userId: "u", userEmail: null });
        expect(messages.map((m) => m.review_refs)).toEqual([undefined, [2], undefined]);
        const read = asked.find((call) => call.table === "citation_support_checks");
        expect(read?.filters).toMatchObject({ band: "not_supported", message_id: ["a1", "a2"] });
    });

    it("leaves the transcript as it was when the server switch is off", async () => {
        vi.stubEnv("LITT_CITATION_CHECK", "disabled");
        const db = fakeDb({
            chat_messages: MESSAGES,
            citation_support_checks: [{ id: "k1", message_id: "a1", citation_ref: 2 }],
        });
        const messages = await getChatMessages(db, "chat-1", { userId: "u", userEmail: null });
        expect(messages.some((m) => "review_refs" in m)).toBe(false);
        expect(asked.map((call) => call.table)).not.toContain("citation_support_checks");
    });
});
