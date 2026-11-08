import { beforeEach, describe, expect, it, vi } from "vitest";

type DispatchedCall = { id: string; function: { name: string } };

function toolBatch(calls: DispatchedCall[], askInputsEvents: unknown[] = []) {
  return {
    toolResults: calls.map((c) => ({ tool_call_id: c.id, content: `${c.function.name} result` })),
    docsRead: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    workflowsApplied: [],
    docsEdited: [],
    askInputsEvents,
    mcpEvents: [],
  };
}

const { streamChatWithTools, runToolCalls, buildUserMcpTools } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({
    fullText: "",
  })),
  runToolCalls: vi.fn(async (calls: DispatchedCall[], ..._rest: unknown[]) => toolBatch(calls)),
  buildUserMcpTools: vi.fn(async () => [
    { type: "function", function: { name: "mcp_mail_send", parameters: {} } },
  ]),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
}));

vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools }));

vi.mock("../tools/toolDispatcher", () => ({ runToolCalls }));

import type { DelegationEvent } from "@mike/contracts";
import type { CriteriaRun } from "../../../../lib/trainingTurn/types";
// These suites exercise the mechanism as an operator who switched it on
// (lib/chatFeatureGates.ts); the shipped default is chatFeatureGates.test.ts.
process.env.LITT_CHAT_SUBAGENTS = "enabled";

import { runLLMStream } from "../streaming";

type ToolResult = { tool_use_id: string; content: string };
type StreamChatCall = {
  model: string;
  reasoning?: string;
  systemPrompt: string;
  messages: { role: string; content: string }[];
  tools: { function: { name: string; parameters?: unknown } }[];
  abortSignal?: AbortSignal;
  callbacks?: {
    onToolCallStart?: (call: ReturnType<typeof delegate> & { invalid?: true }) => void;
    onContentDelta?: (text: string) => void;
    onUsage?: (
      usage: { inputTokens: number; outputTokens: number },
      finishReason: string,
    ) => void;
  };
  runTools?: (
    calls: { id: string; name: string; input: Record<string, unknown> }[],
  ) => Promise<ToolResult[]>;
};

const isSubagent = (params: StreamChatCall) =>
  params.systemPrompt.includes("SUBAGENT:");

const delegate = (id: string, input: Record<string, unknown> = {}) => ({
  id,
  name: "delegate",
  input: { title: `Task ${id}`, task: "Summarise doc-0.", ...input },
});

function parentDelegates(
  calls: ReturnType<typeof delegate>[],
  subagent: (params: StreamChatCall) => Promise<{ fullText: string }>,
) {
  const parentResults: ToolResult[][] = [];
  streamChatWithTools.mockImplementation(async (params) => {
    if (isSubagent(params)) return subagent(params);
    parentResults.push((await params.runTools?.(calls)) ?? []);
    params.callbacks?.onContentDelta?.("Answer");
    return { fullText: "Answer" };
  });
  return parentResults;
}

const runStore = () => ({ save: vi.fn(), load: vi.fn(async () => null) });

function baseParams() {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [
      { role: "system", content: "Base prompt." },
      { role: "user", content: "Review the lease." },
    ],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    subagentRuns: runStore(),
  };
}

const delegationsIn = (events: { type: string }[]) =>
  events.filter((e): e is DelegationEvent => e.type === "delegation");

beforeEach(() => {
  vi.clearAllMocks();
});

// LiTT training, criteria contrast (lib/trainingTurn/criteria.ts): exactly two
// subagents, on what the server assigned.
const ROUTES = {
  routes: [
    { name: "fast", description: "Skims and extracts.", model: "gemini-3.5-flash-lite" },
    { name: "deep", description: "Careful legal analysis.", model: "claude-opus-5-5" },
    { name: "other", description: "Something else.", model: "gemini-3.1-pro-preview" },
  ],
  default: "other",
};
const governed = (model: string) => ({
  ok: true as const,
  model,
  provider: model.startsWith("claude") ? "claude" : "gemini",
  apiKeys: { [model.startsWith("claude") ? "claude" : "gemini"]: `key-for-${model}` },
});
const plan = (assignments: { route: string | null; approach: "literal" | "systematic" | null }[] | null) => ({
  systemAddendum: "ESTE TURNO ES UN CONTRASTE DE CRITERIOS",
  allowDocumentMutation: false as const,
  includeAskInputs: false as const,
  delegation: { requestedRoutes: null, assignments, runs: [] as (CriteriaRun | null)[] },
});
const delegateSchemaOf = (call: StreamChatCall) =>
  call.tools.find((t) => t.function.name === "delegate")?.function.parameters as {
    properties: Record<string, { enum?: string[] }>;
  };

describe("runLLMStream criteria contrast", () => {
  it("offers only the two assigned routes, runs each on its own, and ignores the route the model names", async () => {
    const models: string[] = [];
    const parentResults = parentDelegates(
      [
        // The model names the wrong routes, a third subagent and a continuation: none of it counts.
        delegate("d1", { route: "other" }),
        delegate("d2", { route: "other" }),
        delegate("d3", { route: "fast" }),
        delegate("d4", { continue: "earlier" }),
      ],
      async (params) => {
        models.push(params.model);
        params.callbacks?.onContentDelta?.("Brief.");
        return { fullText: "Brief." };
      },
    );
    const govern = vi.fn(async (route: { name: string; model: string }) => governed(route.model));
    const trainingPlan = plan([
      { route: "deep", approach: null },
      { route: "fast", approach: null },
    ]);

    const result = await runLLMStream({
      ...baseParams(),
      subagentRoutes: { routes: ROUTES, govern },
      trainingPlan,
    });

    const parent = streamChatWithTools.mock.calls[0][0];
    expect([...(delegateSchemaOf(parent).properties.route.enum ?? [])].sort()).toEqual(["deep", "fast"]);
    expect(parent.systemPrompt).toContain("ESTE TURNO ES UN CONTRASTE DE CRITERIOS");
    expect(models.sort()).toEqual(["claude-opus-5-5", "gemini-3.5-flash-lite"]);
    expect(govern.mock.calls.map(([route]) => route.name).sort()).toEqual(["deep", "fast"]);
    expect(delegationsIn(result.events).map((e) => e.route)).toEqual(["deep", "fast"]);
    expect(trainingPlan.delegation.runs).toEqual([
      expect.objectContaining({ route: "deep", provider: "claude", model: "claude-opus-5-5", status: "completed", brief: "Brief." }),
      expect.objectContaining({ route: "fast", provider: "gemini", model: "gemini-3.5-flash-lite", status: "completed" }),
    ]);
    expect(parentResults[0].slice(2).map((r) => r.content).join("")).toContain("exactly two subagents");
  });

  it("with two approaches, runs both on the conversation's model even if the person has a route or a default", async () => {
    const tasks: string[] = [];
    const models: string[] = [];
    parentDelegates([delegate("d1", { route: "deep" }), delegate("d2")], async (params) => {
      models.push(params.model);
      tasks.push(params.messages.map((m) => m.content).join("\n"));
      return { fullText: "Brief." };
    });
    const govern = vi.fn();
    const trainingPlan = plan([
      { route: null, approach: "literal" },
      { route: null, approach: "systematic" },
    ]);

    const result = await runLLMStream({
      ...baseParams(),
      subagentRoutes: { routes: { routes: [ROUTES.routes[1]], default: "deep" }, govern },
      trainingPlan,
    });

    const parent = streamChatWithTools.mock.calls[0][0];
    expect(delegateSchemaOf(parent).properties.route).toBeUndefined();
    expect(govern).not.toHaveBeenCalled();
    expect(models).toEqual(["gemini-3.8-flash", "gemini-3.8-flash"]);
    expect(tasks.some((t) => t.includes("literal"))).toBe(true);
    expect(tasks.some((t) => t.includes("systematic"))).toBe(true);
    expect(delegationsIn(result.events).every((e) => e.route === undefined)).toBe(true);
    expect(trainingPlan.delegation.runs.map((r) => r?.approach)).toEqual(["literal", "systematic"]);
  });

  it("a route that cannot run fails visibly and is not replaced by another", async () => {
    const models: string[] = [];
    parentDelegates([delegate("d1"), delegate("d2")], async (params) => {
      models.push(params.model);
      return { fullText: "Brief." };
    });
    const govern = vi.fn(async (route: { name: string; model: string }) =>
      route.name === "deep"
        ? { ok: false as const, detail: "The key for this route was revoked." }
        : governed(route.model),
    );
    const trainingPlan = plan([
      { route: "deep", approach: null },
      { route: "fast", approach: null },
    ]);

    const result = await runLLMStream({
      ...baseParams(),
      subagentRoutes: { routes: ROUTES, govern },
      trainingPlan,
    });

    expect(models).toEqual(["gemini-3.5-flash-lite"]);
    expect(delegationsIn(result.events)[0]).toMatchObject({
      route: "deep",
      status: "failed",
      route_unavailable: "The key for this route was revoked.",
    });
    expect(trainingPlan.delegation.runs[0]).toMatchObject({ route: "deep", status: "failed", brief: "" });
    expect(trainingPlan.delegation.runs[1]).toMatchObject({ route: "fast", status: "completed" });
  });

  it("fails closed before any model call when the assignments are not decided or subagents are not available", async () => {
    await expect(
      runLLMStream({ ...baseParams(), trainingPlan: plan(null) }),
    ).rejects.toThrow(/criteria contrast cannot run/);
    await expect(
      runLLMStream({
        ...baseParams(),
        subagentRuns: null,
        trainingPlan: plan([
          { route: null, approach: "literal" },
          { route: null, approach: "systematic" },
        ]),
      }),
    ).rejects.toThrow(/criteria contrast cannot run/);
    expect(streamChatWithTools).not.toHaveBeenCalled();
  });

  it("a refused call before it starts frees its slot for the retry", async () => {
    const parentResults = parentDelegates([delegate("d1", { documents: ["nope"] })], async () => ({ fullText: "Brief." }));
    const trainingPlan = plan([
      { route: null, approach: "literal" },
      { route: null, approach: "systematic" },
    ]);
    await runLLMStream({ ...baseParams(), trainingPlan });
    expect(parentResults[0][0].content).toMatch(/error/i);
    expect(trainingPlan.delegation.runs).toEqual([]);
  });
});
