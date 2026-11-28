/**
 * A matter chat turn a connected application started, whose connection ended
 * before a tool call: through the real engine and the real model adapter (only
 * the model is scripted) the turn is stored as a STOPPED turn with what was
 * written, and its audit row is the stopped one, as when the person stops it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareProjectChatStream: vi.fn(),
    insertAssistantMessage: vi.fn(),
    enqueueChatTurnAudit: vi.fn(),
    adapter: undefined as undefined | ((params: unknown) => Promise<unknown>),
}));

vi.mock("../projectChat.prepare", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../projectChat.prepare")>()),
    prepareProjectChatStream: (...args: unknown[]) => mocks.prepareProjectChatStream(...args),
    updateChatTitle: vi.fn(async () => ({ ok: true })),
    insertAssistantMessage: (...args: unknown[]) => mocks.insertAssistantMessage(...args),
}));
vi.mock("../../chat/chat.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../chat/chat.service")>()),
    reserveAssistantMessage: vi.fn(async () => null),
    createSubagentRunStore: () => ({ flush: async () => {} }),
    generateAssistantChatTitle: vi.fn(async () => "Title"),
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
vi.mock("../../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/audit")>()),
    enqueueChatTurnAudit: (...args: unknown[]) => mocks.enqueueChatTurnAudit(...args),
}));
vi.mock("../../../lib/citationSupport", () => ({ createCitationSupportTurn: vi.fn(async () => null) }));
vi.mock("../../../lib/trainingTurn", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/trainingTurn")>()),
    finishTrainingTurn: vi.fn(),
}));

import { streamAiSdk } from "../../../lib/llm/aiSdk";
import { config, makeModel, step, text, toolCall, finish } from "../../../lib/llm/__tests__/mockLanguageModel";
import { resetAssistantTurnRunsForTests } from "../../../lib/assistantTurnRuns";
import type { Db } from "../../../lib/supabase";
import { parseProjectChatRequest, runProjectChatTurn, startProjectChatTurn } from "../projectChat.turn";

const db = {} as Db;

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    vi.clearAllMocks();
    mocks.insertAssistantMessage.mockResolvedValue({ ok: true });
    mocks.prepareProjectChatStream.mockResolvedValue({
        ok: true,
        prepared: {
            chatId: "chat-1", chatTitle: "Title", lastUser: { role: "user", content: "hello" },
            completedTurnPersisted: true, approvalEvents: [], allowDocumentMutation: false,
            memorySharedAudience: false, memoryTurn: { activityId: "activity-1" }, docIndex: {},
            docStore: new Map([["doc-0", { storage_path: "p", file_type: "txt", filename: "Lease.txt", inline_text: "Twelve months." }]]),
            apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "hello" }],
            workflowStore: new Map(), webSearch: null, webSearchAccount: null, apiKeys: {}, route: {}, orgId: null,
            titleModel: null, subagentRoutes: null, selectedModel: "gemini-3.8-flash", selectedReasoningLevel: "high",
            nonce: "nonce", trainingNote: null, trainingPlan: null, trainingEgress: async () => {},
        },
    });
});

describe("a matter chat turn whose connection ended mid-turn", () => {
    it("is stored as a stopped turn with what was written, and audited as stopped", async () => {
        const model = await makeModel([
            step(...text("Reading the lease. "), toolCall("c1", "read_document", { doc_id: "doc-0" }), finish("tool-calls")),
        ]);
        mocks.adapter = (params) => streamAiSdk(params as never, config(model));
        const body = parseProjectChatRequest({ messages: [{ role: "user", content: "hello" }], model: "gemini-3.8-flash" });
        if (!body.ok) throw new Error("fixture request must parse");
        const turn = await startProjectChatTurn(db, {
            userId: "u1", userEmail: "u1@test.local", requestId: undefined, projectId: "p1", parsed: body.value,
            allowedCapabilities: ["read"], connectionCheck: async () => false,
        });
        if (!turn.ok) throw new Error("turn must start");
        const frames: string[] = [];
        await runProjectChatTurn(db, turn.started, {
            id: turn.started.run.id, signal: new AbortController().signal,
            write: (frame: string) => (frames.push(frame), true), finish: vi.fn(), touch: () => {}, stopReason: null,
        });

        expect(model.doStreamCalls.length).toBe(1);
        expect(frames.join("")).toContain('"type":"cancelled"');
        expect(frames.join("")).not.toContain('"type":"error"');
        expect(mocks.insertAssistantMessage).toHaveBeenCalledTimes(1);
        const stored = mocks.insertAssistantMessage.mock.calls[0][1] as { events: { type: string; text?: string }[] };
        expect(stored.events.at(-1)).toEqual({ type: "stopped" });
        expect(stored.events.filter((e) => e.type === "error")).toEqual([]);
        expect(stored.events.filter((e) => e.type === "content").map((e) => e.text).join("")).toBe("Reading the lease. ");
        expect(mocks.enqueueChatTurnAudit.mock.calls[0][1]).toMatchObject({ chatId: "chat-1", status: "cancelled" });
    });
});
