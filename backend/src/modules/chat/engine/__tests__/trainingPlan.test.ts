import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The engine's one training parameter (lib/trainingTurn): a plan can only
// narrow the turn. Without one nothing changes.

const { streamChatWithTools } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({ fullText: "" })),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));

import { runLLMStream } from "../streaming";

type StreamChatCall = {
  tools: { function: { name: string } }[];
  systemPrompt?: string;
  [key: string]: unknown;
};

function params() {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "user", content: "Question" }],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    apiKeys: { gemini: "k" },
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
  };
}

const savedSubagents = process.env.LITT_CHAT_SUBAGENTS;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.LITT_CHAT_SUBAGENTS = "enabled";
});
afterEach(() => {
  if (savedSubagents === undefined) delete process.env.LITT_CHAT_SUBAGENTS;
  else process.env.LITT_CHAT_SUBAGENTS = savedSubagents;
});

const toolNames = () =>
  streamChatWithTools.mock.calls[0]![0].tools.map((tool) => tool.function.name);

describe("runLLMStream trainingPlan", () => {
  it("changes nothing without a plan or with an empty one", async () => {
    await runLLMStream(params() as never);
    const plain = toolNames();
    const plainPrompt = streamChatWithTools.mock.calls[0]![0].systemPrompt;
    streamChatWithTools.mockClear();
    await runLLMStream({ ...params(), trainingPlan: {} } as never);
    expect(toolNames()).toEqual(plain);
    expect(streamChatWithTools.mock.calls[0]![0].systemPrompt).toBe(plainPrompt);
    expect(plain).toEqual(expect.arrayContaining(["ask_inputs", "edit_document", "delegate"]));
  });

  it("adds its system text, and withholds writers, ask_inputs and subagents when asked", async () => {
    await runLLMStream({
      ...params(),
      trainingPlan: {
        systemAddendum: "ADDENDUM-TEXT",
        allowDocumentMutation: false,
        includeAskInputs: false,
        noSubagents: true,
      },
    } as never);
    const names = toolNames();
    expect(names).not.toContain("ask_inputs");
    expect(names).not.toContain("edit_document");
    expect(names).not.toContain("delegate");
    expect(streamChatWithTools.mock.calls[0]![0].systemPrompt).toContain("ADDENDUM-TEXT");
  });
});
