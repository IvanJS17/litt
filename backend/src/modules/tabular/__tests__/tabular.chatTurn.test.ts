/**
 * The tabular review chat turn without HTTP: what a turn started by a
 * connected application hands the assistant engine (its connection's tool
 * capabilities), and that the web route's turn hands none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareTabularChat: vi.fn(),
    runLLMStream: vi.fn(),
}));

vi.mock("../tabular.chats", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.chats")>()),
    prepareTabularChat: (...args: unknown[]) => mocks.prepareTabularChat(...args),
    saveTabularChatTurn: vi.fn(async () => ({ saved: true, error: null })),
}));
vi.mock("../../chat/chat.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../chat/chat.service")>()),
    runLLMStream: (...args: unknown[]) => mocks.runLLMStream(...args),
}));
vi.mock("../../../lib/memory/schedule", () => ({
    releaseMemoryConversationTurn: vi.fn(async () => undefined),
    scheduleMemoryConsolidation: vi.fn(async () => ({ job_id: "job-1" })),
}));

import type { Db } from "../../../lib/supabase";
import { scheduleMemoryConsolidation } from "../../../lib/memory/schedule";
import { resetStreamRunsForTests, MAX_LIVE_RUNS_PER_USER, startStreamRun } from "../../../lib/streamRuns";
import { parseTabularChatRequest, runTabularChatTurn, startTabularChatTurn } from "../tabular.chatTurn";

const db = {} as Db;

const parsed = (() => {
    const result = parseTabularChatRequest({ messages: [{ role: "user", content: "hello" }], model: "test-model" });
    if (!result.ok) throw new Error("fixture request must parse");
    return result.value;
})();

async function start(allowedCapabilities?: Parameters<typeof startTabularChatTurn>[1]["allowedCapabilities"]) {
    const turn = await startTabularChatTurn(db, {
        userId: "u1",
        userEmail: "u1@test.local",
        reviewId: "r1",
        parsed,
        ...(allowedCapabilities ? { allowedCapabilities } : {}),
    });
    if (!turn.ok) throw new Error("turn must start");
    return turn.started;
}

const sink = () => ({
    id: "turn-1",
    signal: new AbortController().signal,
    write: () => true,
    finish: vi.fn(),
    touch: () => {},
    stopReason: null,
});

beforeEach(() => {
    resetStreamRunsForTests();
    mocks.runLLMStream.mockReset();
    mocks.runLLMStream.mockResolvedValue({ fullText: "ok", events: [{ type: "content", text: "ok" }] });
    mocks.prepareTabularChat.mockReset();
    mocks.prepareTabularChat.mockResolvedValue({
        ok: true,
        data: {
            reviewTitle: null,
            tabularStore: { cells: [] },
            chatId: null,
            chatTitle: null,
            isFirstExchange: false,
            model: "test-model",
            reasoningLevel: "high",
            titleModel: "test-model",
            apiKeys: {},
            orgId: null,
            apiMessages: [],
            inputMessageId: "m1",
            sourceDocumentIds: [],
            readableMemoryProjectId: null,
            writableMemoryProjectId: null,
            memorySharedAudience: false,
            memoryTurn: null,
            trainingNote: null,
            trainingPlan: null,
            trainingEgress: async () => {},
        },
    });
});

describe("startTabularChatTurn", () => {
    it("refuses with 429 when the person already has the most live runs", async () => {
        const prepared = await mocks.prepareTabularChat.getMockImplementation()!();
        mocks.prepareTabularChat.mockResolvedValue({ ...prepared, data: { ...prepared.data, chatId: "chat-1" } });
        for (let n = 0; n < MAX_LIVE_RUNS_PER_USER; n += 1) {
            startStreamRun({ id: `held-${n}`, key: `held:${n}`, userId: "u1", forcedStopFrames: [] });
        }
        const refused = await startTabularChatTurn(db, { userId: "u1", userEmail: "u1@test.local", reviewId: "r1", parsed });
        expect(refused).toMatchObject({ ok: false, kind: "status", status: 429, body: { code: "rate_limited" } });
    });
});

describe("runTabularChatTurn", () => {
    it("hands the key the conversation is pinned to to the engine", async () => {
        const base = (await mocks.prepareTabularChat()) as { ok: true; data: Record<string, unknown> };
        mocks.prepareTabularChat.mockResolvedValue({
            ok: true,
            data: { ...base.data, credentialRef: "org:o1:claude:v3" },
        });
        await runTabularChatTurn(db, await start(), sink());
        expect(mocks.runLLMStream.mock.calls[0][0]).toMatchObject({ credentialRef: "org:o1:claude:v3" });
    });

    it("schedules no memory consolidation for a turn a connected app started, and schedules it for a web turn", async () => {
        const prepared = await mocks.prepareTabularChat.getMockImplementation()!();
        mocks.prepareTabularChat.mockResolvedValue({ ...prepared, data: { ...prepared.data, chatId: "chat-1" } });
        vi.mocked(scheduleMemoryConsolidation).mockClear();
        await runTabularChatTurn(db, await start(["read", "write"]), sink());
        expect(vi.mocked(scheduleMemoryConsolidation)).not.toHaveBeenCalled();

        mocks.prepareTabularChat.mockResolvedValue({ ...prepared, data: { ...prepared.data, chatId: "chat-2" } });
        await runTabularChatTurn(db, await start(), sink());
        expect(vi.mocked(scheduleMemoryConsolidation)).toHaveBeenCalledTimes(1);
    });

    it("hands the connection check of a connected app's turn to the engine, and none for a turn the web starts", async () => {
        const connectionCheck = async () => true;
        const narrowed = await startTabularChatTurn(db, {
            userId: "u1", userEmail: "u1@test.local", reviewId: "r1", parsed,
            allowedCapabilities: ["read"], connectionCheck,
        });
        if (!narrowed.ok) throw new Error("turn must start");
        await runTabularChatTurn(db, narrowed.started, sink());
        expect(mocks.runLLMStream.mock.calls[0][0].connectionCheck).toBe(connectionCheck);

        await runTabularChatTurn(db, await start(), sink());
        expect(mocks.runLLMStream.mock.calls[1][0].connectionCheck).toBeUndefined();
    });

    it("hands a connected app's tool capabilities to the engine, and none for a turn the web starts", async () => {
        await runTabularChatTurn(db, await start(["read"]), sink());
        expect(mocks.runLLMStream.mock.calls[0][0]).toMatchObject({ allowedCapabilities: ["read"] });

        await runTabularChatTurn(db, await start(), sink());
        expect(mocks.runLLMStream.mock.calls[1][0].allowedCapabilities).toBeUndefined();
    });
});
