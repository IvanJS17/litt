import { afterEach, describe, expect, it, vi } from "vitest";
import { completeWithProvider } from "./providers";

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode Go requests", () => {
  it("call Chat Completions with the conversation as session and LiTT's User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "chatcmpl_1",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "qwen3.8-max",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeWithProvider({
      model: "opencode-go/qwen3.8-max",
      user: "hi",
      apiKeys: { "opencode-go": "oc-key" },
      conversationId: "chat-123",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toMatch(/\/chat\/completions$/);
    expect(headers.get("x-opencode-session")).toBe("chat-123");
    expect(headers.get("user-agent")).toMatch(/^litt\//);
  });
});
