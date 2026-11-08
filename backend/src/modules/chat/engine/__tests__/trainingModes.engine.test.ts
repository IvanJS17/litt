import { beforeEach, describe, expect, it, vi } from "vitest";

// Hints and counterparty rounds (lib/trainingTurn/modes.ts) ask the engine
// for three things, all of which can only narrow a turn: no writers, no
// ask_inputs and no subagents; their system text; and the server's
// «sin verificar» footer. These run the real plan of each mode through the
// real engine.

const { streamChatWithTools, runToolCalls, verified } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({ fullText: "" })),
  runToolCalls: vi.fn(async (_calls: { function: { name: string } }[]) => ({
    toolResults: [],
    docsRead: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    workflowsApplied: [],
    docsEdited: [],
    askInputsEvents: [],
    mcpEvents: [],
  })),
  verified: { citations: [] as unknown[] },
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));
vi.mock("../../../../lib/integrations/googleDrive", () => ({ buildGoogleDriveTools: async () => [] }));
vi.mock("../../../../lib/integrations/googleWorkspace", () => ({ buildGoogleWorkspaceTools: async () => [] }));
vi.mock("../tools/toolDispatcher", () => ({
  runToolCalls: (calls: { function: { name: string } }[]) => runToolCalls(calls),
}));
vi.mock("../verifyCitations", () => ({ verifyCitations: async () => verified.citations }));

import { memoryDb } from "../../../../__tests__/helpers/memoryDb";
import { beginTrainingTurn, trainingEnginePlan, type TrainingEnginePlan } from "../../../../lib/trainingTurn";
import { UNVERIFIED_LEGAL_FOOTER } from "../../../../lib/trainingHint";
import { runLLMStream } from "../streaming";
import { DOCUMENT_MUTATING_TOOL_NAMES, PROJECT_EXTRA_TOOLS } from "../tools/toolSchemas";
import { WORD_CLIENT_TOOLS, isWordClientToolName } from "../tools/wordClientTools";

type StreamChatCall = {
  tools: { function: { name: string } }[];
  systemPrompt: string;
  runTools?: (
    calls: { id: string; name: string; input: Record<string, unknown> }[],
  ) => Promise<{ tool_use_id: string; content: string }[]>;
  callbacks?: { onContentDelta?: (delta: string) => void };
  [key: string]: unknown;
};

const ORG = "00000000-0000-4000-8000-000000000010";
const USER = "00000000-0000-4000-8000-000000000001";
const ATTEMPT = "Creo que la acción cambiaria prescribió porque pasaron más de tres años desde el vencimiento.";

/** The real plan of a pasante's turn in `mode`. */
async function planFor(mode: string, notes: Record<string, unknown>[] = []): Promise<TrainingEnginePlan> {
  const { db } = memoryDb({
    training_stages: [{ org_id: ORG, trainee_user_id: USER, practice: null, stage: "pasante" }],
    organizations: [{ id: ORG, kind: "team", deleted_at: null }],
    projects: [],
    matters: [],
    training_urgency_passes: [],
    training_turn_notes: notes,
  });
  const begun = await beginTrainingTurn(db, {
    surface: "chat",
    userId: USER,
    scope: { orgId: ORG },
    body: { attempt: ATTEMPT, confidence: 2, training_mode: mode },
    chatId: "chat-1",
  });
  if (!begun.ok) throw new Error(`refused: ${begun.code}`);
  const plan = trainingEnginePlan(begun.plan);
  if (!plan) throw new Error("no engine plan");
  return plan;
}

function params(trainingPlan?: TrainingEnginePlan) {
  return {
    model: "gemini-3.8-flash",
    apiMessages: [
      { role: "system", content: "Base." },
      { role: "user", content: "Pregunta" },
    ],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    extraTools: PROJECT_EXTRA_TOOLS,
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
    trainingPlan,
  };
}

const names = () => streamChatWithTools.mock.calls[0]![0].tools.map((tool) => tool.function.name);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LITT_CHAT_SUBAGENTS = "enabled";
  verified.citations = [];
  streamChatWithTools.mockResolvedValue({ fullText: "" });
});

describe("the tools of a hint or counterpart turn", () => {
  const MODES = ["hint", "counterpart"] as const;

  it.each(MODES)("%s: no writer, no ask_inputs and no subagents are advertised, and the mode's text is", async (mode) => {
    // A negative control first: the same turn without a plan advertises them.
    await runLLMStream(params() as never);
    const plain = names();
    expect(plain).toEqual(expect.arrayContaining(["ask_inputs", "edit_document", "delegate"]));
    streamChatWithTools.mockClear();

    await runLLMStream(params(await planFor(mode)) as never);
    const advertised = names();
    for (const writer of DOCUMENT_MUTATING_TOOL_NAMES) expect(advertised).not.toContain(writer);
    expect(advertised).not.toContain("ask_inputs");
    expect(advertised).not.toContain("delegate");
    // Reading stays: the pista and the objections lean on the matter's documents.
    expect(advertised).toEqual(expect.arrayContaining(["read_document", "list_documents"]));
    expect(streamChatWithTools.mock.calls[0]![0].systemPrompt).toMatch(
      mode === "hint" ? /ES UNA PISTA/ : /ABOGADO DE LA CONTRAPARTE/,
    );
  });

  it.each(MODES)("%s: a writer the model asks for anyway is refused and never dispatched", async (mode) => {
    const plan = await planFor(mode);
    let results: { tool_use_id: string; content: string }[] | undefined;
    streamChatWithTools.mockImplementation(async (call: StreamChatCall) => {
      results = await call.runTools?.([
        ...[...DOCUMENT_MUTATING_TOOL_NAMES].map((name, index) => ({ id: `w${index}`, name, input: {} })),
        { id: "r", name: "read_document", input: { doc_id: "doc-0" } },
      ]);
      return { fullText: "" };
    });
    await runLLMStream(params(plan) as never);
    expect(runToolCalls.mock.calls[0]![0].map((call) => call.function.name)).toEqual(["read_document"]);
    for (const result of results!.slice(0, -1))
      expect(result.content).toMatch(/is not available/);
  });
});

describe("Word with cloud storage: the add-in's client tools in a restricted turn", () => {
  const execute = vi.fn(async () => ({ content: "{}", events: [] }));
  const wordParams = (plan?: TrainingEnginePlan) => ({
    ...params(plan),
    clientTools: { schemas: WORD_CLIENT_TOOLS, owns: isWordClientToolName, execute },
  });

  it("an ordinary Word turn still has apply_word_edits (negative control)", async () => {
    await runLLMStream(wordParams() as never);
    expect(names()).toContain("apply_word_edits");
  });

  it.each(["hint", "counterpart"] as const)("%s: apply_word_edits is neither advertised nor executed", async (mode) => {
    execute.mockClear();
    const plan = await planFor(mode);
    streamChatWithTools.mockImplementation(async (call: StreamChatCall) => {
      expect(call.tools.map((tool) => tool.function.name)).not.toContain("apply_word_edits");
      const results = await call.runTools?.([
        { id: "w", name: "apply_word_edits", input: { edits: [{ original: "a", replacement: "b" }] } },
      ]);
      expect(results![0]!.content).toMatch(/is not available/);
      return { fullText: "" };
    });
    await runLLMStream(wordParams(plan) as never);
    expect(execute).not.toHaveBeenCalled();
    expect(streamChatWithTools).toHaveBeenCalled();
    expect(names()).toContain("read_active_document");
  });
});

describe("the «sin verificar» footer", () => {
  async function answer(text: string, plan?: TrainingEnginePlan) {
    const write = vi.fn();
    streamChatWithTools.mockImplementation(async (call: StreamChatCall) => {
      call.callbacks?.onContentDelta?.(text);
      return { fullText: text };
    });
    const result = await runLLMStream({ ...params(plan), write } as never);
    return { result, frames: write.mock.calls.map(([line]) => String(line)) };
  }

  it("is added by the server to a hint that names a law no verified citation backs", async () => {
    const { result, frames } = await answer("Revisa el artículo 1949 del Código Civil.", await planFor("hint"));
    expect(result.fullText).toContain(UNVERIFIED_LEGAL_FOOTER);
    expect(result.events).toContainEqual({ type: "content", text: `\n\n${UNVERIFIED_LEGAL_FOOTER}` });
    expect(frames.some((line) => line.includes("Sin verificar"))).toBe(true);
  });

  it("is left out when a verified citation of the turn contains the reference", async () => {
    verified.citations = [
      { ref: 1, doc_id: "doc-0", quote: "Artículo 1949.- La facultad de resolver las obligaciones", verified: true },
    ];
    const text = "Revisa el artículo 1949 del Código Civil.\n<CITATIONS>[]</CITATIONS>";
    const { result } = await answer(text, await planFor("hint"));
    expect(result.fullText).not.toContain("Sin verificar");
  });

  it("does not count an unverified citation as backing", async () => {
    verified.citations = [{ ref: 1, doc_id: "doc-0", quote: "artículo 1949", verified: false }];
    const { result } = await answer("Mira el artículo 1949.", await planFor("hint"));
    expect(result.fullText).toContain("Sin verificar");
  });

  it("is not added to an answer with no legal reference, nor to a turn without a mode", async () => {
    const { result } = await answer("Piensa en qué figura está en juego.", await planFor("hint"));
    expect(result.fullText).not.toContain("Sin verificar");
    const ordinary = await answer("Según el artículo 1949 del Código Civil...", undefined);
    expect(ordinary.result.fullText).not.toContain("Sin verificar");
  });
});
