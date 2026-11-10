import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

// The conversation is pinned to one model credential (a governed bag with no
// search key). The user's saved keys, which hold the Brave key, are a separate
// source that only the search service may read.
const { governed, selection } = vi.hoisted(() => ({
    governed: {
        ok: true,
        pinNow: false,
        route: { provider: "openai-compatible", model: "opencode-go/test", credentialRef: "personal:opencode-go:1" },
        apiKeys: { opencode_go: "model-key" },
    } as Record<string, unknown>,
    selection: {
        ok: true,
        modelSettings: {
            api_keys: { brave: "brave-key", opencode_go: "model-key" },
            web_search: { enabled: true, claude: "provider", openai: "provider", other: "brave" },
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

import { prepareChatStream } from "../chat.prepare";

// Every table answers with an empty result; the new chat row answers with its id.
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

describe("prepareChatStream web search key", () => {
    it("plans the search from the user's saved key without adding it to the model's credentials", async () => {
        const prepared = await prepareChatStream(permissiveDb(), {
            userId: "u1",
            userEmail: "u1@example.com",
            messages: [{ role: "user" as const, content: "What is new today?" }],
            chatId: null,
            inputMessageId: null,
            projectIdProvided: false,
            projectId: null,
            askInputsResponse: null,
            requestedModel: undefined,
            requestedReasoning: undefined,
        });

        expect(prepared).toMatchObject({ ok: true });
        if (!prepared.ok) return;
        expect(prepared.prepared.webSearch).toBe("brave");
        expect(prepared.prepared.webSearchAccount).toEqual({ backend: "brave", apiKey: "brave-key" });
        expect(prepared.prepared.apiKeys).toBe(governed.apiKeys);
        expect(prepared.prepared.apiKeys).not.toHaveProperty("brave");
    });
});
