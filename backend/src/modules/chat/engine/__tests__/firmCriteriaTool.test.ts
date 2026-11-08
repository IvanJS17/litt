import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../../../__tests__/helpers/memoryDb";

// list_firm_criteria in a trainee's turn: advertised only when the training
// plan names the organization, read with the caller's own membership, and the
// criteria reach the screen exactly as stored, in a firm_criteria event.

type ToolCall = { id: string; name: string; input: Record<string, unknown> };
type StreamChatCall = {
  tools: { function: { name: string } }[];
  runTools: (calls: ToolCall[]) => Promise<{ tool_use_id: string; content: string }[]>;
  [key: string]: unknown;
};
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
import { runFirmCriteriaCall } from "../tools/firmCriteriaTool";
import { createWebTurnState } from "../tools/webSearchTools";
import type { Db } from "../../../../lib/supabase";

const ORG = "00000000-0000-4000-8000-000000000010";
const OTHER_ORG = "00000000-0000-4000-8000-000000000011";
const USER = "00000000-0000-4000-8000-000000000001";
const AUTHOR = "00000000-0000-4000-8000-000000000002";

const criterion = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`,
  org_id: ORG,
  author_user_id: AUTHOR,
  kind: "criterio",
  practice: "mercantil",
  topic: "Prescripción cambiaria",
  position: "El plazo corre desde el vencimiento.",
  playbook_id: null,
  rule_id: null,
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-02T10:00:00.000Z",
  ...over,
});

function world(extra: Record<string, Record<string, unknown>[]> = {}) {
  return memoryDb({
    org_members: [{ org_id: ORG, user_id: USER, role: "member" }],
    organizations: [{ id: ORG, kind: "team", deleted_at: null }],
    user_profiles: [{ user_id: AUTHOR, display_name: "Ana Pérez", email: "ana@example.test" }],
    firm_criteria: [
      criterion(1),
      criterion(2, { topic: "Competencia", position: "Otra materia.", practice: "civil" }),
      criterion(3, { org_id: OTHER_ORG, position: "De otro despacho." }),
    ],
    ...extra,
  });
}

function params(db: Db, trainingPlan?: Record<string, unknown>) {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "user", content: "Question" }],
    docStore: new Map(),
    docIndex: {},
    userId: USER,
    db,
    write: vi.fn(),
    nonce: "turnnonce",
    apiKeys: { gemini: "k" },
    ...(trainingPlan ? { trainingPlan } : {}),
  };
}

const call = (input: Record<string, unknown>): ToolCall => ({ id: "call-1", name: "list_firm_criteria", input });
const toolNames = () => streamChatWithTools.mock.calls[0]![0].tools.map((tool) => tool.function.name);

beforeEach(() => vi.clearAllMocks());

describe("advertising the tool", () => {
  it("is withheld without a plan that names the organization", async () => {
    await runLLMStream(params(world().db) as never);
    expect(toolNames()).not.toContain("list_firm_criteria");
    streamChatWithTools.mockClear();
    await runLLMStream(params(world().db, { noSubagents: true }) as never);
    expect(toolNames()).not.toContain("list_firm_criteria");
  });

  it("is offered when the plan names the organization", async () => {
    await runLLMStream(params(world().db, { firmCriteriaOrgId: ORG }) as never);
    expect(toolNames()).toContain("list_firm_criteria");
  });

  it("answers 'not available' if the model names it anyway without the plan", async () => {
    await runLLMStream(params(world().db) as never);
    const results = await streamChatWithTools.mock.calls[0]![0].runTools([call({})]);
    expect(JSON.parse(results[0].content)).toEqual({ error: "Tool 'list_firm_criteria' is not available." });
  });
});

describe("running the tool in a turn", () => {
  it("returns the matching criteria to the model and the same ones, as stored, to the screen", async () => {
    const p = params(world().db, { firmCriteriaOrgId: ORG });
    await runLLMStream(p as never);
    const [result] = await streamChatWithTools.mock.calls[0]![0].runTools([call({ practice: "mercantil", topic: "prescripcion" })]);
    const content = JSON.parse(result.content);
    expect(content.criteria).toHaveLength(1);
    expect(content.criteria[0]).toMatchObject({ author: "Ana Pérez", topic: "Prescripción cambiaria", written: "2026-11-01", changed: "2026-11-02" });
    expect(content.criteria[0].position).toContain("El plazo corre desde el vencimiento.");
    expect(content.criteria[0].position).toContain("<untrusted-content");
    expect(JSON.stringify(content)).not.toContain("De otro despacho");

    const frame = p.write.mock.calls.map((c) => String(c[0])).find((chunk) => chunk.includes("firm_criteria"));
    const event = JSON.parse(frame!.replace(/^data: /, ""));
    expect(event).toMatchObject({
      type: "firm_criteria",
      call_id: "call-1",
      practice: "mercantil",
      topic: "prescripcion",
      truncated: false,
      criteria: [{ id: criterion(1).id, author_name: "Ana Pérez", topic: "Prescripción cambiaria", position: "El plazo corre desde el vencimiento." }],
    });
  });

  it("does not offer the tool to a subagent", async () => {
    const parent = params(world().db, { firmCriteriaOrgId: ORG });
    await runLLMStream({
      ...parent,
      subagentRun: {
        connectorTools: [],
        webTurnState: createWebTurnState(""),
        turnEditState: new Map(),
        documentLocks: {} as never,
        documentsScoped: false,
        onToolStart: vi.fn(),
        onUsage: vi.fn(),
        onToolBatch: vi.fn(),
      },
    } as never);
    expect(toolNames()).not.toContain("list_firm_criteria");
  });
});

describe("runFirmCriteriaCall", () => {
  const ctx = (db: Db, orgId = ORG) => ({ db, userId: USER, orgId });

  it("says plainly that the firm wrote nothing, without inventing a position", async () => {
    const { content, event } = await runFirmCriteriaCall(call({ topic: "zzzzzzzz" }), ctx(world().db));
    expect(JSON.parse(content)).toMatchObject({ criteria: [], result: "The firm has written nothing on this." });
    expect(event).toMatchObject({ criteria: [], truncated: false, topic: "zzzzzzzz" });
    expect(event).not.toHaveProperty("error");
  });

  it("names a deleted user as such, and a dissenting opinion's rule", async () => {
    const db = world({
      firm_criteria: [criterion(1, { author_user_id: null, kind: "voto_particular", playbook_id: "p1", rule_id: "r1" })],
    }).db;
    const { content, event } = await runFirmCriteriaCall(call({}), ctx(db));
    const criteria = JSON.parse(content).criteria;
    expect(criteria[0]).toMatchObject({ author: "a user who no longer has an account", disagrees_with_playbook_rule: "r1" });
    expect(event.criteria[0]).toMatchObject({ author_name: null, author_user_id: null, rule_id: "r1" });
  });

  it("ignores arguments that are not text, and cuts long ones", async () => {
    const { event } = await runFirmCriteriaCall(call({ practice: 4, topic: "x".repeat(500) }), ctx(world().db));
    expect(event.practice).toBeNull();
    expect(event.topic).toHaveLength(200);
  });

  it("carries nothing to a caller who is not a member of the organization", async () => {
    const { content, event } = await runFirmCriteriaCall(call({}), ctx(world().db, OTHER_ORG));
    expect(JSON.parse(content)).toEqual({ error: "The firm's criteria could not be consulted." });
    expect(event).toMatchObject({ criteria: [], error: "The firm's criteria could not be consulted." });
  });

  it("fails closed, and says only that it failed, when the table cannot be read", async () => {
    const w = world();
    w.failNext("firm_criteria", "select", { message: "relation firm_criteria exploded" });
    const { content, event } = await runFirmCriteriaCall(call({}), ctx(w.db));
    expect(content).not.toContain("exploded");
    expect(event.error).toBe("The firm's criteria could not be consulted.");
  });

  it("marks a result cut at the maximum", async () => {
    const many = Array.from({ length: 10 }, (_, i) => criterion(i + 1, { id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, "0")}` }));
    const { content, event } = await runFirmCriteriaCall(call({}), ctx(world({ firm_criteria: many }).db));
    expect(event.criteria).toHaveLength(8);
    expect(event.truncated).toBe(true);
    expect(JSON.parse(content).more_exist).toBe(true);
  });
});
