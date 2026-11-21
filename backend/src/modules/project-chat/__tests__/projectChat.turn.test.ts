/**
 * The matter chat turn without HTTP: what a turn started by a connected
 * application hands the assistant engine (its connection's tool capabilities),
 * and that the web route's turn hands none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareProjectChatStream: vi.fn(),
    runLLMStream: vi.fn(),
}));

vi.mock("../projectChat.prepare", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../projectChat.prepare")>()),
    prepareProjectChatStream: (...args: unknown[]) => mocks.prepareProjectChatStream(...args),
    updateChatTitle: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../chat/chat.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../chat/chat.service")>()),
    runLLMStream: (...args: unknown[]) => mocks.runLLMStream(...args),
    reserveAssistantMessage: vi.fn(async () => null),
    createSubagentRunStore: () => ({ flush: async () => {} }),
    generateAssistantChatTitle: vi.fn(async () => "Title"),
}));
vi.mock("../../../lib/memory/schedule", () => ({
    releaseMemoryConversationTurn: vi.fn(async () => undefined),
    scheduleMemoryConsolidation: vi.fn(async () => ({ job_id: "job-1" })),
}));
vi.mock("../../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/audit")>()),
    enqueueChatTurnAudit: vi.fn(),
}));
vi.mock("../../../lib/citationSupport", () => ({
    createCitationSupportTurn: vi.fn(async () => null),
}));
vi.mock("../../../lib/trainingTurn", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/trainingTurn")>()),
    finishTrainingTurn: vi.fn(),
}));

import { resetAssistantTurnRunsForTests } from "../../../lib/assistantTurnRuns";
import type { Db } from "../../../lib/supabase";
import {
    parseProjectChatRequest,
    runProjectChatTurn,
    startProjectChatTurn,
    type StartedProjectChatTurn,
} from "../projectChat.turn";

const db = {} as Db;

const parsed = (() => {
    const result = parseProjectChatRequest({ messages: [{ role: "user", content: "hello" }], model: "test-model" });
    if (!result.ok) throw new Error("fixture request must parse");
    return result.value;
})();

async function start(allowedCapabilities?: Parameters<typeof startProjectChatTurn>[1]["allowedCapabilities"]) {
    const turn = await startProjectChatTurn(db, {
        userId: "u1",
        userEmail: "u1@test.local",
        requestId: undefined,
        projectId: "p1",
        parsed,
        ...(allowedCapabilities ? { allowedCapabilities } : {}),
    });
    if (!turn.ok) throw new Error("turn must start");
    return turn.started;
}

function sinkOf(started: StartedProjectChatTurn) {
    return {
        id: started.run.id,
        signal: new AbortController().signal,
        write: () => true,
        finish: vi.fn(),
        touch: () => {},
        stopReason: null,
    };
}

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    mocks.runLLMStream.mockReset();
    mocks.runLLMStream.mockResolvedValue({ fullText: "ok", events: [{ type: "content", text: "ok" }], citations: [] });
    mocks.prepareProjectChatStream.mockReset();
    mocks.prepareProjectChatStream.mockResolvedValue({
        ok: true,
        prepared: {
            chatId: "chat-1",
            chatTitle: "Title",
            lastUser: { role: "user", content: "hello" },
            completedTurnPersisted: true,
            approvalEvents: [],
            allowDocumentMutation: true,
            memorySharedAudience: false,
            memoryTurn: { activityId: "activity-1" },
            docIndex: {},
            docStore: new Map(),
            apiMessages: [],
            workflowStore: new Map(),
            webSearch: null,
            webSearchAccount: null,
            apiKeys: {},
            orgId: null,
            titleModel: null,
            subagentRoutes: null,
            selectedModel: "test-model",
            selectedReasoningLevel: "high",
            nonce: "nonce",
            trainingNote: null,
            trainingPlan: null,
            trainingEgress: async () => {},
        },
    });
});

describe("runProjectChatTurn", () => {
    it("hands a connected app's tool capabilities to the engine, and none for a turn the web starts", async () => {
        const narrowed = await start(["read"]);
        await runProjectChatTurn(db, narrowed, sinkOf(narrowed));
        expect(mocks.runLLMStream.mock.calls[0][0]).toMatchObject({ allowedCapabilities: ["read"] });

        resetAssistantTurnRunsForTests();
        const web = await start();
        await runProjectChatTurn(db, web, sinkOf(web));
        expect(mocks.runLLMStream.mock.calls[1][0].allowedCapabilities).toBeUndefined();
    });
});
