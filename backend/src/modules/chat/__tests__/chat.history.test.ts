import type { Db } from "../../../lib/supabase";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { resetAssistantTurnRunsForTests, startAssistantTurnRun } from "../../../lib/assistantTurnRuns";
import { activeChatTurn, assistantText, loadChatHistory, readChatTurn, stopChatTurn } from "../chat.history";
import { chatOriginColumns, listChatsCreatedByGrant, withChatOrigin } from "../chat.origin";

const CHAT = "c0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const msg = (id: string, over: Row): Row => ({ id, chat_id: CHAT, role: "assistant", content: null, citations: null, created_at: `2026-11-10T10:00:0${id.slice(-1)}Z`, ...over });

function world(rows: Row[]) {
    return memoryDb({ chat_messages: rows, chats: [], citation_support_checks: [], document_edits: [], document_versions: [] });
}

beforeEach(() => resetAssistantTurnRunsForTests());

describe("assistantText", () => {
    it("joins the content events and ignores the rest", () => {
        expect(assistantText({ content: [{ type: "content", text: "Hola " }, { type: "doc_read" }, { type: "content", text: "mundo" }] })).toBe("Hola mundo");
        expect(assistantText({ content: "texto plano" })).toBe("texto plano");
        expect(assistantText({ content: null })).toBe("");
        expect(assistantText({ content: [null, "x", { type: "content", text: 5 }] })).toBe("");
    });
});

describe("loadChatHistory", () => {
    it("shapes the stored messages the way the web sends them, without empty answers", async () => {
        const { db } = world([
            msg("m1", { role: "user", content: "Pregunta", files: [{ filename: "a.docx" }], workflow: { id: "w", title: "W" }, playbook: { id: "p", title: "P" } }),
            msg("m2", { content: [{ type: "content", text: "Respuesta" }] }),
            msg("m3", { role: "user", content: null }),
            msg("m4", { content: [{ type: "doc_read" }] }),
            msg("m5", { content: null }),
            msg("m6", { role: "system", content: "x" }),
        ]);
        expect(await loadChatHistory(db, CHAT)).toEqual([
            { role: "user", content: "Pregunta", files: [{ filename: "a.docx" }], workflow: { id: "w", title: "W" }, playbook: { id: "p", title: "P" } },
            { role: "assistant", content: "Respuesta" },
            { role: "user", content: null },
        ]);
    });
});

describe("readChatTurn", () => {
    const read = (db: Db, id: string) => readChatTurn(db, { chatId: CHAT, turnId: id });

    it("is null for a message that is not an answer of this chat", async () => {
        const { db } = world([msg("m1", { role: "user", content: "x" })]);
        expect(await read(db, "m1")).toBeNull();
        expect(await read(db, "nope")).toBeNull();
    });

    it("tells a running turn, a completed one, one that needs input, a stopped one and a failed one apart", async () => {
        const { db } = world([
            msg("m1", { content: [{ type: "content", text: "ok" }], citations: [{ ref: 1 }] }),
            msg("m2", { content: [{ type: "ask_inputs" }] }),
            msg("m3", { content: [{ type: "content", text: "a medias" }, { type: "stopped" }] }),
            msg("m4", { content: [{ type: "error", message: "No se pudo" }] }),
            msg("m5", { content: null }),
        ]);
        expect(await read(db, "m1")).toMatchObject({ status: "completed", text: "ok", citations: [{ ref: 1 }], errorMessage: null, events: [{ type: "content", count: 1 }] });
        expect((await read(db, "m2"))!.status).toBe("needs_input");
        expect(await read(db, "m3")).toMatchObject({ status: "stopped", text: "a medias" });
        expect(await read(db, "m4")).toMatchObject({ status: "failed", errorMessage: "No se pudo" });
        // Reserved, never filled and no run: the process restarted under it.
        expect((await read(db, "m5"))!.status).toBe("interrupted");

        const run = startAssistantTurnRun({ id: "m5", chatId: CHAT, userId: USER, assistantMessageId: "m5" })!;
        expect((await read(db, "m5"))!.status).toBe("generating");
        expect(activeChatTurn(CHAT)).toEqual({ id: "m5", assistant_message_id: "m5" });
        run.finish();
        expect((await read(db, "m5"))!.status).toBe("failed");
        expect(activeChatTurn(CHAT)).toBeNull();
    });

    it("reads a stopped run with nothing saved as stopped", async () => {
        const { db } = world([msg("m5", { content: null })]);
        const run = startAssistantTurnRun({ id: "m5", chatId: CHAT, userId: USER, assistantMessageId: "m5" })!;
        run.stop();
        run.finish();
        expect((await read(db, "m5"))!.status).toBe("stopped");
    });

    it("ignores a run of another chat with the same id", async () => {
        const { db } = world([msg("m5", { content: null })]);
        startAssistantTurnRun({ id: "m5", chatId: "other-chat", userId: USER, assistantMessageId: "m5" });
        expect((await read(db, "m5"))!.status).toBe("interrupted");
    });

    it("tolerates a message without a date or citations and lets a read failure through", async () => {
        const { db, failNext } = world([msg("m1", { content: [{ type: "content", text: "x" }], created_at: undefined, citations: "oops" })]);
        expect(await read(db, "m1")).toMatchObject({ createdAt: null, citations: [] });
        failNext("chat_messages", "select", { message: "db down" });
        await expect(read(db, "m1")).rejects.toEqual({ message: "db down" });
    });
});

describe("stopChatTurn", () => {
    it("stops a live turn, reports a finished one and knows nothing of an unknown one", () => {
        const run = startAssistantTurnRun({ id: "t1", chatId: CHAT, userId: USER, assistantMessageId: "t1" })!;
        expect(stopChatTurn({ chatId: "other", turnId: "t1" })).toBeNull();
        expect(stopChatTurn({ chatId: CHAT, turnId: "nope" })).toBeNull();
        expect(stopChatTurn({ chatId: CHAT, turnId: "t1" })).toEqual({ stopped: true, finished: false });
        expect(run.stopped).toBe(true);
        run.finish();
        expect(stopChatTurn({ chatId: CHAT, turnId: "t1" })).toEqual({ stopped: false, finished: true });
    });
});

describe("chat origin", () => {
    it("writes origin columns only for a connected app, and trims the label", () => {
        expect(chatOriginColumns(undefined)).toEqual({});
        expect(chatOriginColumns({ grantId: "g", label: "  Claude  " })).toEqual({ origin: "mcp", origin_grant_id: "g", origin_label: "Claude" });
        expect(chatOriginColumns({ grantId: "g", label: "   " }).origin_label).toBeNull();
        expect(String(chatOriginColumns({ grantId: "g", label: "x".repeat(300) }).origin_label)).toHaveLength(120);
    });

    it("adds origin to list rows, 'web' when the chat did not come from an app", async () => {
        const { db, tables, failNext } = world([]);
        tables.chats.push({ id: "a", origin: "web", origin_label: null }, { id: "b", origin: "mcp", origin_label: "Claude" });
        expect(await withChatOrigin(db, [])).toEqual({ ok: true, data: [] });
        expect(await withChatOrigin(db, [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual({
            ok: true,
            data: [
                { id: "a", origin: "web", origin_label: null },
                { id: "b", origin: "mcp", origin_label: "Claude" },
                { id: "c", origin: "web", origin_label: null },
            ],
        });
        failNext("chats", "select", { message: "db down" });
        expect(await withChatOrigin(db, [{ id: "a" }])).toMatchObject({ ok: false });
    });

    it("reports a read failure when listing a connection's conversations", async () => {
        const { db, failNext } = world([]);
        failNext("chats", "select", { message: "db down" });
        expect(await listChatsCreatedByGrant(db, { userId: USER, userEmail: undefined, grantId: "g", limit: 5 })).toEqual({ ok: false, error: { message: "db down" } });
    });
});
