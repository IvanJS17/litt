// The key reference a turn runs on travels from the turn to the tools that
// start work of their own (run_playbook): the conversation's own key for the
// turn, and the key of the route a subagent runs on for that subagent.
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

// A subagent's turn is given the reference of the route it runs on.
const delegateCall = (input: Record<string, unknown> = {}) => ({
  id: "d1",
  name: "delegate",
  input: { title: "Review", task: "Review the lease.", ...input },
});

async function subagentTurn(subagentRoutes?: unknown, delegateInput: Record<string, unknown> = {}) {
  process.env.LITT_CHAT_SUBAGENTS = "enabled";
  streamChatWithTools.mockImplementation(async (params: StreamParams & { systemPrompt?: string }) => {
    if (params.systemPrompt?.includes("SUBAGENT:")) {
      await params.runTools?.([{ id: "t2", name: "run_playbook", input: { playbook_id: "p", doc_id: "doc-0" } }]);
      return { fullText: "Brief." };
    }
    await params.runTools?.([delegateCall(delegateInput)]);
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
    credentialRef: "org:o1:gemini:v3",
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
    ...(subagentRoutes ? { subagentRoutes: subagentRoutes as never } : {}),
  });
  const playbookCalls = runToolCalls.mock.calls.filter(([calls]) =>
    (calls as { function?: { name?: string } }[]).some((c) => c.function?.name === "run_playbook"),
  );
  // The first run_playbook batch is the subagent's (the parent only delegated).
  return playbookCalls.map((call) => call[12] as Record<string, unknown>);
}

const ROUTES = {
  routes: [{ name: "deep", description: "Deep work.", model: "claude-opus-5-5" }],
  default: null,
};

it("gives a subagent on the conversation's model the conversation's key reference", async () => {
  const [options] = await subagentTurn();
  expect(options!.credentialRef).toBe("org:o1:gemini:v3");
});

it("gives a subagent on a named route that route's key reference, not the conversation's", async () => {
  const govern = vi.fn(async () => ({
    ok: true as const,
    model: "claude-opus-5-5",
    provider: "claude",
    apiKeys: {},
    credentialRef: "user:u1:claude:v2",
  }));
  const [options] = await subagentTurn({ routes: ROUTES, govern }, { route: "deep" });
  expect(options!.credentialRef).toBe("user:u1:claude:v2");
});

it("gives a subagent on a named route that has no key reference none, not the conversation's", async () => {
  const govern = vi.fn(async () => ({
    ok: true as const,
    model: "claude-opus-5-5",
    provider: "claude",
    apiKeys: {},
  }));
  const [options] = await subagentTurn({ routes: ROUTES, govern }, { route: "deep" });
  expect(options!.credentialRef ?? null).toBeNull();
});
