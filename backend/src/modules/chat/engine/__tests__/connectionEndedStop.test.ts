import { beforeEach, describe, expect, it, vi } from "vitest";

// The end of the connection that started a turn must stop the turn the way a
// person's stop does, THROUGH the real model adapter: no further call runs, and
// the stream ends with the error stopped turns are stored from, carrying what
// was written so far. The adapter is the real streamAiSdk over a scripted model.

const adapter = vi.hoisted(() => ({
  run: undefined as undefined | ((params: unknown) => Promise<unknown>),
}));
vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: unknown) => adapter.run!(params),
}));
vi.mock("../../../../lib/integrations/googleWorkspace", async (load) => ({
  ...(await load<object>()),
  buildGoogleWorkspaceTools: async () => [],
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));

process.env.LITT_CHAT_SUBAGENTS = "enabled";

import { streamAiSdk } from "../../../../lib/llm/aiSdk";
import {
  callStep,
  config,
  makeModel,
  step,
  text,
  textStep,
  toolCall,
  finish,
  tick,
} from "../../../../lib/llm/__tests__/mockLanguageModel";
import type { AssistantEvent } from "@mike/contracts";
import { AssistantStreamAbortError, AssistantStreamError, runLLMStream } from "../streaming";
import { isConnectionEnded } from "../tools/connectionEnded";

const read = (id: string) => ({ id, name: "read_document", input: { doc_id: "doc-0" } });
const docStore = () =>
  new Map([["doc-0", { storage_path: "p", file_type: "txt", filename: "Lease.txt", inline_text: "Twelve months." }]]);

async function turn(
  steps: Parameters<typeof makeModel>[0],
  connectionCheck?: () => Promise<boolean>,
  write: (chunk: string) => void = vi.fn(),
) {
  const model = await makeModel(steps);
  adapter.run = (params) => streamAiSdk(params as never, config(model));
  const outcome = await runLLMStream({
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "Review the lease." }],
    docStore: docStore(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write,
    nonce: "turnnonce",
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
    apiKeys: {},
    ...(connectionCheck ? { connectionCheck } : {}),
  }).then(
    (result) => ({ result, error: null as unknown }),
    (error: unknown) => ({ result: null, error }),
  );
  return { model, ...outcome };
}
const docReads = (events: AssistantEvent[]) => events.filter((e) => e.type === "doc_read").length;
const writing = (t: string, ...calls: ReturnType<typeof toolCall>[]) =>
  step(...text(t), ...calls, finish("tool-calls"));

beforeEach(() => vi.clearAllMocks());

describe("a turn whose connection ended, through the real model adapter", () => {
  it("ends as a stopped turn with what was written, before the first call runs", async () => {
    const { model, error } = await turn([writing("Reading the lease. ", toolCall("c1", "read_document", read("c1").input))], async () => false);
    expect(error).toBeInstanceOf(AssistantStreamAbortError);
    const stopped = error as AssistantStreamAbortError;
    expect(stopped.fullText).toBe("Reading the lease. ");
    expect(docReads(stopped.events)).toBe(0);
    expect(model.doStreamCalls.length).toBe(1);
  });

  it("ends as a stopped turn between two calls: the one before ran, the one after did not", async () => {
    let asked = 0;
    const { model, error } = await turn(
      [writing("Reading. ", toolCall("c1", "read_document", read("c1").input), toolCall("c2", "read_document", read("c2").input))],
      async () => ++asked < 3, // the round start and the first call are answered "good"
    );
    expect(error).toBeInstanceOf(AssistantStreamAbortError);
    const stopped = error as AssistantStreamAbortError;
    expect(stopped.fullText).toBe("Reading. ");
    expect(docReads(stopped.events)).toBe(1);
    expect(model.doStreamCalls.length).toBe(1);
  });

  it("ends as a stopped turn when the question cannot be answered", async () => {
    const { error } = await turn([callStep("c1", "read_document", read("c1").input)], async () => {
      throw new Error("private detail");
    });
    expect(error).toBeInstanceOf(AssistantStreamAbortError);
    expect(String((error as Error).message)).not.toContain("private detail");
  });

  it("completes as before while the connection is good", async () => {
    const { result, error } = await turn(
      [callStep("c1", "read_document", read("c1").input), textStep("Twelve months.")],
      async () => true,
    );
    expect(error).toBeNull();
    expect(result!.fullText).toContain("Twelve months.");
  });

  const delegate = toolCall("d1", "delegate", { title: "Task", task: "Summarise doc-0." });

  it("ends the parent turn as stopped when the connection ends in a subagent's round start", async () => {
    let asked = 0;
    const { model, error } = await turn(
      [writing("Delegating. ", delegate), callStep("s1", "read_document", read("s1").input), textStep("never")],
      async () => ++asked < 2, // the parent's round is good; the subagent's is not
    );
    expect(error).toBeInstanceOf(AssistantStreamAbortError);
    const stopped = error as AssistantStreamAbortError;
    expect(stopped.fullText).toBe("Delegating. ");
    expect(docReads(stopped.events)).toBe(0);
    expect(model.doStreamCalls.length).toBe(2); // the parent's step and the subagent's: no later step
  });

  it("checks a subagent's own server tool call, and ends the parent turn as stopped", async () => {
    let asked = 0;
    const check = vi.fn(async () => ++asked < 3); // parent round, subagent round: good; subagent's call: ended
    const { model, error } = await turn(
      [writing("Delegating. ", delegate), callStep("s1", "read_document", read("s1").input), textStep("never")],
      check,
    );
    expect(check).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(AssistantStreamAbortError);
    expect(model.doStreamCalls.length).toBe(2);
    expect(docReads((error as AssistantStreamAbortError).events)).toBe(0);
  });

  describe("with subagents running side by side", () => {
    const two = (...rest: Parameters<typeof makeModel>[0]) => [
      writing(
        "Two. ",
        toolCall("d1", "delegate", { title: "A", task: "Read doc-0." }),
        toolCall("d2", "delegate", { title: "B", task: "Read doc-0." }),
      ),
      callStep("s1", "read_document", read("s1").input),
      callStep("s2", "read_document", read("s2").input),
      ...rest,
    ];
    const delegationsIn = (events: AssistantEvent[]) =>
      events.filter((e) => e.type === "delegation") as Extract<AssistantEvent, { type: "delegation" }>[];

    async function sideBySide(steps: Parameters<typeof makeModel>[0], check: () => Promise<boolean>) {
      const frames: string[] = [];
      let settled = false;
      const run = await turn(steps, check, (chunk) => {
        frames.push(settled ? `AFTER SETTLE ${chunk}` : chunk);
      });
      settled = true;
      const callsAtSettle = run.model.doStreamCalls.length;
      await tick();
      await tick();
      await tick();
      return { ...run, frames, callsAtSettle };
    }

    function expectStoppedWithEveryDelegationCancelled(r: Awaited<ReturnType<typeof sideBySide>>) {
      expect(r.error).toBeInstanceOf(AssistantStreamAbortError);
      const stopped = r.error as AssistantStreamAbortError;
      expect(isConnectionEnded(stopped)).toBe(true);
      expect(stopped.fullText).toBe("Two. ");
      expect(stopped.events.some((e) => e.type === "error")).toBe(false);
      expect(delegationsIn(stopped.events).map((e) => e.status)).toEqual(["cancelled", "cancelled"]);
      // No subagent runs a model call or writes to the sink once the turn has settled.
      expect(r.model.doStreamCalls.length).toBe(r.callsAtSettle);
      expect(r.frames.filter((f) => f.startsWith("AFTER SETTLE"))).toEqual([]);
      // The live client got a terminal frame for each of them.
      const terminal = r.frames.filter((f) => f.includes('"type":"delegation"') && f.includes('"status":"cancelled"'));
      expect(terminal.length).toBe(2);
    }

    it("stops and records the other subagent when one meets the end and the check then answers good", async () => {
      let asked = 0;
      const r = await sideBySide(
        two(textStep("sibling brief"), textStep("later"), textStep("later still")),
        async () => ++asked !== 2, // parent round good; the first subagent's round ended; all later good
      );
      expectStoppedWithEveryDelegationCancelled(r);
    });

    it("stops and records the other subagent when the check keeps answering ended", async () => {
      let asked = 0;
      const r = await sideBySide(two(textStep("sibling brief"), textStep("later")), async () => ++asked < 2);
      expectStoppedWithEveryDelegationCancelled(r);
    });

    it("stops and records every subagent when the parent's own tool call meets the end beside them", async () => {
      let asked = 0;
      const r = await sideBySide(
        [
          writing(
            "Two. ",
            toolCall("d1", "delegate", { title: "A", task: "Read doc-0." }),
            toolCall("d2", "delegate", { title: "B", task: "Read doc-0." }),
            toolCall("p1", "read_document", read("p1").input),
          ),
          callStep("s1", "read_document", read("s1").input),
          callStep("s2", "read_document", read("s2").input),
          textStep("brief one"),
          textStep("brief two"),
          textStep("later"),
        ],
        async () => ++asked !== 2,
      );
      expectStoppedWithEveryDelegationCancelled(r);
    });

    it("records a single subagent that meets the end as cancelled, with its terminal frame", async () => {
      const frames: string[] = [];
      let asked = 0;
      const { error, model } = await turn(
        [writing("Delegating. ", delegate), callStep("s1", "read_document", read("s1").input), textStep("never")],
        async () => ++asked < 2,
        (chunk) => frames.push(chunk),
      );
      const stopped = error as AssistantStreamAbortError;
      expect(stopped).toBeInstanceOf(AssistantStreamAbortError);
      expect(isConnectionEnded(stopped)).toBe(true);
      expect(delegationsIn(stopped.events).map((e) => e.status)).toEqual(["cancelled"]);
      expect(frames.filter((f) => f.includes('"status":"cancelled"')).length).toBe(1);
      expect(model.doStreamCalls.length).toBe(2);
    });
  });
});

// A turn waits for every subagent run, however it ended. When one run fails
// outside its own handling (here: saving its run row rejects after it
// completed) while another is still inside a model call, the turn must not
// settle before that other run has finished and been recorded.
describe("a turn whose subagent run fails while another subagent is inside a model call", () => {
  const SLOW_MODEL_CALL_MS = 300; // the slow subagent's scripted model call
  const WAIT_AFTER_SETTLE_MS = 1000; // longer than SLOW_MODEL_CALL_MS: anything still running would show

  type Scripted = { parts: ReturnType<typeof text>; delay: number };
  const scripted = (t: string, delay = 0): Scripted => ({ parts: [...text(t), finish("stop")], delay });

  async function routedModel(scripts: Record<string, Scripted[]>) {
    const { MockLanguageModelV3 } = await import("ai/test");
    return new MockLanguageModelV3({
      doStream: async (options: { prompt: unknown; abortSignal?: AbortSignal }) => {
        const prompt = JSON.stringify(options.prompt);
        const who = ["TASKFAST", "TASKSLOW"].find((k) => prompt.includes(k)) ?? "parent";
        const next = scripts[who].shift();
        if (!next) throw new Error(`no scripted step for ${who}`);
        return {
          stream: new ReadableStream({
            async start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "response-metadata", id: "r", modelId: "mock" });
              if (next.delay) await new Promise((r) => setTimeout(r, next.delay));
              for (const part of next.parts) controller.enqueue(part);
              controller.close();
            },
          }),
        };
      },
    } as never);
  }

  it("waits for the slow subagent, stores its terminal event and writes nothing after the turn settled", async () => {
    const model = await routedModel({
      parent: [
        {
          parts: [
            ...text("Two. "),
            toolCall("d1", "delegate", { title: "Fast", task: "TASKFAST Read doc-0." }),
            toolCall("d2", "delegate", { title: "Slow", task: "TASKSLOW Read doc-0." }),
            finish("tool-calls"),
          ],
          delay: 0,
        },
      ],
      TASKFAST: [scripted("fast brief")],
      TASKSLOW: [scripted("slow brief", SLOW_MODEL_CALL_MS)],
    });
    adapter.run = (params) => streamAiSdk(params as never, config(model as never));
    const frames: string[] = [];
    let settled = false;
    const saveFailure = new Error("run row could not be saved");
    const save = vi.fn(async (_id: string, status: string) => {
      // The first run row to be saved (the fast subagent's, completed) fails to save.
      if (status === "completed" && save.mock.calls.length === 1) throw saveFailure;
    });
    const outcome = await runLLMStream({
      model: "gemini-3.8-flash",
      apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "Go." }],
      docStore: docStore(),
      docIndex: {},
      userId: "u1",
      db: {} as never,
      write: (chunk: string) => frames.push(settled ? `AFTER SETTLE ${chunk}` : chunk),
      nonce: "turnnonce",
      subagentRuns: { save, load: vi.fn(async () => null) },
      apiKeys: {},
    } as never).then(
      () => ({ error: null as unknown }),
      (error: unknown) => ({ error }),
    );
    settled = true;
    const callsAtSettle = model.doStreamCalls.length;
    await new Promise((r) => setTimeout(r, WAIT_AFTER_SETTLE_MS));

    expect(outcome.error).toBeInstanceOf(AssistantStreamError);
    expect(((outcome.error as AssistantStreamError).cause as Error).cause).toBe(saveFailure);
    const stored = ((outcome.error as AssistantStreamError).events).filter((e) => e.type === "delegation");
    expect(stored.map((e) => (e as { title: string }).title)).toContain("Slow");
    expect(frames.filter((f) => f.includes('"title":"Slow"') && f.includes('"type":"delegation"') && !f.includes("delegation_start")).length).toBe(1);
    expect(model.doStreamCalls.length).toBe(callsAtSettle);
    expect(frames.filter((f) => f.startsWith("AFTER SETTLE"))).toEqual([]);
  });
});
