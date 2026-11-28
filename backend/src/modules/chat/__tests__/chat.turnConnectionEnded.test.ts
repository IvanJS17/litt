/**
 * A chat turn a connected application started, whose connection ended before a
 * tool call: through the real engine and the real model adapter (only the
 * model is scripted) the turn is stored as a STOPPED turn with what was
 * written, and its audit row is the stopped one, as when the person stops it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareChatStream: vi.fn(),
    saveReserved: vi.fn(),
    enqueueChatTurnAudit: vi.fn(),
    adapter: undefined as undefined | ((params: unknown) => Promise<unknown>),
}));

vi.mock("../chat.prepare", () => ({
    prepareChatStream: (...args: unknown[]) => mocks.prepareChatStream(...args),
}));
vi.mock("../chat.crud", () => ({ discardRejectedChatInput: vi.fn(async () => ({ ok: true })) }));
vi.mock("../chat.titles", () => ({ updateChatTitle: vi.fn(async () => ({ ok: true })) }));
vi.mock("../chat.title", () => ({
    generateAssistantChatTitle: vi.fn(async () => "Title"),
    logChatTitleFailure: vi.fn(),
}));
vi.mock("../engine/index", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../engine/index")>()),
    reserveAssistantMessage: vi.fn(async () => null),
    createReservedAssistantMessageUpdater: () => mocks.saveReserved,
    createSubagentRunStore: () => ({ flush: async () => {} }),
    appendAssistantEventsToMessage: vi.fn(async () => true),
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
import { callStep, config, makeModel, step, text, toolCall, finish } from "../../../lib/llm/__tests__/mockLanguageModel";
import { resetAssistantTurnRunsForTests } from "../../../lib/assistantTurnRuns";
import type { Db } from "../../../lib/supabase";
import { parseChatTurnRequest, runChatTurn, startChatTurn, type ChatTurnSink } from "../chat.turn";

const db = {} as Db;

function prepared() {
    return {
        chatId: "chat-1", chatTitle: "Existing title", lastUser: { role: "user", content: "hello" },
        resolvedProjectId: null, completedTurnPersisted: true, approvalEvents: [], allowDocumentMutation: false,
        canReadProjectMemory: false, canCurateProjectMemory: false, memorySharedAudience: false,
        memoryTurn: { activityId: "activity-1" }, docIndex: {},
        docStore: new Map([["doc-0", { storage_path: "p", file_type: "txt", filename: "Lease.txt", inline_text: "Twelve months." }]]),
        apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "hello" }],
        workflowStore: new Map(), webSearch: null, webSearchAccount: null, apiKeys: {}, route: {}, orgId: null,
        titleModel: null, subagentRoutes: null, selectedModel: "gemini-3.8-flash", selectedReasoningLevel: "high",
        nonce: "nonce", trainingNote: null, trainingPlan: null, trainingEgress: async () => {},
    };
}

async function endedTurn(check: () => Promise<boolean>) {
    const model = await makeModel([
        step(...text("Reading the lease. "), toolCall("c1", "read_document", { doc_id: "doc-0" }), finish("tool-calls")),
        callStep("c2", "read_document", { doc_id: "doc-0" }),
    ]);
    mocks.adapter = (params) => streamAiSdk(params as never, config(model));
    const body = parseChatTurnRequest({ messages: [{ role: "user", content: "hello" }], model: "gemini-3.8-flash" });
    if (!body.ok) throw new Error("fixture request must parse");
    const turn = await startChatTurn(db, {
        userId: "u1", userEmail: "u1@test.local", requestId: "req-1", parsed: body.value,
        allowedCapabilities: ["read"], connectionCheck: check,
    });
    if (!turn.ok) throw new Error("turn must start");
    const frames: string[] = [];
    const sink: ChatTurnSink = {
        id: turn.started.run.id, signal: new AbortController().signal,
        write: (frame: string) => (frames.push(frame), true), finish: vi.fn(), touch: () => {}, stopReason: null,
    };
    await runChatTurn(db, turn.started, sink);
    return { frames, model };
}
const frameTypes = (frames: string[]) =>
    frames.map((f) => {
        const body = f.replace(/^data: /, "").trim();
        return body === "[DONE]" ? body : (JSON.parse(body) as { type: string }).type;
    });

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    vi.clearAllMocks();
    mocks.prepareChatStream.mockResolvedValue({ ok: true, prepared: prepared() });
    mocks.saveReserved.mockResolvedValue(null);
});

describe("a chat turn whose connection ended mid-turn", () => {
    it("is stored as a stopped turn with what was written, and audited as stopped", async () => {
        const { frames, model } = await endedTurn(async () => false);

        expect(model.doStreamCalls.length).toBe(1);
        expect(frameTypes(frames)).toContain("cancelled");
        expect(frameTypes(frames)).not.toContain("error");
        expect(mocks.saveReserved).toHaveBeenCalledTimes(1);
        const [events] = mocks.saveReserved.mock.calls[0] as [{ type: string; text?: string }[]];
        expect(events.at(-1)).toEqual({ type: "stopped" });
        expect(events.filter((e) => e.type === "error")).toEqual([]);
        expect(events.filter((e) => e.type === "content").map((e) => e.text).join("")).toBe("Reading the lease. ");
        expect(mocks.enqueueChatTurnAudit).toHaveBeenCalledTimes(1);
        const [, base] = mocks.enqueueChatTurnAudit.mock.calls[0];
        expect(base).toMatchObject({ chatId: "chat-1", status: "cancelled" });
    });

    it("keeps what an earlier call read, and stops before the next round", async () => {
        let asked = 0;
        const { model } = await endedTurn(async () => ++asked < 3); // the first round is good, the second is not
        const [events] = mocks.saveReserved.mock.calls[0] as [{ type: string }[]];
        expect(model.doStreamCalls.length).toBe(2);
        expect(events.filter((e) => e.type === "doc_read")).toHaveLength(1);
        expect(events.at(-1)).toEqual({ type: "stopped" });
        expect(mocks.enqueueChatTurnAudit.mock.calls[0][1]).toMatchObject({ status: "cancelled" });
    });
});
