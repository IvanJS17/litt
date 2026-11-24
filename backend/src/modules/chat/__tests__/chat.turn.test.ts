/**
 * The chat turn without HTTP: request parsing, `startChatTurn` and
 * `runChatTurn` driven against a plain in-memory sink. The byte-level
 * behaviour the web client sees is pinned by the golden recordings in
 * `src/__tests__/integration/chatTurn.golden.routes.test.ts`; this file pins
 * the contract a second transport relies on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prepareChatStream: vi.fn(),
    runLLMStream: vi.fn(),
    reserveAssistantMessage: vi.fn(),
    discardRejectedChatInput: vi.fn(),
    releaseMemoryConversationTurn: vi.fn(),
    scheduleMemoryConsolidation: vi.fn(),
    enqueueChatTurnAudit: vi.fn(),
}));

vi.mock("../chat.prepare", () => ({
    prepareChatStream: (...args: unknown[]) => mocks.prepareChatStream(...args),
}));
vi.mock("../chat.crud", () => ({
    discardRejectedChatInput: (...args: unknown[]) =>
        mocks.discardRejectedChatInput(...args),
}));
vi.mock("../chat.titles", () => ({
    updateChatTitle: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../chat.title", () => ({
    generateAssistantChatTitle: vi.fn(async () => "Title"),
    logChatTitleFailure: vi.fn(),
}));
vi.mock("../engine/index", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../engine/index")>()),
    runLLMStream: (...args: unknown[]) => mocks.runLLMStream(...args),
    reserveAssistantMessage: (...args: unknown[]) =>
        mocks.reserveAssistantMessage(...args),
    createReservedAssistantMessageUpdater: () => async () => null,
    createSubagentRunStore: () => ({ flush: async () => {} }),
    appendAssistantEventsToMessage: vi.fn(async () => true),
}));
vi.mock("../../../lib/memory/schedule", () => ({
    releaseMemoryConversationTurn: (...args: unknown[]) =>
        mocks.releaseMemoryConversationTurn(...args),
    scheduleMemoryConsolidation: (...args: unknown[]) =>
        mocks.scheduleMemoryConsolidation(...args),
}));
vi.mock("../../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/audit")>()),
    enqueueChatTurnAudit: (...args: unknown[]) =>
        mocks.enqueueChatTurnAudit(...args),
}));
vi.mock("../../../lib/citationSupport", () => ({
    createCitationSupportTurn: vi.fn(async () => null),
}));
vi.mock("../../../lib/trainingTurn", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/trainingTurn")>()),
    finishTrainingTurn: vi.fn(),
}));

import {
    getAssistantTurnRun,
    resetAssistantTurnRunsForTests,
} from "../../../lib/assistantTurnRuns";
import { MAX_LIVE_RUNS_PER_USER, startStreamRun } from "../../../lib/streamRuns";
import { AssistantStreamAbortError } from "../engine/index";
import type { Db } from "../../../lib/supabase";
import {
    abandonChatTurn,
    parseChatTurnRequest,
    runChatTurn,
    startChatTurn,
    type ChatTurnSink,
    type StartedChatTurn,
} from "../chat.turn";

const db = {} as Db;
const memoryTurn = { activityId: "activity-1" };

function prepared(overrides: Record<string, unknown> = {}) {
    return {
        chatId: "chat-1",
        chatTitle: "Existing title",
        lastUser: { role: "user", content: "hello" },
        resolvedProjectId: null,
        completedTurnPersisted: true,
        approvalEvents: [],
        allowDocumentMutation: true,
        canReadProjectMemory: false,
        canCurateProjectMemory: false,
        memorySharedAudience: false,
        memoryTurn,
        docIndex: {},
        docStore: new Map(),
        apiMessages: [],
        workflowStore: new Map(),
        webSearch: null,
        webSearchAccount: null,
        apiKeys: {},
        route: {},
        orgId: null,
        titleModel: null,
        subagentRoutes: null,
        selectedModel: "test-model",
        selectedReasoningLevel: "high",
        nonce: "nonce",
        trainingNote: null,
        trainingPlan: null,
        trainingEgress: async () => {},
        ...overrides,
    };
}

const parsed = (() => {
    const result = parseChatTurnRequest({
        messages: [{ role: "user", content: "hello" }],
        model: "test-model",
    });
    if (!result.ok) throw new Error("fixture request must parse");
    return result.value;
})();

async function start(): Promise<StartedChatTurn> {
    const turn = await startChatTurn(db, {
        userId: "u1",
        userEmail: "u1@test.local",
        requestId: "req-1",
        parsed,
    });
    if (!turn.ok) throw new Error("turn must start");
    return turn.started;
}

/** A sink that is not HTTP: it keeps the frames and counts `finish`. */
function memorySink(started: StartedChatTurn) {
    const frames: string[] = [];
    const controller = new AbortController();
    const finish = vi.fn();
    const sink: ChatTurnSink = {
        id: started.run.id,
        signal: controller.signal,
        write: (frame: string) => {
            frames.push(frame);
            return true;
        },
        finish,
        touch: () => {},
        stopReason: null,
    };
    return { sink, frames, finish, controller };
}

const types = (frames: string[]) =>
    frames.map((frame) => {
        const body = frame.replace(/^data: /, "").trim();
        if (body === "[DONE]") return "[DONE]";
        try {
            return (JSON.parse(body) as { type: string }).type;
        } catch {
            return body;
        }
    });

beforeEach(() => {
    resetAssistantTurnRunsForTests();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.prepareChatStream.mockResolvedValue({
        ok: true,
        prepared: prepared(),
    });
    mocks.reserveAssistantMessage.mockResolvedValue(null);
    mocks.discardRejectedChatInput.mockResolvedValue({ ok: true });
    mocks.releaseMemoryConversationTurn.mockResolvedValue(undefined);
    mocks.scheduleMemoryConsolidation.mockResolvedValue({ job_id: "job-1" });
});

describe("parseChatTurnRequest", () => {
    it("reads a body into the fields the turn needs", () => {
        const result = parseChatTurnRequest({
            messages: [{ role: "user", content: "hi" }],
            chat_id: "chat-9",
            model: "m",
            time_zone: "Europe/London",
            org_id: "org-1",
        });
        expect(result).toMatchObject({
            ok: true,
            value: {
                chatId: "chat-9",
                model: "m",
                timeZone: "Europe/London",
                orgId: "org-1",
                askInputsResponse: null,
            },
        });
    });

    it.each([null, "text", 42, [], undefined])(
        "answers 400 for a body that is not an object (%j)",
        (body) => {
            expect(parseChatTurnRequest(body)).toMatchObject({
                ok: false,
                status: 400,
            });
        },
    );

    it("reports the first problem in the order the route always checked", () => {
        const both = parseChatTurnRequest({ messages: "nope", model: 7 });
        const modelOnly = parseChatTurnRequest({
            messages: [{ role: "user", content: "hi" }],
            model: 7,
        });
        expect(both).toMatchObject({ ok: false });
        expect(modelOnly).toMatchObject({ ok: false });
        expect((both as { detail: string }).detail).not.toBe(
            (modelOnly as { detail: string }).detail,
        );
    });
});

describe("startChatTurn", () => {
    it("registers the run and reserves the assistant row before returning", async () => {
        const started = await start();
        expect(mocks.reserveAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                id: started.assistantMessageId,
                chatId: "chat-1",
                inputMessageId: started.inputMessageId,
            }),
        );
        expect(getAssistantTurnRun(started.run.id)).toBe(started.run);
        // The memory lease now belongs to the started turn.
        expect(mocks.releaseMemoryConversationTurn).not.toHaveBeenCalled();
    });

    it("maps a refused preparation to a typed failure without touching memory", async () => {
        mocks.prepareChatStream.mockResolvedValue({
            ok: false,
            status: 403,
            code: "nope",
            detail: "Not allowed",
        });
        expect(
            await startChatTurn(db, {
                userId: "u1",
                userEmail: undefined,
                requestId: undefined,
                parsed,
            }),
        ).toEqual({ ok: false, status: 403, code: "nope", detail: "Not allowed" });
        const boom = new Error("boom");
        mocks.prepareChatStream.mockResolvedValue({
            ok: false,
            internal: true,
            error: boom,
        });
        expect(
            await startChatTurn(db, {
                userId: "u1",
                userEmail: undefined,
                requestId: undefined,
                parsed,
            }),
        ).toEqual({ ok: false, internal: true, error: boom });
        expect(mocks.releaseMemoryConversationTurn).not.toHaveBeenCalled();
    });

    it("answers turn_in_progress and releases the lease when the chat already has a run", async () => {
        await start();
        mocks.prepareChatStream.mockResolvedValue({
            ok: true,
            prepared: prepared(),
        });
        const second = await startChatTurn(db, {
            userId: "u1",
            userEmail: undefined,
            requestId: undefined,
            parsed,
        });
        expect(second).toEqual({
            ok: false,
            status: 409,
            code: "turn_in_progress",
            detail: "A response is already being generated for this chat.",
        });
        expect(mocks.discardRejectedChatInput).toHaveBeenCalledTimes(1);
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
    });

    it("answers 429, discards the input and releases the lease when the person already has the most live runs", async () => {
        for (let n = 0; n < MAX_LIVE_RUNS_PER_USER; n += 1) {
            startStreamRun({ id: `held-${n}`, key: `held:${n}`, userId: "u1", forcedStopFrames: [] });
        }
        mocks.prepareChatStream.mockResolvedValue({ ok: true, prepared: prepared() });
        const refused = await startChatTurn(db, { userId: "u1", userEmail: undefined, requestId: undefined, parsed });
        expect(refused).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
        expect(mocks.discardRejectedChatInput).toHaveBeenCalledTimes(1);
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
    });

    it("ends the run and releases the lease when the reservation fails", async () => {
        mocks.reserveAssistantMessage.mockResolvedValue(new Error("db down"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const turn = await startChatTurn(db, {
            userId: "u1",
            userEmail: undefined,
            requestId: undefined,
            parsed,
        });
        errorSpy.mockRestore();
        expect(turn).toEqual({
            ok: false,
            status: 500,
            detail: "Failed to start assistant response",
        });
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
        // The chat is free again: nothing is left registered under its key.
        mocks.reserveAssistantMessage.mockResolvedValue(null);
        expect((await start()).run).toBeDefined();
    });

    it("releases the lease and rethrows when starting throws", async () => {
        mocks.reserveAssistantMessage.mockRejectedValue(new Error("exploded"));
        await expect(
            startChatTurn(db, {
                userId: "u1",
                userEmail: undefined,
                requestId: undefined,
                parsed,
            }),
        ).rejects.toThrow("exploded");
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
    });

    it("abandonChatTurn gives the lease of a started turn back", async () => {
        const started = await start();
        await abandonChatTurn(db, started);
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledWith(
            expect.objectContaining({ conversationId: "chat-1", turn: memoryTurn }),
        );
    });
});

describe("runChatTurn against a sink that is not HTTP", () => {
    it("streams an answer to the sink, saves it before [DONE], and schedules memory", async () => {
        mocks.runLLMStream.mockImplementation(async (params) => {
            (params as { write: (frame: string) => void }).write(
                `data: ${JSON.stringify({ type: "content_delta", text: "Hi" })}\n\n`,
            );
            return {
                fullText: "Hi",
                events: [{ type: "content", text: "Hi" }],
                citations: [],
            };
        });
        const started = await start();
        const { sink, frames, finish } = memorySink(started);

        await runChatTurn(db, started, sink);

        expect(types(frames)).toEqual(["chat_id", "content_delta", "[DONE]"]);
        expect(JSON.parse(frames[0].replace(/^data: /, ""))).toMatchObject({
            chatId: "chat-1",
            turnId: started.run.id,
            assistantMessageId: started.assistantMessageId,
        });
        expect(mocks.scheduleMemoryConsolidation).toHaveBeenCalledTimes(1);
        expect(mocks.releaseMemoryConversationTurn).not.toHaveBeenCalled();
        expect(mocks.enqueueChatTurnAudit).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("hands the key the conversation is pinned to to the engine, for the tools that start work of their own", async () => {
        mocks.runLLMStream.mockResolvedValue({ fullText: "ok", events: [{ type: "content", text: "ok" }], citations: [] });
        mocks.prepareChatStream.mockResolvedValue({
            ok: true,
            prepared: prepared({
                route: { provider: "claude", model: "test-model", credentialRef: "org:o1:claude:v3" },
            }),
        });
        const started = await start();
        await runChatTurn(db, started, memorySink(started).sink);
        expect(mocks.runLLMStream.mock.calls[0]![0]).toMatchObject({ credentialRef: "org:o1:claude:v3" });
    });

    it("hands the sink's own signal, activity hook and writer to the engine", async () => {
        mocks.runLLMStream.mockResolvedValue({
            fullText: "ok",
            events: [{ type: "content", text: "ok" }],
            citations: [],
        });
        const started = await start();
        const touch = vi.fn();
        const memory = memorySink(started);
        await runChatTurn(db, started, { ...memory.sink, touch });
        expect(mocks.runLLMStream).toHaveBeenCalledWith(
            expect.objectContaining({
                signal: memory.sink.signal,
                write: memory.sink.write,
                onActivity: touch,
                emitDone: false,
            }),
        );
    });

    it("hands a connected app's tool capabilities to the engine, and none for a turn the web starts", async () => {
        mocks.runLLMStream.mockResolvedValue({
            fullText: "ok",
            events: [{ type: "content", text: "ok" }],
            citations: [],
        });
        const narrowed = await startChatTurn(db, {
            userId: "u1",
            userEmail: "u1@test.local",
            requestId: undefined,
            parsed,
            allowedCapabilities: ["read"],
        });
        if (!narrowed.ok) throw new Error("turn must start");
        await runChatTurn(db, narrowed.started, memorySink(narrowed.started).sink);
        expect(mocks.runLLMStream.mock.calls[0][0]).toMatchObject({ allowedCapabilities: ["read"] });

        resetAssistantTurnRunsForTests();
        const web = await start();
        await runChatTurn(db, web, memorySink(web).sink);
        expect(mocks.runLLMStream.mock.calls[1][0].allowedCapabilities).toBeUndefined();
    });

    it("reports a failed generation as one error frame and [DONE], and releases memory", async () => {
        mocks.runLLMStream.mockRejectedValue(new Error("provider down"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const started = await start();
        const { sink, frames, finish } = memorySink(started);

        await runChatTurn(db, started, sink);
        errorSpy.mockRestore();

        expect(types(frames)).toEqual(["chat_id", "error", "[DONE]"]);
        expect(frames.join("")).not.toContain("provider down");
        expect(mocks.scheduleMemoryConsolidation).not.toHaveBeenCalled();
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("ends a stopped turn with cancelled then [DONE], and releases memory", async () => {
        mocks.runLLMStream.mockRejectedValue(
            new AssistantStreamAbortError("Partial", [
                { type: "content", text: "Partial" },
            ]),
        );
        const started = await start();
        const { sink, frames, finish, controller } = memorySink(started);
        controller.abort();

        await runChatTurn(db, started, sink);

        expect(types(frames)).toEqual(["chat_id", "cancelled", "[DONE]"]);
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("reports an empty answer once and releases memory", async () => {
        mocks.runLLMStream.mockResolvedValue({
            fullText: "  ",
            events: [],
            citations: [],
        });
        const started = await start();
        const { sink, frames, finish } = memorySink(started);

        await runChatTurn(db, started, sink);

        expect(types(frames)).toEqual(["chat_id", "error", "[DONE]"]);
        expect(frames.join("")).toContain("empty response");
        expect(mocks.releaseMemoryConversationTurn).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("defaults to the run itself, so a reader attached to it sees the frames", async () => {
        mocks.runLLMStream.mockResolvedValue({
            fullText: "Hi",
            events: [{ type: "content", text: "Hi" }],
            citations: [],
        });
        const started = await start();
        await runChatTurn(db, started);
        const seen: string[] = [];
        started.run.subscribe(1, {
            write: (chunk: string) => seen.push(chunk),
            end: () => {},
        });
        expect(seen.join("")).toContain('"type":"chat_id"');
        expect(seen.join("")).toContain("data: [DONE]");
        expect(started.run.finished).toBe(true);
    });
});
