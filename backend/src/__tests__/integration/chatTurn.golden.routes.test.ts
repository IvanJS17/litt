/**
 * Golden recording of POST /chat.
 *
 * Each scenario drives one real turn through the route with the real chat
 * engine (`runLLMStream`) and a scripted language model, then compares two
 * committed fixtures under `__golden__/`:
 *
 *   <name>.sse            the response body, byte for byte
 *   <name>.timeline.json  every response write and database/memory side
 *                         effect, in the order they happened
 *
 * Ids and timestamps are replaced by stable placeholders; nothing else is
 * touched. The fixtures describe what the web client receives today, so a
 * refactor of the turn loop must leave them unchanged. To re-record after an
 * intentional wire change: `UPDATE_GOLDEN=1 npm test -- chatTurn.golden`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { streamAiSdk } from "../../lib/llm/aiSdk";
import {
    callStep,
    config,
    makeModel,
    step,
    text,
    textStep,
    finish,
    tick,
} from "../../lib/llm/__tests__/mockLanguageModel";

vi.hoisted(() => {
    process.env.RATE_LIMIT_CHAT_MAX = "1000";
});

const { timeline, dbRows, dbControl, memory } = vi.hoisted(() => ({
    // One ordered log of everything observable: response writes and effects.
    timeline: [] as { k: string; v: unknown }[],
    dbRows: [] as Record<string, unknown>[],
    dbControl: {
        failAssistantReservation: false,
        // Docs the (stubbed) document loader reports for the turn.
        docs: false,
    },
    memory: {
        begin: vi.fn(),
        release: vi.fn(),
        schedule: vi.fn(),
    },
}));

const { streamWithProvider, unexpectedFetch } = vi.hoisted(() => ({
    streamWithProvider: vi.fn(),
    unexpectedFetch: vi.fn(() => {
        throw new Error("Unexpected network request in chat golden test");
    }),
}));

vi.mock("../../lib/firmProfileStore", () => ({
    loadFirmProfileFor: vi.fn(async () => null),
}));
vi.mock("../../lib/training", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/training")>()),
    resolveTrainingStage: vi.fn(async () => null),
    resolveWordTrainingStage: vi.fn(async () => ({ stage: null, orgId: null })),
}));
vi.mock("../../modules/chat/chat.title", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/chat/chat.title.js")>()),
    generateAssistantChatTitle: vi.fn(async () => "Generated Title"),
}));
vi.mock("../../lib/llm/providers", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm/providers")>()),
    streamWithProvider: (...args: unknown[]) => streamWithProvider(...args),
}));
vi.mock("../../lib/mcpConnectors", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/mcpConnectors")>()),
    buildUserMcpTools: vi.fn(async () => []),
}));
vi.mock("../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm")>()),
    completeText: vi.fn(async () => "Generated Title"),
}));
vi.mock("../../lib/memory/schedule", () => ({
    beginMemoryConversationTurn: async (...args: unknown[]) => {
        timeline.push({ k: "memory.begin", v: null });
        return memory.begin(...args);
    },
    releaseMemoryConversationTurn: async (...args: unknown[]) => {
        timeline.push({ k: "memory.release", v: null });
        return memory.release(...args);
    },
    scheduleMemoryConsolidation: async (...args: unknown[]) => {
        timeline.push({ k: "memory.schedule", v: null });
        return memory.schedule(...args);
    },
}));
vi.mock("../../modules/user/user.settings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        web_search: {},
        title_model: null,
        memory_curator_model: null,
        subagent_model: null,
        subagent_reasoning: null,
        subagent_routes: { routes: [], default: null },
        last_selected_reasoning_level: null,
        tabular_model: null,
        last_selected_chat_model: "gpt-6-luna",
        api_keys: { openai: "test-key" },
    })),
    persistLastSelectedChatModel: vi.fn(async () => null),
    persistLastSelectedReasoningLevel: vi.fn(async () => null),
}));

// Authenticate as "u1" and record every write the route makes to the socket.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: {
            locals: Record<string, unknown>;
            write: (chunk: unknown, ...rest: unknown[]) => boolean;
        },
        next: () => void,
    ) => {
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        const write = res.write.bind(res);
        res.write = (chunk: unknown, ...rest: unknown[]) => {
            timeline.push({ k: "sse", v: String(chunk) });
            return write(chunk, ...rest);
        };
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

// Only the document context is stubbed (it would read storage); the engine,
// prompt builder and stream loop are the real ones.
vi.mock("../../modules/chat/engine/index", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../modules/chat/engine/index")>();
    return {
        ...actual,
        buildDocContext: vi.fn(async () =>
            dbControl.docs
                ? {
                      docIndex: {
                          "doc-0": {
                              document_id: "doc-id-1",
                              filename: "contract.txt",
                              version_id: null,
                              version_number: null,
                          },
                      },
                      docStore: new Map([
                          [
                              "doc-0",
                              {
                                  storage_path: "",
                                  file_type: "txt",
                                  filename: "contract.txt",
                                  inline_text:
                                      "The tenant shall pay rent on the first day of each month.",
                              },
                          ],
                      ]),
                  }
                : { docIndex: {}, docStore: new Map() },
        ),
        buildWorkflowStore: vi.fn(async () => new Map()),
    };
});

function makeQuery(table: string) {
    let result: { data: unknown; error: { message: string } | null } = {
        data: { id: "chat-1", title: null, user_id: "u1", project_id: null },
        error: null,
    };
    const q: Record<string, unknown> = {};
    let update: { value: unknown; filters: Record<string, unknown> } | null =
        null;
    let didSelect = false;
    const filters: Record<string, unknown> = {};
    for (const m of [
        "delete",
        "upsert",
        "neq",
        "in",
        "is",
        "or",
        "lt",
        "gt",
        "gte",
        "lte",
        "filter",
        "range",
        "contains",
        "not",
        "order",
        "limit",
    ])
        q[m] = vi.fn(() => q);
    q.select = vi.fn(() => {
        didSelect = true;
        return q;
    });
    q.insert = vi.fn((value: unknown) => {
        timeline.push({ k: "db.insert", v: { table, value } });
        const row = value as Record<string, unknown>;
        if (table === "chat_messages") {
            if (
                dbControl.failAssistantReservation &&
                row.role === "assistant"
            ) {
                result = { data: null, error: { message: "reserve failed" } };
            } else {
                dbRows.push({ ...row });
            }
        }
        return q;
    });
    q.update = vi.fn((value: unknown) => {
        update = { value, filters: {} };
        return q;
    });
    q.eq = vi.fn((column: string, value: unknown) => {
        if (update) update.filters[column] = value;
        else filters[column] = value;
        return q;
    });
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    q.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
    ) => {
        const run = async () => {
            if (update) {
                timeline.push({
                    k: "db.update",
                    v: { table, value: update.value, filters: update.filters },
                });
                if (table === "chat_messages") {
                    for (const row of dbRows) {
                        if (
                            Object.entries(update.filters).every(
                                ([c, v]) => row[c] === v,
                            )
                        )
                            Object.assign(row, update.value);
                    }
                }
                return result;
            }
            if (didSelect && table === "chat_messages") {
                const rows = dbRows.filter((row) =>
                    Object.entries(filters).every(([c, v]) => row[c] === v),
                );
                return { data: rows, error: null };
            }
            return result;
        };
        return run().then(resolve, reject);
    };
    return q;
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => ({
        from: vi.fn((table: string) => makeQuery(table)),
        rpc: vi.fn(async (name: string, args: unknown) => {
            timeline.push({ k: "db.rpc", v: { name, args } });
            return {
                data: name.startsWith("append_chat_") ? "appended" : null,
                error: null,
            };
        }),
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
        },
    })),
}));

process.env.OPENAI_API_KEY ??= "test-key";
import { app } from "../../app";
import { resetAssistantTurnRunsForTests } from "../../lib/assistantTurnRuns";
import { expectGoldenTurn } from "../helpers/goldenTurn";

function expectGolden(
    name: string,
    res: { status: number; text: string; headers: Record<string, unknown> },
) {
    expectGoldenTurn({ prefix: "chatTurn", name, res, timeline });
}

const BODY = {
    messages: [{ role: "user", content: "What does the contract say?" }],
    model: "gpt-6.1-sol",
};

function useModel(model: Awaited<ReturnType<typeof makeModel>>) {
    streamWithProvider.mockImplementationOnce((params) =>
        streamAiSdk(params, config(model)),
    );
}

function post(body: object = BODY) {
    return request(app)
        .post("/chat")
        .set("Authorization", "Bearer test")
        .send(body)
        .then((res) => res);
}

const CITED_ANSWER =
    "Rent is due monthly [1].\n" +
    '<CITATIONS>[{"ref":1,"doc_id":"doc-0","page":1,' +
    '"quote":"The tenant shall pay rent on the first day of each month."}]' +
    "</CITATIONS>";

describe("POST /chat — golden SSE recording", () => {
    beforeEach(() => {
        resetAssistantTurnRunsForTests();
        streamWithProvider.mockReset();
        unexpectedFetch.mockClear();
        vi.stubGlobal("fetch", unexpectedFetch);
        timeline.length = 0;
        dbRows.length = 0;
        dbControl.failAssistantReservation = false;
        dbControl.docs = false;
        memory.begin.mockReset().mockResolvedValue({ activityId: "activity-1" });
        memory.release.mockReset().mockResolvedValue(undefined);
        memory.schedule
            .mockReset()
            .mockResolvedValue({ job_id: "job-1", generation: 1 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        expect(unexpectedFetch).not.toHaveBeenCalled();
    });

    it("plain answer", async () => {
        useModel(await makeModel([textStep("Hello, how can I help?")]));
        const res = await post();
        expect(res.status).toBe(200);
        expectGolden("answer", res);
    });

    it("answer with a verified citation", async () => {
        dbControl.docs = true;
        useModel(await makeModel([textStep(CITED_ANSWER)]));
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"citations"');
        expectGolden("citations", res);
    });

    it("a tool call, then the answer", async () => {
        dbControl.docs = true;
        useModel(
            await makeModel([
                callStep("call-1", "read_document", { doc_id: "doc-0" }),
                textStep(CITED_ANSWER),
            ]),
        );
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"doc_read"');
        expectGolden("tool-call", res);
    });

    it("a citation by filename is stored under the document it cites", async () => {
        dbControl.docs = true;
        const byFilename = CITED_ANSWER.replace('"doc_id":"doc-0"', '"doc_id":"contract.txt"');
        expect(byFilename).not.toBe(CITED_ANSWER);
        useModel(
            await makeModel([
                callStep("call-1", "read_document", { doc_id: "contract.txt" }),
                textStep(byFilename),
            ]),
        );
        const res = await post();
        expect(res.status).toBe(200);
        const stored = dbRows.find((row) => row.role === "assistant") as {
            citations: Record<string, unknown>[];
        };
        const citation = stored.citations.find((c) => c.ref === 1);
        expect(citation).toMatchObject({
            doc_id: "contract.txt",
            document_id: "doc-id-1",
            document: { document_id: "doc-id-1" },
        });
    });

    it("a clarification pause (ask_inputs)", async () => {
        useModel(
            await makeModel([
                callStep("ask-1", "ask_inputs", {
                    items: [
                        {
                            id: "jurisdiction",
                            kind: "text",
                            question: "Which jurisdiction?",
                        },
                    ],
                }),
                textStep("must not run after a clarification pause"),
            ]),
        );
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"ask_inputs"');
        expectGolden("ask-inputs", res);
    });

    it("a stop while the model is writing", async () => {
        const { MockLanguageModelV3 } = await import("ai/test");
        let streaming: () => void = () => {};
        const started = new Promise<void>((resolve) => {
            streaming = resolve;
        });
        const model = new MockLanguageModelV3({
            doStream: async ({ abortSignal }: { abortSignal?: AbortSignal }) => ({
                stream: new ReadableStream({
                    start(controller) {
                        controller.enqueue({ type: "stream-start", warnings: [] });
                        controller.enqueue({
                            type: "response-metadata",
                            id: "resp",
                            modelId: "mock",
                        });
                        controller.enqueue({ type: "text-start", id: "t0" });
                        controller.enqueue({
                            type: "text-delta",
                            id: "t0",
                            delta: "Partial answer",
                        });
                        abortSignal?.addEventListener("abort", () => {
                            const error = new Error("Stream aborted.");
                            error.name = "AbortError";
                            controller.error(error);
                        });
                        streaming();
                    },
                }),
            }),
        });
        useModel(model as Awaited<ReturnType<typeof makeModel>>);
        const response = post();
        await started;
        await tick();
        const assistantId = (
            dbRows.find((row) => row.role === "assistant") as { id: string }
        ).id;
        const stopped = await request(app)
            .post(`/chat/chat-1/turn/${assistantId}/stop`)
            .set("Authorization", "Bearer test");
        expect(stopped.body).toEqual({ stopped: true, finished: false });
        const res = await response;
        expect(res.text).toContain('"type":"cancelled"');
        expectGolden("stop", res);
    });

    it("a provider failure", async () => {
        const failure = new Error("upstream provider exploded");
        useModel(await makeModel([failure]));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await post();
        errorSpy.mockRestore();
        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"error"');
        expectGolden("error", res);
    });

    it("an empty model response", async () => {
        useModel(await makeModel([step(finish("stop"))]));
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.text).toContain("empty response");
        expectGolden("empty", res);
    });

    it("a second turn while one is generating answers 409", async () => {
        const { MockLanguageModelV3 } = await import("ai/test");
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let streaming: () => void = () => {};
        const started = new Promise<void>((resolve) => {
            streaming = resolve;
        });
        const model = new MockLanguageModelV3({
            doStream: async () => {
                streaming();
                await gate;
                return step(...text("Late answer"), finish("stop"));
            },
        });
        useModel(model as Awaited<ReturnType<typeof makeModel>>);
        const first = post({ ...BODY, chat_id: "chat-1" });
        await started;
        timeline.length = 0;
        const second = await post({ ...BODY, chat_id: "chat-1" });
        expect(second.status).toBe(409);
        expectGolden("turn-in-progress", second);
        release();
        await first;
    });

    it("a failed assistant reservation answers 500 before any stream", async () => {
        dbControl.failAssistantReservation = true;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await post();
        errorSpy.mockRestore();
        expect(res.status).toBe(500);
        expect(streamWithProvider).not.toHaveBeenCalled();
        expectGolden("reserve-failed", res);
    });
});
