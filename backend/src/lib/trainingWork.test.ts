import { describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import { judgeWork, judgeWorkMatters, judgeWorks, openMatters, workKey, type WorkRef } from "./trainingWork";

// Who may open which matter: lib/access owns the matter rule.
const { openable } = vi.hoisted(() => ({ openable: new Set<string>() }));
vi.mock("./access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./access")>()),
    loadOpenableProjects: vi.fn(async (_db: unknown, userId: string, _email: unknown, ids: readonly string[]) => {
        return new Map(ids.filter((id) => openable.has(`${id}:${userId}`)).map((id) => [id, { orgId: null }]));
    }),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const READER = { actorId: id(2), actorEmail: "mentor@example.test" };
const OTHER_PERSONS_DOC = id(31);
const PROJECT = id(70);
const withheld = [{ type: "doc_read", filename: "x.docx", document_id: OTHER_PERSONS_DOC }];
const openOnly = [{ type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null }];

function wordChats(count: number, source: (index: number) => Row[]) {
    const chats: Row[] = [];
    const messages: Row[] = [];
    for (let index = 0; index < count; index += 1) {
        const chat = id(1000 + index);
        chats.push({ id: chat, user_id: id(1), title: `t${index}` });
        messages.push(
            { id: id(5000 + index * 2), chat_id: chat, role: "user", files: null, citations: null, content: "q", created_at: "2026-11-10T10:00:01Z" },
            { id: id(5001 + index * 2), chat_id: chat, role: "assistant", files: null, citations: null, content: [...source(index), { type: "content", text: "a" }], created_at: "2026-11-10T10:00:02Z" },
        );
    }
    return { word_chats: chats, word_chat_messages: messages, documents: [{ id: OTHER_PERSONS_DOC, user_id: id(3), project_id: null, org_id: null }] };
}
const wordWork = (index: number): WorkRef => ({ surface: "word", chatId: id(1000 + index) });

describe("the decision of which training works a reader may see", () => {
    it("judges a Word chat by what its answers drew on, from the work alone", async () => {
        const world = memoryDb(wordChats(2, (index) => (index === 0 ? withheld : openOnly)));
        expect((await judgeWork(world.db, wordWork(0), READER)).open).toBe(false);
        expect((await judgeWork(world.db, wordWork(1), READER)).open).toBe(true);
    });

    it("judges a work in a matter by the matter, and a gone chat as not shown", async () => {
        openable.clear();
        const world = memoryDb({ chats: [{ id: id(80), project_id: PROJECT, title: "in a matter" }, { id: id(81), project_id: null, title: "free" }] });
        const works: WorkRef[] = [{ surface: "chat", chatId: id(80) }, { surface: "chat", chatId: id(81) }, { surface: "chat", chatId: id(82) }];
        const closed = await judgeWorks(world.db, works, READER);
        expect(works.map((work) => closed.get(workKey(work))?.open)).toEqual([false, true, false]);
        expect(closed.get(workKey(works[2]))?.place).toBeNull();
        openable.add(`${PROJECT}:${READER.actorId}`);
        const opened = await judgeWorks(world.db, works, READER);
        expect(works.map((work) => opened.get(workKey(work))?.open)).toEqual([true, true, false]);
        openable.clear();
    });

    it("a lookup that fails refuses: it throws instead of granting", async () => {
        const messages = memoryDb(wordChats(1, () => openOnly));
        messages.failNext("word_chat_messages", "select", { message: "unavailable" });
        await expect(judgeWork(messages.db, wordWork(0), READER)).rejects.toBeDefined();
        const chats = memoryDb(wordChats(1, () => openOnly));
        chats.failNext("word_chats", "select", { message: "unavailable" });
        await expect(judgeWork(chats.db, wordWork(0), READER)).rejects.toBeDefined();
    });

    it("judges each chat once for a list of 200 works, whatever the names of the list", async () => {
        const world = memoryDb(wordChats(200, (index) => (index % 2 ? withheld : openOnly)));
        const counts: Record<string, number> = {};
        const from = world.db.from.bind(world.db);
        (world.db as unknown as { from: (table: string) => unknown }).from = (table: string) => {
            counts[table] = (counts[table] ?? 0) + 1;
            return from(table);
        };
        const works = Array.from({ length: 200 }, (_, index) => wordWork(index));
        const sights = await judgeWorks(world.db, [...works, ...works], READER);
        expect(works.map((work) => sights.get(workKey(work))?.open)).toEqual(works.map((_, index) => index % 2 === 0));
        // at most two reads of the answers per Word chat (the answers, then what they cite)
        expect(counts.word_chat_messages).toBeLessThanOrEqual(2 * 200);
        expect(counts.word_chats).toBeLessThanOrEqual(2 * 200);
        console.log("queries for 200 Word chats:", JSON.stringify(counts));
    });

    it("the matter-only form leaves a Word chat's answers to the reader that judges them itself", async () => {
        const world = memoryDb(wordChats(1, () => withheld));
        expect((await judgeWorkMatters(world.db, [wordWork(0)], READER)).get(workKey(wordWork(0)))?.open).toBe(true);
    });

    it("opens no matter when none is asked", async () => {
        expect((await openMatters(memoryDb({}).db, READER, [])).size).toBe(0);
    });
});
