import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../../../__tests__/helpers/memoryDb";
import { loadAppWrittenUserMessages, loadUserMessageSentTimes } from "../contextBuilders";

// A message of the history is presented with the app mark when its text equals
// the text of a message a connected app wrote in that conversation. The marks
// come from the stored rows, never from the request, and no position is
// involved: the history a request carries may differ from the stored rows.

const CHAT = "c1";
const row = (i: number, marked: boolean, over: Row = {}): Row => ({
    id: `m${String(i).padStart(4, "0")}`,
    chat_id: CHAT,
    role: "user",
    content: `message ${i}`,
    created_at: new Date(Date.UTC(2026, 10, 28, 0, 0, i)).toISOString(),
    origin: marked ? "mcp" : null,
    ...over,
});
const say = (...texts: (string | null)[]) => texts.map((content) => ({ role: "user" as const, content: content as string }));
const ask = (stored: Row[], history: { role: "user"; content: string }[], table = "chat_messages") =>
    loadAppWrittenUserMessages(memoryDb({ [table]: stored }).db, table, CHAT, history);

describe("loadAppWrittenUserMessages", () => {
    it("marks the history's messages whose text an app wrote, whatever their position", async () => {
        const stored = [row(0, false), row(1, true), row(2, false), row(3, true), row(4, false)];
        expect(await ask(stored, say("message 0", "message 1", "message 2", "message 3", "message 4"))).toEqual({
            ok: true,
            marks: [false, true, false, true, false],
        });
    });

    it("marks the app's message when the conversation holds a stored person-message the history does not contain", async () => {
        const stored = [row(0, false), row(1, true), row(2, false, { content: "stored only" })];
        expect(await ask(stored, say("message 0", "message 1"))).toEqual({ ok: true, marks: [false, true] });
    });

    it("marks the app's message when fewer rows are stored than the history holds", async () => {
        expect(await ask([row(0, true)], say("message 0", "message 1", "message 2"))).toEqual({ ok: true, marks: [true, false, false] });
    });

    it("marks nothing for a message of the history that is not stored", async () => {
        expect(await ask([row(0, true)], say("something else"))).toEqual({ ok: true, marks: [false] });
    });

    it("does not mark a message whose text was changed after it was stored", async () => {
        expect(await ask([row(0, true)], say("message 0 (edited)"))).toEqual({ ok: true, marks: [false] });
    });

    it("marks a message the person typed with exactly the text an app wrote (accepted: the mark restricts nothing)", async () => {
        const stored = [row(0, true, { content: "same words" }), row(1, false, { content: "same words" })];
        expect(await ask(stored, say("same words", "same words"))).toEqual({ ok: true, marks: [true, true] });
    });

    it("never matches an empty or a null body", async () => {
        const stored = [row(0, true, { content: "" }), row(1, true, { content: null }), row(2, true)];
        expect(await ask(stored, say("", null, "message 2"))).toEqual({ ok: true, marks: [false, false, true] });
    });

    it("looks only at the app's messages of this conversation", async () => {
        const stored = [row(0, false), row(1, true, { chat_id: "other" }), row(2, true, { role: "assistant" })];
        expect(await ask(stored, say("message 0", "message 1", "message 2"))).toEqual({ ok: true, marks: [false, false, false] });
    });

    it("reads the review thread table the same way", async () => {
        const stored = [row(0, false), row(1, true)];
        expect(await ask(stored, say("message 1", "message 0"), "tabular_review_chat_messages")).toEqual({ ok: true, marks: [true, false] });
    });

    it("reads a conversation with more than one page of app-written rows", async () => {
        const stored = Array.from({ length: 501 }, (_, i) => row(i, true));
        expect(await ask(stored, say("message 0", "not stored", "message 500", "message 250"))).toEqual({ ok: true, marks: [true, false, true, true] });
    });

    it("reports a failed read instead of treating every message as the person's own, while the send times stay blank", async () => {
        const w = memoryDb({ chat_messages: [row(0, true)] });
        w.failNext("chat_messages", "select", { message: "boom" });
        const failed = await loadAppWrittenUserMessages(w.db, "chat_messages", CHAT, say("message 0"));
        expect(failed).toEqual({ ok: false, error: { message: "boom" } });
        w.failNext("chat_messages", "select", { message: "boom" });
        expect(await loadUserMessageSentTimes(w.db, "chat_messages", CHAT, say("message 0"))).toEqual([null]);
    });

    it("needs no read when there is no stored conversation or no person-message", async () => {
        const w = memoryDb({ chat_messages: [row(0, true)] });
        expect(await loadAppWrittenUserMessages(w.db, "chat_messages", null, say("a", "b"))).toEqual({ ok: true, marks: [false, false] });
        w.failNext("chat_messages", "select", { message: "boom" });
        expect(await loadAppWrittenUserMessages(w.db, "chat_messages", CHAT, [{ role: "assistant", content: "x" }])).toEqual({ ok: true, marks: [] });
    });
});
