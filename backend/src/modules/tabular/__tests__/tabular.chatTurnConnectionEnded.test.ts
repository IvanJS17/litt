/**
 * A tabular review chat turn a connected application started, whose
 * connection ended before a tool call: through the real engine and the real
 * model adapter (only the model is scripted) the turn is stored as a STOPPED
 * turn with what was written, as when the person stops it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareTabularChat: vi.fn(),
    saveTabularChatTurn: vi.fn(),
    adapter: undefined as undefined | ((params: unknown) => Promise<unknown>),
}));

vi.mock("../tabular.chats", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.chats")>()),
    prepareTabularChat: (...args: unknown[]) => mocks.prepareTabularChat(...args),
    saveTabularChatTurn: (...args: unknown[]) => mocks.saveTabularChatTurn(...args),
}));
vi.mock("../../../lib/llm", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("../../../lib/llm/models")),
    streamChatWithTools: (params: unknown) => mocks.adapter!(params),
}));
vi.mock("../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));
vi.mock("../../../lib/integrations/googleWorkspace", async (load) => ({
    ...(await load<object>()),
    buildGoogleWorkspaceTools: async () => [],
}));
vi.mock("../../../lib/memory/schedule", () => ({
    releaseMemoryConversationTurn: vi.fn(async () => undefined),
    scheduleMemoryConsolidation: vi.fn(async () => ({ job_id: "job-1" })),
}));

import { streamAiSdk } from "../../../lib/llm/aiSdk";
import { config, makeModel, step, text, toolCall, finish } from "../../../lib/llm/__tests__/mockLanguageModel";
import type { Db } from "../../../lib/supabase";
import { resetStreamRunsForTests } from "../../../lib/streamRuns";
import { parseTabularChatRequest, runTabularChatTurn, startTabularChatTurn } from "../tabular.chatTurn";

const db = {} as Db;

beforeEach(() => {
    resetStreamRunsForTests();
    vi.clearAllMocks();
    mocks.saveTabularChatTurn.mockResolvedValue({ saved: true, error: null });
    mocks.prepareTabularChat.mockResolvedValue({
        ok: true,
        data: {
            reviewTitle: null, tabularStore: { cells: [] }, chatId: "chat-1", chatTitle: "Title", isFirstExchange: false,
            model: "gemini-3.8-flash", reasoningLevel: "high", titleModel: "gemini-3.8-flash", apiKeys: {}, orgId: null,
            apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "hello" }],
            inputMessageId: "m1", sourceDocumentIds: [], readableMemoryProjectId: null, writableMemoryProjectId: null,
            memorySharedAudience: false, memoryTurn: null, trainingNote: null, trainingPlan: null, trainingEgress: async () => {},
        },
    });
});

describe("a tabular chat turn whose connection ended mid-turn", () => {
    it("is stored as a stopped turn with what was written", async () => {
        const model = await makeModel([
            step(...text("Reading the cells. "), toolCall("c1", "read_table_cells", {}), finish("tool-calls")),
        ]);
        mocks.adapter = (params) => streamAiSdk(params as never, config(model));
        const body = parseTabularChatRequest({ messages: [{ role: "user", content: "hello" }], model: "gemini-3.8-flash" });
        if (!body.ok) throw new Error("fixture request must parse");
        const turn = await startTabularChatTurn(db, {
            userId: "u1", userEmail: "u1@test.local", reviewId: "r1", parsed: body.value,
            allowedCapabilities: ["read"], connectionCheck: async () => false,
        });
        if (!turn.ok) throw new Error("turn must start");
        const frames: string[] = [];
        await runTabularChatTurn(db, turn.started, {
            id: turn.started.run?.id ?? "turn-1", signal: new AbortController().signal,
            write: (frame: string) => (frames.push(frame), true), finish: vi.fn(), touch: () => {}, stopReason: null,
        });

        expect(model.doStreamCalls.length).toBe(1);
        expect(frames.join("")).toContain('"type":"cancelled"');
        expect(frames.join("")).not.toContain('"type":"error"');
        expect(mocks.saveTabularChatTurn).toHaveBeenCalledTimes(1);
        const stored = mocks.saveTabularChatTurn.mock.calls[0][1] as { content: { type: string; text?: string }[] };
        expect(stored.content.at(-1)).toEqual({ type: "stopped" });
        expect(stored.content.filter((e) => e.type === "error")).toEqual([]);
        expect(stored.content.filter((e) => e.type === "content").map((e) => e.text).join("")).toBe("Reading the cells. ");
    });
});
