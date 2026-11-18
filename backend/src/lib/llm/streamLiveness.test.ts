import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAiSdk } from "./aiSdk";
import { config, finish, text } from "./__tests__/mockLanguageModel";
import {
  runWithLivenessListener,
  sseCommentDetector,
  withSseKeepAlive,
} from "./streamLiveness";

const enc = new TextEncoder();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("sseCommentDetector", () => {
  it("detects a comment line and ignores data lines", () => {
    const detect = sseCommentDetector();
    expect(detect(enc.encode(": OPENROUTER PROCESSING\n\n"))).toBe(true);
    expect(detect(enc.encode('data: {"a":": not a comment"}\n\n'))).toBe(false);
  });

  it("detects a comment whose first byte starts a later chunk", () => {
    const detect = sseCommentDetector();
    expect(detect(enc.encode("data: {}\n"))).toBe(false);
    expect(detect(enc.encode("\n"))).toBe(false);
    expect(detect(enc.encode(": OPENROUTER"))).toBe(true);
    expect(detect(enc.encode(" PROCESSING\n\n"))).toBe(false);
  });

  it("does not take a colon in the middle of a split data line for a comment", () => {
    const detect = sseCommentDetector();
    expect(detect(enc.encode("data"))).toBe(false);
    expect(detect(enc.encode(": x\n\n"))).toBe(false);
  });

  it("handles CRLF line endings and byte-at-a-time delivery", () => {
    const detect = sseCommentDetector();
    const hits = [...enc.encode("data: 1\r\n\r\n: ping\r\n\r\n")].map((b) =>
      detect(new Uint8Array([b])),
    );
    expect(hits.filter(Boolean)).toHaveLength(1);
  });
});

describe("sseCommentDetector with Anthropic pings", () => {
  const PING = 'event: ping\ndata: {"type": "ping"}\n\n';

  it("recognizes an event: ping frame", () => {
    expect(sseCommentDetector()(enc.encode(PING))).toBe(true);
  });

  it("recognizes it split anywhere, byte at a time, with CRLF", () => {
    const stream = 'event: message_start\r\ndata: {}\r\n\r\n' + PING.replace(/\n/g, "\r\n");
    const detect = sseCommentDetector();
    const hits = [...enc.encode(stream)].map((b) => detect(new Uint8Array([b])));
    expect(hits.filter(Boolean)).toHaveLength(1);
    for (let cut = 1; cut < PING.length; cut++) {
      const d = sseCommentDetector();
      const bytes = enc.encode(PING);
      const found = [d(bytes.slice(0, cut)), d(bytes.slice(cut))];
      expect(found.filter(Boolean), `cut ${cut}`).toHaveLength(1);
    }
  });

  it("does not trigger on data lines that mention ping or on other events", () => {
    const detect = sseCommentDetector();
    expect(detect(enc.encode('data: {"type": "ping"}\n\n'))).toBe(false);
    expect(detect(enc.encode('data: event: ping\n\n'))).toBe(false);
    expect(detect(enc.encode(' event: ping\n'))).toBe(false);
    expect(detect(enc.encode("event: pinging\n"))).toBe(false);
    expect(detect(enc.encode("event: pin\n"))).toBe(false);
    expect(detect(enc.encode('event: content_block_delta\ndata: {"text":"event: ping"}\n\n'))).toBe(false);
  });
});

describe("runWithLivenessListener", () => {
  it("keeps two concurrent scopes from notifying each other", async () => {
    const sse = () =>
      new Response(": hi\n\n", { headers: { "content-type": "text/event-stream" } });
    const wrapped = withSseKeepAlive(async () => sse());
    const a = vi.fn();
    const b = vi.fn();
    let release!: () => void;
    const gate = { promise: new Promise<void>((resolve) => (release = resolve)), resolve: () => release() };
    const scopeA = runWithLivenessListener(a, async () => {
      await gate.promise;
      await (await wrapped("https://example.test")).text();
    });
    const scopeB = runWithLivenessListener(b, async () => {
      await (await wrapped("https://example.test")).text();
      gate.resolve();
    });
    await Promise.all([scopeA, scopeB]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("withSseKeepAlive", () => {
  it("passes bytes through unchanged", async () => {
    const payload = ': OPENROUTER PROCESSING\n\ndata: {"x":1}\n\n: again\n\ndata: [DONE]\n\n';
    const wrapped = withSseKeepAlive(
      async () =>
        new Response(payload, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const response = await wrapped("https://example.test");
    expect(await response.text()).toBe(payload);
  });

  it("leaves non-SSE responses untouched", async () => {
    const original = new Response("{}", {
      headers: { "content-type": "application/json" },
    });
    const wrapped = withSseKeepAlive(async () => original);
    expect(await wrapped("https://example.test")).toBe(original);
  });
});

describe("provider watchdog and SSE keep-alives", () => {
  async function run(
    keepAliveEveryMs: number | null,
    midStream = false,
    frame = ": OPENROUTER PROCESSING\n\n",
  ) {
    const { MockLanguageModelV3 } = await import("ai/test");
    vi.useFakeTimers();
    vi.stubEnv("STREAM_CHUNK_TIMEOUT_MS", "5000");
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", "10000");
    const fetchBody = new ReadableStream<Uint8Array>({
      start(controller) {
        if (keepAliveEveryMs === null) return;
        const interval = setInterval(
          () => controller.enqueue(enc.encode(frame)),
          keepAliveEveryMs,
        );
        setTimeout(() => {
          clearInterval(interval);
          controller.close();
        }, 30_000);
      },
    });
    const fetcher = withSseKeepAlive(
      async () =>
        new Response(fetchBody, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const response = await fetcher("https://example.test");
        const reader = response.body!.getReader();
        // Mimic the AI SDK: SSE comments are consumed, nothing is emitted.
        return {
          stream: new ReadableStream({
            start(sink) {
              if (midStream) sink.enqueue({ type: "text-start", id: "t" });
              if (midStream)
                sink.enqueue({ type: "text-delta", id: "t", delta: "a" });
            },
            async pull(sink) {
              let next = await reader.read();
              while (!next.done) next = await reader.read();
              if (!midStream) for (const part of text("ok")) sink.enqueue(part);
              else sink.enqueue({ type: "text-end", id: "t" });
              sink.enqueue(finish("stop"));
              sink.close();
            },
          }),
        };
      },
    });
    const pending = streamAiSdk(
      {
        model: "m",
        systemPrompt: "S",
        messages: [{ role: "user", content: "go" }],
      },
      config(model),
    );
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(31_000);
    return settled;
  }

  it("keep-alives before the first token keep the call alive past the timeout", async () => {
    const outcome = await run(3000);
    expect(outcome).not.toHaveProperty("error");
  });

  it("Anthropic pings keep the call alive before and after output", async () => {
    const ping = 'event: ping\ndata: {"type": "ping"}\n\n';
    expect(await run(3000, false, ping)).not.toHaveProperty("error");
    expect(await run(3000, true, ping)).not.toHaveProperty("error");
  });

  it("data frames that only mention ping do not keep it alive", async () => {
    const outcome = await run(3000, true, 'data: {"type": "ping"}\n\n');
    expect(String((outcome as { error: unknown }).error)).toMatch(/stopped responding/);
  });

  it("keep-alives after output keep the chunk clock alive", async () => {
    const outcome = await run(3000, true);
    expect(outcome).not.toHaveProperty("error");
  });

  it("a silent connection after output aborts at the chunk timeout", async () => {
    const outcome = await run(null, true);
    expect(String((outcome as { error: unknown }).error)).toMatch(
      /stopped responding/,
    );
  });

  it("a silent connection still aborts at the first-chunk timeout", async () => {
    const outcome = await run(null);
    expect("error" in outcome).toBe(true);
    expect(String((outcome as { error: unknown }).error)).toMatch(
      /stopped responding/,
    );
  });
});
