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
} from "../../../../lib/llm/__tests__/mockLanguageModel";
import type { AssistantEvent } from "@mike/contracts";
import { AssistantStreamAbortError, runLLMStream } from "../streaming";

const read = (id: string) => ({ id, name: "read_document", input: { doc_id: "doc-0" } });
const docStore = () =>
  new Map([["doc-0", { storage_path: "p", file_type: "txt", filename: "Lease.txt", inline_text: "Twelve months." }]]);

async function turn(steps: Parameters<typeof makeModel>[0], connectionCheck?: () => Promise<boolean>) {
  const model = await makeModel(steps);
  adapter.run = (params) => streamAiSdk(params as never, config(model));
  const outcome = await runLLMStream({
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "Review the lease." }],
    docStore: docStore(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
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
});
