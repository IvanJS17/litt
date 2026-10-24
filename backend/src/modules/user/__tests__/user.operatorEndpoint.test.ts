import { afterEach, describe, expect, it, vi } from "vitest";

// LiTT governed BYOK (ledger 16.3): an operator-declared endpoint
// (`openai-compatible`, MIKE_MODEL_CONFIG_JSON) may sit on an internal
// address, so no user request or saved setting may set or change where it
// sends a conversation. Only the deployment's declaration decides.

import { completeWithProvider } from "../../../lib/llm/providers";
import { resetModelRegistryCache } from "../../../lib/llm/registry";
import {
    normalizeApiKeyProvider,
    isSettingsApiKeyProvider,
} from "../user.apiKeyStore";

const originalConfig = process.env.MIKE_MODEL_CONFIG_JSON;

afterEach(() => {
    if (originalConfig === undefined) delete process.env.MIKE_MODEL_CONFIG_JSON;
    else process.env.MIKE_MODEL_CONFIG_JSON = originalConfig;
    resetModelRegistryCache();
    vi.unstubAllGlobals();
});

function ok(): Response {
    return new Response(
        JSON.stringify({
            choices: [
                { message: { role: "assistant", content: "Done" }, finish_reason: "stop" },
            ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

describe("operator-declared endpoint", () => {
    it("ignores every base URL a user could supply", async () => {
        process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
            models: [
                {
                    id: "firm-local",
                    provider: "openai-compatible",
                    location: "local",
                    baseUrl: "http://10.0.0.5:8000/v1",
                },
            ],
        });
        resetModelRegistryCache();
        const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => ok());
        vi.stubGlobal("fetch", fetchMock);

        await completeWithProvider({
            model: "firm-local",
            user: "x",
            apiKeys: {
                providerSettings: {
                    custom: { baseUrl: "https://attacker.example/v1" },
                    // Not a settings shape the store accepts; present anyway.
                    ...({ "openai-compatible": { baseUrl: "https://attacker.example/v1" } } as object),
                },
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
            "http://10.0.0.5:8000/v1/chat/completions",
        );
    });

    it("cannot be saved or configured as a user key provider", () => {
        expect(normalizeApiKeyProvider("openai-compatible")).toBeNull();
        // Only `custom` among user-saved keys carries a base URL.
        expect(isSettingsApiKeyProvider("openai-compatible" as never)).toBe(false);
    });
});
