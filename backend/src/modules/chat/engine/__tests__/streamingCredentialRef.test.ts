// The key the conversation is pinned to travels from the turn to the tools
// that start work of their own (run_playbook); a subagent is not given it.
import { beforeEach, expect, it, vi } from "vitest";

type Call = { id: string; name: string; input: Record<string, unknown> };
type StreamParams = {
  runTools?: (calls: Call[]) => Promise<unknown[]>;
};

const { streamChatWithTools, runToolCalls } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamParams) => ({ fullText: "" })),
  runToolCalls: vi.fn(async (calls: { id: string }[], ..._rest: unknown[]) => ({
    toolResults: calls.map((c) => ({ tool_call_id: c.id, content: "ok" })),
    docsRead: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    workflowsApplied: [],
    docsEdited: [],
    askInputsEvents: [],
    mcpEvents: [],
  })),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamParams) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));
vi.mock("../tools/toolDispatcher", () => ({ runToolCalls }));

import { runLLMStream } from "../streaming";

beforeEach(() => vi.clearAllMocks());

async function turn(credentialRef?: string | null) {
  streamChatWithTools.mockImplementation(async (params) => {
    await params.runTools?.([{ id: "t1", name: "run_playbook", input: { playbook_id: "p", doc_id: "doc-0" } }]);
    return { fullText: "Answer" };
  });
  await runLLMStream({
    apiMessages: [{ role: "user", content: "Review it." }],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    model: "gemini-3.8-flash",
    ...(credentialRef === undefined ? {} : { credentialRef }),
  });
  return runToolCalls.mock.calls[0]![12] as Record<string, unknown>;
}

it("hands the conversation's key reference to the tool dispatcher", async () => {
  expect(await turn("org:o1:claude:v3")).toMatchObject({ credentialRef: "org:o1:claude:v3" });
});

it("hands none when the turn has none", async () => {
  expect((await turn()).credentialRef).toBeUndefined();
});
