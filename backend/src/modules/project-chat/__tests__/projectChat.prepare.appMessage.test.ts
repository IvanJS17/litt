import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../../__tests__/helpers/memoryDb";

// A matter conversation: a message a connected app writes is stored with the
// app's mark and the model reads it after the fixed line, without the app's name.
vi.mock("../../user/user.service", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveUserChatSelection: vi.fn(async () => ({
        ok: true,
        modelSettings: { api_keys: {}, web_search: { enabled: false }, subagent_routes: undefined, title_model: null, personalisation: undefined, last_selected_chat_model: null, last_selected_reasoning_level: null },
        selectedModel: "claude-opus-5",
        selectedReasoningLevel: null,
    })),
    governChatRoute: vi.fn(async () => ({
        ok: true,
        pinNow: false,
        route: { provider: "claude", model: "claude-opus-5", credentialRef: "personal:claude:1" },
        apiKeys: {},
    })),
}));
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    checkProjectAccess: vi.fn(async () => ({ ok: true, projectRole: "owner", project: { id: "p1", org_id: null, user_id: "u1" } })),
    ensureChatAccess: vi.fn(async () => ({ ok: true, projectRole: "owner" })),
}));
vi.mock("../../chat/engine/index", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    buildProjectDocContext: vi.fn(async () => ({ docIndex: {}, docStore: new Map(), folderPaths: new Map() })),
    buildWorkflowStore: vi.fn(async () => new Map()),
}));

import { prepareProjectChatStream } from "../projectChat.prepare";


// A database whose read of the marks fails: the send times and everything else read as usual.
function failingMarkRead(db: ReturnType<typeof memoryDb>["db"], error: unknown) {
    const real = db.from.bind(db);
    (db as { from: unknown }).from = (table: string) => {
        const query = real(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
        if (table !== "chat_messages") return query;
        const select = query.select.bind(query);
        query.select = (columns: unknown, ...rest: unknown[]) => {
            if (columns !== "content") return select(columns, ...rest);
            const failed: Record<string, unknown> = {};
            for (const name of ["eq", "order"]) failed[name] = () => failed;
            failed.range = () => Promise.resolve({ data: null, error });
            return failed;
        };
        return query;
    };
    return db;
}

const GRANT = "00000000-0000-4000-8000-0000000000a1";
const LINE = "[Sent through an app the person connected to LiTT, on their behalf; not typed by them in LiTT.]";

const turn = (extra: Record<string, unknown> = {}) => ({
    userId: "u1",
    userEmail: "u1@example.com",
    projectId: "p1",
    messages: [{ role: "user" as const, content: "hola" }],
    chatId: null,
    inputMessageId: "00000000-0000-4000-8000-0000000000d9",
    displayed_doc: undefined,
    attached_documents: undefined,
    askInputsResponse: null,
    requestedModel: undefined,
    requestedReasoning: undefined,
    ...extra,
});

describe("prepareProjectChatStream and a message a connected app writes", () => {
    it("stores the mark with the message and tells the model, without the app's name", async () => {
        const w = memoryDb({ projects: [{ id: "p1", org_id: null, user_id: "u1" }], chats: [], chat_messages: [] });
        const result = await prepareProjectChatStream(w.db, turn({ origin: { grantId: GRANT, label: "ZQXAPPNAMEZQX" } }));
        if (!result.ok) throw new Error(JSON.stringify(result));
        expect(w.tables.chat_messages.find((m) => m.role === "user")).toMatchObject({ origin: "mcp", origin_grant_id: GRANT, origin_label: "ZQXAPPNAMEZQX" });
        const last = (result.prepared.apiMessages as { role: string; content: string }[]).at(-1)!;
        expect(last.content).toContain(`${LINE}\n<app-message nonce="${result.prepared.nonce}">\nhola\n</app-message nonce="${result.prepared.nonce}">`);
        expect(last.content).not.toContain("untrusted-content");
        expect(JSON.stringify(result.prepared.apiMessages)).not.toContain("ZQXAPPNAMEZQX");
    });

    it("leaves an ordinary message without a mark and without the line", async () => {
        const w = memoryDb({ projects: [{ id: "p1", org_id: null, user_id: "u1" }], chats: [], chat_messages: [] });
        const result = await prepareProjectChatStream(w.db, turn());
        if (!result.ok) throw new Error(JSON.stringify(result));
        const stored = w.tables.chat_messages.find((m) => m.role === "user")!;
        expect(stored).not.toHaveProperty("origin");
        expect(JSON.stringify(result.prepared.apiMessages)).not.toContain("connected app");
    });

    it("marks the app's message when the conversation holds fewer stored messages than the history", async () => {
        const stored = [{ id: "m0", chat_id: "chat-1", role: "user", content: "message 0", created_at: "2026-11-28T10:00:00.000Z", origin: "mcp", origin_label: "ZQXAPPNAMEZQX" }];
        const w = memoryDb({ projects: [{ id: "p1", org_id: null, user_id: "u1" }], chats: [{ id: "chat-1", user_id: "u1", project_id: "p1", title: "t" }], chat_messages: stored });
        const result = await prepareProjectChatStream(
            w.db,
            turn({ chatId: "chat-1", messages: [{ role: "user", content: "message 0" }, { role: "user", content: "message 1" }, { role: "user", content: "next" }] }),
        );
        if (!result.ok) throw new Error(JSON.stringify(result));
        const users = (result.prepared.apiMessages as { role: string; content: string }[]).filter((m) => m.role === "user");
        expect(users.map((m) => m.content.includes(LINE))).toEqual([true, false, false]);
    });

    it("keeps the mark of the app's current message when the web shows a document with it", async () => {
        const w = memoryDb({ projects: [{ id: "p1", org_id: null, user_id: "u1" }], chats: [], chat_messages: [] });
        const result = await prepareProjectChatStream(
            w.db,
            turn({ origin: { grantId: GRANT, label: "ZQXAPPNAMEZQX" }, displayed_doc: { document_id: "d1", filename: "a.pdf" } }),
        );
        if (!result.ok) throw new Error(JSON.stringify(result));
        const last = (result.prepared.apiMessages as { role: string; content: string }[]).at(-1)!;
        expect(last.content).toContain(LINE);
        expect(last.content).toContain("displayed_doc: ");
    });

    it("ends the turn with the internal error when the mark cannot be read", async () => {
        const error = { message: "read failed" };
        const w = memoryDb({ projects: [{ id: "p1", org_id: null, user_id: "u1" }], chats: [], chat_messages: [] });
        const result = await prepareProjectChatStream(failingMarkRead(w.db, error), turn());
        expect(result).toEqual({ ok: false, internal: true, error });
    });
});
