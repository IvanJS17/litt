import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

// A person in training answers a paused turn's questions: that continues the
// turn. Whatever else the request carries after the paused message is not a
// new question of theirs, and does not reach the model.
const { selection, governed, stage } = vi.hoisted(() => ({
    stage: { value: "pasante" as string | null },
    governed: {
        ok: true,
        pinNow: false,
        route: { provider: "openai-compatible", model: "opencode-go/test", credentialRef: "personal:opencode-go:1" },
        apiKeys: { opencode_go: "model-key" },
    } as Record<string, unknown>,
    selection: {
        ok: true,
        modelSettings: {
            api_keys: {},
            web_search: { enabled: false },
            subagent_routes: undefined,
            title_model: null,
            personalisation: undefined,
            last_selected_chat_model: null,
            last_selected_reasoning_level: null,
        },
        selectedModel: "opencode-go/test",
        selectedReasoningLevel: null,
    } as Record<string, unknown>,
}));

vi.mock("../../user/user.service", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveUserChatSelection: vi.fn(async () => selection),
    governChatRoute: vi.fn(async () => governed),
}));
vi.mock("../../../lib/training", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveTrainingStage: vi.fn(async () => stage.value),
}));
vi.mock("../engine/index", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    appendAskInputsResponseToAssistantMessage: vi.fn(async () => "appended"),
    runApprovedConnectorActions: vi.fn(async () => []),
}));

import { prepareChatStream } from "../chat.prepare";

function permissiveDb(): Db {
    const make = (table: string): unknown => {
        const result = { data: table === "chats" ? { id: "chat-1", title: null, project_id: null } : null, error: null };
        const builder: unknown = new Proxy(() => {}, {
            get: (_t, prop) => {
                if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ ...result, data: result.data && !("id" in (result.data as object)) ? result.data : [] });
                if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve(result);
                return () => builder;
            },
        });
        return builder;
    };
    return { from: make, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as Db;
}

const NEW_QUESTION = "A brand new question the person never framed";
const ANSWERS = "Responses to LiTT's questions:\n1. Court?\nCivil";
type Sent = { role: "user" | "assistant"; content: string };
const usual: Sent[] = [
    { role: "user", content: "First question" },
    { role: "assistant", content: "I need two facts." },
    { role: "user", content: `${ANSWERS}\n\n${NEW_QUESTION}` },
];
const continuation = (messages: Sent[] = usual) =>
    prepareChatStream(permissiveDb(), {
        userId: "u1",
        userEmail: "u1@example.com",
        messages,
        chatId: null,
        inputMessageId: null,
        projectIdProvided: false,
        projectId: null,
        askInputsResponse: {
            type: "ask_inputs_response",
            assistant_message_id: "m2",
            ask_event_id: "e1",
            responses: [{ id: "q1", kind: "text", question: "Court?", answer: "Civil" }],
        } as never,
        requestedModel: undefined,
        requestedReasoning: undefined,
    });

const sentToModel = (prepared: Awaited<ReturnType<typeof continuation>>) =>
    prepared.ok ? JSON.stringify(prepared.prepared.apiMessages) : "";

describe("answering a paused turn's questions as a person in training", () => {
    it("does not pass a new question that rides with the answers to the model", async () => {
        stage.value = "pasante";
        const prepared = await continuation();
        expect(prepared).toMatchObject({ ok: true });
        expect(sentToModel(prepared)).not.toContain(NEW_QUESTION);
    });

    it("leaves the continuation of anyone else as it was sent", async () => {
        stage.value = null;
        const prepared = await continuation();
        expect(sentToModel(prepared)).toContain(NEW_QUESTION);
    });

    // Layouts of the request that carry no paused assistant message followed
    // by the answers: the new question must not reach the model in any.
    it.each([
        ["only the new question", [{ role: "user", content: NEW_QUESTION }]],
        ["the answers and the new question, no assistant message", [{ role: "user", content: `${ANSWERS}\n\n${NEW_QUESTION}` }]],
        ["the new question, then an assistant message last", [{ role: "user", content: NEW_QUESTION }, { role: "assistant", content: "ok" }]],
        ["a paused message, the answers, a new question, an assistant message last", [
            { role: "user", content: "First question" },
            { role: "assistant", content: "I need two facts." },
            { role: "user", content: ANSWERS },
            { role: "user", content: NEW_QUESTION },
            { role: "assistant", content: "ok" },
        ]],
        ["several user messages after the paused one", [
            { role: "user", content: "First question" },
            { role: "assistant", content: "I need two facts." },
            { role: "user", content: ANSWERS },
            { role: "user", content: NEW_QUESTION },
        ]],
    ] as [string, Sent[]][])("does not pass the new question with %s", async (_name, messages) => {
        stage.value = "pasante";
        const prepared = await continuation(messages);
        expect(prepared).toMatchObject({ ok: true });
        expect(sentToModel(prepared)).not.toContain(NEW_QUESTION);
        expect(sentToModel(prepared)).toContain("Continue from them.");
    });

    it("still sends the history up to the paused message", async () => {
        stage.value = "pasante";
        const sent = sentToModel(await continuation());
        expect(sent).toContain("First question");
        expect(sent).toContain("I need two facts.");
    });

    it.each([
        ["only the new question", [{ role: "user", content: NEW_QUESTION }]],
        ["an assistant message last", [{ role: "user", content: NEW_QUESTION }, { role: "assistant", content: "ok" }]],
    ] as [string, Sent[]][])("leaves the request of anyone else with %s as it was sent", async (_name, messages) => {
        stage.value = null;
        expect(sentToModel(await continuation(messages))).toContain(NEW_QUESTION);
    });
});
