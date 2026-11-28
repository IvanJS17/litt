// The thread of a table review marks a message a connected app wrote the same
// way the main conversations do: stored with the message, read back for the
// person, and shown to the model after the fixed line inside the app-message
// fence, through the same helpers.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";

const { ensureReviewAccess, checkProjectAccess, filterAccessibleDocumentIds } = vi.hoisted(() => ({
    ensureReviewAccess: vi.fn(),
    checkProjectAccess: vi.fn(),
    filterAccessibleDocumentIds: vi.fn(),
}));
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    ensureReviewAccess,
    checkProjectAccess,
    filterAccessibleDocumentIds,
}));
const { getUserModelSettings } = vi.hoisted(() => ({ getUserModelSettings: vi.fn() }));
vi.mock("../../user/user.settings", () => ({
    getUserModelSettings,
    persistLastSelectedChatModel: vi.fn(async () => null),
    persistLastSelectedReasoningLevel: vi.fn(async () => null),
}));
const { resolveEffectiveChatModel } = vi.hoisted(() => ({ resolveEffectiveChatModel: vi.fn() }));
vi.mock("../../../lib/modelSelection", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/modelSelection")>()),
    resolveEffectiveChatModel,
}));
const loadReviewRows = vi.hoisted(() => vi.fn());
vi.mock("../tabular.rows", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.rows")>()),
    loadReviewRows,
}));
process.env.ANTHROPIC_API_KEY ??= "test-key";

import { listTabularReviewChatMessages, prepareTabularChat } from "../tabular.chats";
import { parseTabularChatRequest } from "../tabular.chatTurn";

const GRANT = "00000000-0000-4000-8000-0000000000a1";
const CHAT = "chat-1";
const LINE = "[Sent through an app the person connected to LiTT, on their behalf; not typed by them in LiTT.]";
const origin = { grantId: GRANT, label: " ZQXAPPNAMEZQX " };
const REVIEW = { id: "rev-1", user_id: "u1", project_id: null, org_id: null, title: "Lease review", columns_config: [{ index: 0, name: "A" }] };

type Msg = { role: "user" | "assistant"; content: string };
const args = (messages: Msg[], extra: Record<string, unknown> = {}) => ({
    reviewId: "rev-1",
    userId: "u1",
    userEmail: "u1@example.com",
    messages,
    lastUserContent: messages.filter((m) => m.role === "user").at(-1)!.content,
    chatId: CHAT as string | undefined,
    requestedModel: undefined,
    requestedReasoning: undefined,
    ...extra,
});
const userRows = (marks: boolean[]): Row[] =>
    marks.map((mark, i) => ({
        id: `m${i}`,
        chat_id: CHAT,
        role: "user",
        content: `message ${i}`,
        created_at: `2026-11-28T10:0${i}:00.000Z`,
        origin: mark ? "mcp" : null,
        origin_label: mark ? "ZQXAPPNAMEZQX" : null,
    }));
const world = (stored: Row[] = []) =>
    memoryDb({
        tabular_reviews: [REVIEW],
        tabular_review_chats: [{ id: CHAT, review_id: "rev-1", user_id: "u1", title: "t", model: "claude-sonnet-5" }],
        tabular_review_chat_messages: stored,
        tabular_cells: [],
    });
// The in-memory database leaves a new row without a send time; the real one stamps it with now, newest of all.
function stampInserts<T extends ReturnType<typeof memoryDb>["db"]>(db: T, table: string): T {
    const real = db.from.bind(db);
    (db as { from: unknown }).from = (name: string) => {
        const query = real(name) as unknown as Record<string, (...args: unknown[]) => unknown>;
        if (name !== table) return query;
        const insert = query.insert.bind(query);
        query.insert = (...args: unknown[]) => {
            const [payload, ...rest] = args as [Row | Row[], ...unknown[]];
            return insert(Array.isArray(payload) ? payload.map((r) => ({ created_at: "2026-11-29T00:00:00.000Z", ...r })) : { created_at: "2026-11-29T00:00:00.000Z", ...payload }, ...rest);
        };
        return query;
    };
    return db;
}

const modelInput = (result: { ok: boolean; data?: { apiMessages: unknown[] } }) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.data!.apiMessages as { role: string; content: string }[];
};

beforeEach(() => {
    vi.clearAllMocks();
    ensureReviewAccess.mockResolvedValue({ ok: true, isCreator: true, orgRole: null, projectRole: "owner" });
    checkProjectAccess.mockResolvedValue({ ok: false });
    filterAccessibleDocumentIds.mockImplementation(async (ids: string[]) => ids);
    loadReviewRows.mockResolvedValue([{ id: "row-1", label: "Contract.pdf" }]);
    getUserModelSettings.mockResolvedValue({ api_keys: {}, last_selected_chat_model: null, last_selected_reasoning_level: null, title_model: null });
    resolveEffectiveChatModel.mockResolvedValue({ ok: true, model: "claude-sonnet-5" });
});

describe("a review thread message a connected app writes", () => {
    it("is stored with its mark, in an existing thread", async () => {
        const w = world();
        const result = await prepareTabularChat(w.db, args([{ role: "user", content: "hola" }], { origin }));
        expect(result.ok).toBe(true);
        expect(w.tables.tabular_review_chat_messages.find((m) => m.role === "user")).toMatchObject({
            origin: "mcp",
            origin_grant_id: GRANT,
            origin_label: "ZQXAPPNAMEZQX",
        });
    });

    it("is never marked when a web request body carries the fields", async () => {
        const parsed = parseTabularChatRequest({
            messages: [{ role: "user", content: "hola", origin: "mcp", origin_label: "X", origin_grant_id: GRANT }],
            chat_id: CHAT,
            origin: "mcp",
            origin_label: "X",
            origin_grant_id: GRANT,
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const w = world();
        const result = await prepareTabularChat(w.db, args(parsed.value.messages as Msg[]));
        expect(result.ok).toBe(true);
        const stored = w.tables.tabular_review_chat_messages.find((m) => m.role === "user")!;
        expect(stored).not.toHaveProperty("origin");
        expect(stored).not.toHaveProperty("origin_grant_id");
        expect(stored).not.toHaveProperty("origin_label");
        expect(JSON.stringify(modelInput(result as never))).not.toContain("app-message");
    });

    it("leaves a message typed on the web without a mark", async () => {
        const w = world();
        const result = await prepareTabularChat(w.db, args([{ role: "user", content: "hola" }]));
        expect(result.ok).toBe(true);
        const stored = w.tables.tabular_review_chat_messages.find((m) => m.role === "user")!;
        expect(stored).not.toHaveProperty("origin");
        expect(stored).not.toHaveProperty("origin_grant_id");
        expect(stored).not.toHaveProperty("origin_label");
    });

    it("is shown to the model after the line, in the app-message fence, with the policy and without the app's name", async () => {
        const w = world();
        const result = await prepareTabularChat(w.db, args([{ role: "user", content: "hola" }], { origin }));
        const input = modelInput(result as never);
        const content = input.at(-1)!.content;
        expect(content).toMatch(new RegExp(`${LINE.replace(/[[\]().]/g, "\\$&")}\\n<app-message nonce="[0-9a-f]{32}">\\nhola\\n</app-message nonce="[0-9a-f]{32}">$`));
        expect(content).not.toContain("untrusted-content");
        expect(input[0].content).toContain("APP MESSAGE POLICY:");
        expect(JSON.stringify(input)).not.toContain("ZQXAPPNAMEZQX");
    });

    it("is shown on that message only in a later turn started on the web, and an ordinary thread is left as it was", async () => {
        const messages: Msg[] = [0, 1, 2].map((i) => ({ role: "user", content: `message ${i}` }));
        const marked = modelInput((await prepareTabularChat(world(userRows([false, true, false])).db, args(messages))) as never);
        const users = marked.filter((m) => m.role === "user");
        expect(users.map((m) => m.content.includes(LINE))).toEqual([false, true, false]);
        expect(users[1].content).toContain(`<app-message nonce="`);
        expect(marked[0].content).toContain("APP MESSAGE POLICY:");

        const plain = modelInput((await prepareTabularChat(world(userRows([false, false, false])).db, args(messages))) as never);
        expect(JSON.stringify(plain)).not.toMatch(/app-message|APP MESSAGE POLICY|connected to LiTT/);
        for (const [i, m] of plain.filter((x) => x.role === "user").entries())
            expect(m.content).toMatch(new RegExp(`^\\[Sent: [^\\]]+\\]\\nmessage ${i}$`));
    });

    it("marks the app's message when the thread holds a stored message the history lacks, as one withheld from the reader", async () => {
        const stored = [...userRows([true]), { ...userRows([false])[0], id: "withheld", content: "withheld", created_at: "2026-11-28T10:09:00.000Z" }];
        const messages: Msg[] = [{ role: "user", content: "message 0" }, { role: "user", content: "next" }];
        const result = await prepareTabularChat(stampInserts(world(stored).db, "tabular_review_chat_messages"), args(messages));
        const users = modelInput(result as never).filter((m) => m.role === "user");
        expect(users.map((m) => m.content.includes(LINE))).toEqual([true, false]);
    });

    it("marks the app's message when fewer rows are stored than the history holds", async () => {
        const messages: Msg[] = ["message 0", "message 1", "next"].map((content) => ({ role: "user" as const, content }));
        const result = await prepareTabularChat(world(userRows([true])).db, args(messages));
        const users = modelInput(result as never).filter((m) => m.role === "user");
        expect(users.map((m) => m.content.includes(LINE))).toEqual([true, false, false]);
    });

    it("ends the turn with an internal error when the mark cannot be read", async () => {
        const w = world(userRows([false, true]));
        const real = w.db.from.bind(w.db);
        const error = { message: "read failed" };
        (w.db as { from: unknown }).from = (table: string) => {
            const query = real(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
            if (table !== "tabular_review_chat_messages") return query;
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
        const result = await prepareTabularChat(w.db, args([0, 1].map((i) => ({ role: "user" as const, content: `message ${i}` }))));
        expect(result).toMatchObject({ ok: false, kind: "error", error });
    });
});

describe("the read of a review thread", () => {
    it("returns the mark and the app's name, and never the connection's id", async () => {
        const rows = userRows([true, false]).map((r) => ({ ...r, origin_grant_id: r.origin ? GRANT : null, annotations: null, source_document_ids: [] }));
        const w = world(rows);
        const listed = await listTabularReviewChatMessages(w.db, { reviewId: "rev-1", chatId: CHAT, userId: "u1", userEmail: "u1@example.com" });
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(listed.data[0]).toMatchObject({ origin: "mcp", origin_label: "ZQXAPPNAMEZQX" });
        expect(JSON.stringify(listed.data)).not.toContain(GRANT);
        expect(listed.data[1]).toMatchObject({ origin: null, origin_label: null });
    });
});
