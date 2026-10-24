import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// LiTT gate (ledger 16.3, "Web search and subagents in chat"): with the
// deployment defaults no web-search tool, no provider search and no subagent
// is offered, even when the user's settings plan a search and the route
// hands a subagent store in. With the operator switch on, a subagent may
// name only the conversation's own model.

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
  tools: { function: { name: string; parameters?: { properties?: Record<string, { description?: string }> } } }[];
  providerWebSearch?: unknown;
  [key: string]: unknown;
};

function params() {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "user", content: "What changed in the act?" }],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    webSearch: "provider" as const,
    apiKeys: { gemini: "k", brave: "b" },
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
  };
}

const saved = {
  web: process.env.LITT_CHAT_WEB_SEARCH,
  sub: process.env.LITT_CHAT_SUBAGENTS,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LITT_CHAT_WEB_SEARCH;
  delete process.env.LITT_CHAT_SUBAGENTS;
});
afterEach(() => {
  if (saved.web === undefined) delete process.env.LITT_CHAT_WEB_SEARCH;
  else process.env.LITT_CHAT_WEB_SEARCH = saved.web;
  if (saved.sub === undefined) delete process.env.LITT_CHAT_SUBAGENTS;
  else process.env.LITT_CHAT_SUBAGENTS = saved.sub;
});

describe("chat capabilities that need an owner decision", () => {
  it("offers no web search and no subagent with the defaults", async () => {
    await runLLMStream(params() as never);
    const call = streamChatWithTools.mock.calls[0]![0];
    const names = call.tools.map((tool) => tool.function.name);
    expect(names).not.toContain("delegate");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("read_webpage");
    expect(call.providerWebSearch ?? null).toBeNull();
  });

  it("with subagents switched on, a subagent can name only the chat's model", async () => {
    process.env.LITT_CHAT_SUBAGENTS = "enabled";
    await runLLMStream(params() as never);
    const call = streamChatWithTools.mock.calls[0]![0];
    const delegate = call.tools.find((tool) => tool.function.name === "delegate");
    expect(delegate).toBeDefined();
    const modelHelp = delegate!.function.parameters?.properties?.model?.description ?? "";
    expect(modelHelp).toContain("gemini-3.8-flash");
    expect(modelHelp).not.toMatch(/such as/);
  });
});
