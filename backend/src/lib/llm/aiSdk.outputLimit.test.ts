/**
 * A model call's output is bounded by the same ceiling a run's frames are,
 * whether or not the engine turns it into frames: answer text, reasoning and
 * streamed tool arguments all count, and the provider request is cut off.
 */
import { afterEach, describe, expect, it } from "vitest";

import { streamAiSdk } from "./aiSdk";
import { resetStreamRunsForTests, setRunByteLimitForTests } from "../streamRuns";
import { UserFacingError } from "../userFacingError";
import { config, finish, TOOLS, type Part } from "./__tests__/mockLanguageModel";

afterEach(() => resetStreamRunsForTests());

/** A provider that keeps sending `parts(i)` until the consumer stops reading. */
async function endlessModel(open: Part[], delta: Part, total = 5_000) {
  const { MockLanguageModelV3 } = await import("ai/test");
  const sent = { parts: 0, cancelled: false };
  const model = new MockLanguageModelV3({
    doStream: async () => {
      let i = 0;
      return {
        stream: new ReadableStream<Part>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const part of open) controller.enqueue(part);
          },
          pull(controller) {
            if (i++ >= total) {
              controller.enqueue(finish("stop"));
              return controller.close();
            }
            controller.enqueue(delta);
            sent.parts += 1;
          },
          cancel() {
            sent.cancelled = true;
          },
        }),
      };
    },
  });
  return { model, sent };
}

const base = {
  model: "m",
  systemPrompt: "S",
  messages: [{ role: "user" as const, content: "go" }],
  tools: TOOLS,
  maxIterations: 2,
};

const kib = "x".repeat(1024);
const shapes: Array<[string, Part[], Part]> = [
  ["answer text", [{ type: "text-start", id: "t0" }], { type: "text-delta", id: "t0", delta: kib }],
  ["reasoning", [{ type: "reasoning-start", id: "r0" }], { type: "reasoning-delta", id: "r0", delta: kib }],
  [
    "streamed tool arguments",
    [{ type: "tool-input-start", id: "c1", toolName: "read_document" }],
    { type: "tool-input-delta", id: "c1", delta: kib },
  ],
];

describe("model output ceiling", () => {
  it.each(shapes)("ends the call with the output-limit message and cuts the provider off: %s", async (_name, open, delta) => {
    setRunByteLimitForTests(64 * 1024);
    const { model, sent } = await endlessModel(open, delta);
    const seen: string[] = [];
    const failure = await streamAiSdk(
      { ...base, callbacks: { onContentDelta: (t) => seen.push(t) } },
      config(model),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(UserFacingError);
    expect((failure as Error).message).toMatch(/larger than the maximum allowed size/);
    // The provider is not read on for the rest of its output.
    expect(sent.parts).toBeLessThan(200);
    expect(sent.cancelled).toBe(true);
  });

  it("lets an answer under the ceiling through", async () => {
    setRunByteLimitForTests(64 * 1024);
    const [, open, delta] = shapes[0];
    const { model } = await endlessModel(open, delta, 32);
    const result = await streamAiSdk({ ...base }, config(model));
    expect(result.fullText).toBe(kib.repeat(32));
  });
});
