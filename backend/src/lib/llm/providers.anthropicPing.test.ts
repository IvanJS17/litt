import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamAiSdk } = vi.hoisted(() => ({ streamAiSdk: vi.fn() }));

vi.mock("./aiSdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aiSdk")>()),
  streamAiSdk,
}));

import type { AiSdkAdapterConfig } from "./aiSdk";
import { streamWithProvider } from "./providers";
import { runWithLivenessListener } from "./streamLiveness";

const enc = new TextEncoder();

beforeEach(() => {
  streamAiSdk.mockReset();
  streamAiSdk.mockResolvedValue({ fullText: "ok" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAnthropicStream() {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        enc.encode(
          'event: ping\ndata: {"type": "ping"}\n\n' +
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function pingsSeen(model: AiSdkAdapterConfig["model"]) {
  const listener = vi.fn();
  await runWithLivenessListener(listener, async () => {
    const result = await (model as unknown as { doStream: (o: unknown) => Promise<{ stream: ReadableStream }> }).doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const reader = result.stream.getReader();
    while (!(await reader.read()).done);
  });
  return listener.mock.calls.length;
}

describe("Anthropic ping events as stream liveness", () => {
  it("reports an event: ping frame from the direct Anthropic route", async () => {
    stubAnthropicStream();
    await streamWithProvider({
      model: "claude-opus-5-5",
      systemPrompt: "S",
      messages: [{ role: "user", content: "hi" }],
      apiKeys: { claude: "user-key" },
    });
    const adapter = streamAiSdk.mock.calls[0]![1] as AiSdkAdapterConfig;
    expect(await pingsSeen(adapter.model)).toBeGreaterThanOrEqual(1);
  });
});
