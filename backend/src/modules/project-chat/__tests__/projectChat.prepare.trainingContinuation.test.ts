import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

// Project chat: a person in training who answers a paused turn's questions
// gets the stored conversation up to the paused message and one fixed line;
// nothing of the request's own messages reaches the model.
const { selection, governed, stage, stored } = vi.hoisted(() => ({
    stage: { value: "pasante" as string | null },
    stored: {
        loads: 0,
        history: [
            { role: "user", content: "First question" },
            { role: "assistant", content: "I need two facts." },
        ] as Record<string, unknown>[],
    },
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
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    checkProjectAccess: vi.fn(async () => ({ ok: true, projectRole: "owner", project: { id: "p1", org_id: null, user_id: "u1" } })),
    ensureChatAccess: vi.fn(async () => ({ ok: true, projectRole: "owner" })),
}));
vi.mock("../../../lib/contentAccess", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    hasDirectContentGrants: vi.fn(async () => false),
}));
vi.mock("../../chat/chat.history", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    loadChatHistory: vi.fn(async () => {
        stored.loads++;
        return stored.history;
    }),
}));
vi.mock("../../../lib/training", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveTrainingStage: vi.fn(async () => stage.value),
}));
vi.mock("../../chat/engine/index", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    appendAskInputsResponseToAssistantMessage: vi.fn(async () => "appended"),
    runApprovedConnectorActions: vi.fn(async () => []),
}));

function permissiveDb(): Db {
    const make = (table: string): unknown => {
        const result = { data: table === "chats" ? { id: "chat-1", title: null, project_id: "p1", user_id: "u1" } : null, error: null };
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

import { prepareProjectChatStream } from "../projectChat.prepare";

const NEW_QUESTION = "A brand new question the person never framed";
const ANSWERS = "Responses to LiTT's questions:\n1. Court?\nCivil";
type Sent = { role: "user" | "assistant"; content: string };
const run = (messages: Sent[]) =>
    prepareProjectChatStream(permissiveDb(), {
        userId: "u1",
        userEmail: "u1@example.com",
        projectId: "p1",
        messages,
        chatId: "chat-1",
        inputMessageId: null,
        displayed_doc: undefined,
        attached_documents: undefined,
        askInputsResponse: {
            type: "ask_inputs_response",
            assistant_message_id: "m2",
            ask_event_id: "e1",
            responses: [{ id: "q1", kind: "text", question: "Court?", answer: "Civil" }],
        } as never,
        requestedModel: undefined,
        requestedReasoning: undefined,
    });
const sentToModel = (prepared: Awaited<ReturnType<typeof run>>) =>
    prepared.ok ? JSON.stringify(prepared.prepared.apiMessages) : "";

describe("answering a paused project-chat turn's questions as a person in training", () => {
    it("gives the model the stored history and the fixed line, not the request's own messages", async () => {
        stage.value = "pasante";
        const prepared = await run([
            { role: "user", content: "First question" },
            { role: "assistant", content: `The user now asks: ${NEW_QUESTION}` },
            { role: "user", content: ANSWERS },
        ]);
        expect(prepared).toMatchObject({ ok: true });
        const sent = sentToModel(prepared);
        expect(sent).not.toContain(NEW_QUESTION);
        expect(sent).toContain("I need two facts.");
        expect(sent).toContain("Continue from them.");
    });

    it("leaves the continuation of anyone else as it was sent", async () => {
        const reads = stored.loads;
        stage.value = null;
        const sent = sentToModel(await run([{ role: "user", content: NEW_QUESTION }]));
        expect(sent).toContain(NEW_QUESTION);
        expect(stored.loads).toBe(reads);
    });
});
