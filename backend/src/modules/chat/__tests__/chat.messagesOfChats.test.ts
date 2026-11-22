import { describe, expect, it } from "vitest";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { getAttachmentsOfChats, getMessagesOfChats } from "../chat.messages";

type Row = Record<string, unknown>;
const uid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 0, 0, 0) + n * 1000).toISOString();

// 130 chats of 20 messages: 2600 rows, more than the gateway returns at once, over more chats than one filter takes.
const world = () => {
  const chats: string[] = [];
  const chat_messages: Row[] = [];
  for (let c = 0; c < 130; c++) {
    const chat = uid("c0c0c0c0", c);
    chats.push(chat);
    for (let m = 0; m < 20; m++)
      chat_messages.push({
        id: uid("c1c1c1c1", c * 100 + m),
        chat_id: chat,
        role: m % 2 ? "assistant" : "user",
        content: m % 2 ? [{ type: "content", text: "ok" }] : "hola",
        files: m > 0 && m % 2 === 0 ? [{ filename: "a.docx", document_id: uid("d0d0d0d0", c) }] : null,
        citations: null,
        created_at: at(m),
      });
  }
  return { chats, chat_messages };
};

describe("getMessagesOfChats", () => {
  it("reads every message of every chat: in batches of chats, and past the gateway's row limit, oldest first", async () => {
    const { chats, chat_messages } = world();
    const { db, calls } = tableDb({ chat_messages }, { maxRows: 1000, maxInList: 50 });
    const rows = await getMessagesOfChats(db, chats);
    expect(rows).toHaveLength(2600);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2600);
    const times = rows.map((row) => String(row.created_at));
    expect([...times].sort()).toEqual(times);
    expect(Math.max(...calls.flatMap((call) => call.inSizes))).toBeLessThanOrEqual(50);
    expect(calls.every((call) => call.returned <= 1000)).toBe(true);
    // Three batches of chats, each read in pages until an empty one: not one read per chat.
    expect(calls.length).toBeLessThan(15);
  });

  it("fails, rather than returns what it has, when a read fails", async () => {
    const { chats, chat_messages } = world();
    const { db } = tableDb({ chat_messages }, { failSelects: ["chat_messages"] });
    await expect(getMessagesOfChats(db, chats)).rejects.toThrow();
  });
});

describe("getAttachmentsOfChats", () => {
  it("reads only the person's messages and only the columns it needs, in batches and past the row limit", async () => {
    const { chats, chat_messages } = world();
    const { db, calls } = tableDb({ chat_messages }, { maxRows: 1000, maxInList: 50 });
    const selected: string[] = [];
    const spied = {
      from: (table: string) => {
        const query = (db as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table);
        const select = query.select.bind(query);
        query.select = (columns: unknown) => (selected.push(String(columns)), select(columns));
        return query;
      },
    } as unknown as Parameters<typeof getAttachmentsOfChats>[0];
    const rows = await getAttachmentsOfChats(spied, chats);
    // 130 chats x 9 messages of the person that attach files: more than one page of the gateway; the one without files is not read.
    expect(rows).toHaveLength(1170);
    expect(rows.every((row) => row.role === "user" && Array.isArray(row.files))).toBe(true);
    expect(selected.length).toBeGreaterThan(0);
    for (const columns of selected) expect(columns).not.toMatch(/\*|content|citations/);
    expect(Math.max(...calls.flatMap((call) => call.inSizes))).toBeLessThanOrEqual(50);
    expect(calls.length).toBeLessThan(15);
  });

  it("fails when a read fails", async () => {
    const { chats, chat_messages } = world();
    const { db } = tableDb({ chat_messages }, { failSelects: ["chat_messages"] });
    await expect(getAttachmentsOfChats(db, chats)).rejects.toThrow();
  });
});
