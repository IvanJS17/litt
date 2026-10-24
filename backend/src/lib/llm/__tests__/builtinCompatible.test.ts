import { afterEach, describe, expect, it, vi } from "vitest";

// LiTT governed BYOK (ledger 16.3): DeepSeek and OpenCode Zen are fixed-host
// entries on the OpenAI-compatible adapter, keyed by the user's own key.

import { completeWithProvider } from "../providers";
import { providerForModel } from "../models";
import {
  configuredEndpointSummaries,
  getConfiguredModel,
  resetModelRegistryCache,
} from "../registry";

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

describe("fixed-host OpenAI-compatible entries", () => {
  it.each([
    ["deepseek/deepseek-chat", "deepseek", "sk-ds", "https://api.deepseek.com/v1/chat/completions", "deepseek-chat"],
    ["opencode-zen/deepseek-v4-pro", "opencode-zen", "sk-zen", "https://opencode.ai/inference/openai/v1/chat/completions", "deepseek-v4-pro"],
  ] as const)(
    "%s goes to its fixed host with the user's %s key",
    async (model, keyProvider, key, url, apiModel) => {
      delete process.env.MIKE_MODEL_CONFIG_JSON;
      resetModelRegistryCache();
      const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => ok());
      vi.stubGlobal("fetch", fetchMock);

      expect(providerForModel(model)).toBe("openai-compatible");
      await completeWithProvider({
        model,
        user: "x",
        apiKeys: { [keyProvider]: key },
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(url);
      const init = fetchMock.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
      expect(JSON.parse(String(init?.body)).model).toBe(apiModel);
    },
  );

  it("is unavailable without a key and listed with one", () => {
    delete process.env.MIKE_MODEL_CONFIG_JSON;
    resetModelRegistryCache();
    const without = configuredEndpointSummaries({});
    expect(without.find((m) => m.id === "deepseek/deepseek-chat")?.available).toBe(false);
    const withKey = configuredEndpointSummaries({ deepseek: "sk-ds" });
    expect(withKey.find((m) => m.id === "deepseek/deepseek-chat")?.available).toBe(true);
  });

  it("yields to an operator declaration with the same id", () => {
    process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
      models: [
        {
          id: "deepseek/deepseek-chat",
          provider: "openai-compatible",
          location: "cloud",
          baseUrl: "https://proxy.firm.example/v1",
        },
      ],
    });
    resetModelRegistryCache();
    expect(getConfiguredModel("deepseek/deepseek-chat")?.baseUrl).toBe(
      "https://proxy.firm.example/v1",
    );
  });
});
