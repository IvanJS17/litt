import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

// Project chat: a person in training who answers a paused turn's questions
// gets the stored conversation up to the paused message and one fixed line;
// nothing of the request's own messages reaches the model.
const { selection, governed, stage, stored, docs } = vi.hoisted(() => ({
    docs: { index: {} as Record<string, { document_id: string; filename: string }> },
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
    buildProjectDocContext: vi.fn(async () => ({ docIndex: docs.index, docStore: new Map(), folderPaths: new Map() })),
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
const run = (messages: Sent[], extra: Record<string, unknown> = {}) =>
    prepareProjectChatStream(permissiveDb(), {
        userId: "u1",
        userEmail: "u1@example.com",
        projectId: "p1",
        messages,
        chatId: "chat-1",
        inputMessageId: null,
        displayed_doc: undefined,
        attached_documents: undefined,
        ...extra,
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

    // The names that reach the model are the stored names of documents of the
    // project, never text of the request.
    const REQUEST_NAME = "Request-given name that is not a stored one";
    const paused: Sent[] = [
        { role: "user", content: "First question" },
        { role: "assistant", content: "I need two facts." },
    ];
    const withFiles = (files: unknown[]) => [...paused, { role: "user", content: ANSWERS, files } as never];
    const stored1 = () => {
        docs.index = { "doc-0": { document_id: "d1", filename: "stored.docx" } };
    };

    it("keeps a document the answers attach, with its stored name", async () => {
        stage.value = "pasante";
        stored1();
        const sent = sentToModel(await run(withFiles([{ filename: REQUEST_NAME, document_id: "d1" }])));
        expect(sent).toContain("stored.docx");
        expect(sent).not.toContain(REQUEST_NAME);
    });

    it.each([
        ["a file entry with no id", { messages: withFiles([{ filename: REQUEST_NAME }]) }],
        ["a file entry with an unknown id", { messages: withFiles([{ filename: REQUEST_NAME, document_id: "unknown" }]) }],
        ["a displayed document with an unknown id", { displayed_doc: { document_id: "unknown", filename: REQUEST_NAME } }],
        ["an attached document with an unknown id", { attached_documents: [{ document_id: "unknown", filename: REQUEST_NAME }] }],
    ])("does not pass %s to the model", async (_name, req) => {
        stage.value = "pasante";
        stored1();
        const { messages, ...extra } = req as { messages?: Sent[] };
        const prepared = await run(messages ?? [...paused, { role: "user", content: ANSWERS }], extra);
        expect(prepared).toMatchObject({ ok: true });
        expect(sentToModel(prepared)).not.toContain(REQUEST_NAME);
        expect(sentToModel(prepared)).toContain("Continue from them.");
    });

    it("keeps a displayed and an attached document of the project, with their stored names", async () => {
        stage.value = "pasante";
        stored1();
        const sent = sentToModel(
            await run([...paused, { role: "user", content: ANSWERS }], {
                displayed_doc: { document_id: "d1", filename: REQUEST_NAME },
                attached_documents: [{ document_id: "d1", filename: REQUEST_NAME }],
            }),
        );
        expect(sent).toContain("stored.docx");
        expect(sent).not.toContain(REQUEST_NAME);
    });

    it.each([null, "junior"])("leaves names of a continuation as sent when the stage is %s", async (value) => {
        stage.value = value;
        docs.index = {};
        const sent = sentToModel(
            await run(withFiles([{ filename: "file-" + REQUEST_NAME }]), {
                displayed_doc: { document_id: "unknown", filename: "shown-" + REQUEST_NAME },
                attached_documents: [{ document_id: "unknown", filename: "att-" + REQUEST_NAME }],
            }),
        );
        for (const p of ["file-", "shown-", "att-"]) expect(sent).toContain(p + REQUEST_NAME);
    });
});
