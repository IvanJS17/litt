import { beforeEach, describe, expect, it, vi } from "vitest";

// A round of tool calls in a turn a connected application started asks whether
// that connection is still good before anything of the round starts: web
// searches, subagents and client tools included. A turn the web started asks
// nothing.

const { streamChatWithTools, searchWeb } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({ fullText: "" })),
  searchWeb: vi.fn(),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));
vi.mock("../../../../lib/webSearch", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/webSearch")),
  searchWeb,
}));

process.env.LITT_CHAT_WEB_SEARCH = "enabled";
process.env.LITT_CHAT_SUBAGENTS = "enabled";

import { isAbortError, runLLMStream } from "../streaming";

type ToolResult = { tool_use_id: string; content: string };
type StreamChatCall = {
  systemPrompt: string;
  callbacks?: unknown;
  runTools?: (calls: { id: string; name: string; input: Record<string, unknown> }[]) => Promise<ToolResult[]>;
  [key: string]: unknown;
};

const isSubagent = (p: StreamChatCall) => p.systemPrompt.includes("SUBAGENT:");
const search = { id: "s", name: "web_search", input: { query: "the act" } };
const delegate = { id: "d", name: "delegate", input: { title: "Task", task: "Summarise doc-0." } };

function parentRuns(calls: (typeof search | typeof delegate)[]) {
  streamChatWithTools.mockImplementation(async (params) => {
    if (isSubagent(params)) return { fullText: "Sub answer" };
    await params.runTools?.(calls);
    return { fullText: "Answer" };
  });
}
const announce = (p: StreamChatCall) =>
  (p.callbacks as { onToolCallStart: (call: typeof delegate) => void }).onToolCallStart(delegate);
// The stream announces the delegation while the model is still writing, before
// the round of tool calls starts.
function parentAnnouncesThenRuns() {
  streamChatWithTools.mockImplementation(async (params) => {
    if (isSubagent(params)) return { fullText: "Sub answer" };
    announce(params);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await params.runTools?.([delegate]);
    return { fullText: "Answer" };
  });
}
const subagentStreams = () => streamChatWithTools.mock.calls.filter(([p]) => isSubagent(p)).length;

const turn = (connectionCheck?: () => Promise<boolean>) =>
  runLLMStream({
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "system", content: "Base prompt." }, { role: "user", content: "Review the lease." }],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
    webSearch: "tavily",
    apiKeys: {},
    webSearchAccount: { backend: "tavily", apiKey: "k" },
    ...(connectionCheck ? { connectionCheck } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  searchWeb.mockResolvedValue([{ url: "https://law.test/act", title: "The Act", snippet: "s" }]);
});

describe("a round of tool calls in a connected application's turn", () => {
  it.each([
    ["a web search", [search]],
    ["a delegation", [delegate]],
  ] as const)("starts nothing of %s when the connection is no longer good", async (_, calls) => {
    parentRuns([...calls]);
    const check = vi.fn(async () => false);
    await expect(turn(check)).rejects.toSatisfy(isAbortError);
    expect(check).toHaveBeenCalledTimes(1);
    expect(searchWeb).not.toHaveBeenCalled();
    expect(subagentStreams()).toBe(0);
  });

  it("starts nothing when the question cannot be answered", async () => {
    parentRuns([search, delegate]);
    await expect(turn(async () => { throw new Error("private detail"); })).rejects.toSatisfy(isAbortError);
    expect(searchWeb).not.toHaveBeenCalled();
    expect(subagentStreams()).toBe(0);
  });

  it("runs the search and the subagent as before while the connection is good", async () => {
    parentRuns([search, delegate]);
    const check = vi.fn(async () => true);
    await turn(check);
    expect(check).toHaveBeenCalled();
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(subagentStreams()).toBe(1);
  });

  it("asks nothing in a turn the web started", async () => {
    parentRuns([search, delegate]);
    await turn();
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(subagentStreams()).toBe(1);
  });

  it("starts no subagent for an announced delegation when the connection is no longer good", async () => {
    parentAnnouncesThenRuns();
    await expect(turn(async () => false)).rejects.toSatisfy(isAbortError);
    expect(subagentStreams()).toBe(0);
  });

  it("runs an announced delegation once, in the round, while the connection is good", async () => {
    let early = -1;
    streamChatWithTools.mockImplementation(async (params) => {
      if (isSubagent(params)) return { fullText: "Sub answer" };
      announce(params);
      await new Promise((resolve) => setTimeout(resolve, 20));
      early = subagentStreams();
      await params.runTools?.([delegate]);
      return { fullText: "Answer" };
    });
    await turn(async () => true);
    expect(early).toBe(0);
    expect(subagentStreams()).toBe(1);
  });

  it("starts an announced delegation at once in a turn the web started", async () => {
    let early = -1;
    streamChatWithTools.mockImplementation(async (params) => {
      if (isSubagent(params)) return { fullText: "Sub answer" };
      announce(params);
      await new Promise((resolve) => setTimeout(resolve, 20));
      early = subagentStreams();
      await params.runTools?.([delegate]);
      return { fullText: "Answer" };
    });
    await turn();
    expect(early).toBe(1);
    expect(subagentStreams()).toBe(1);
  });
});
