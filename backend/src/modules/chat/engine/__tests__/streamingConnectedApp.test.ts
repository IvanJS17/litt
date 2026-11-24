import { beforeEach, describe, expect, it, vi } from "vitest";

// A turn that a connected application starts runs with only the tools its
// connection's permissions allow (`allowedCapabilities`): reading always,
// running reviews with litt.run, writing documents with litt.write, and never
// the person's third-party connectors. These scripts drive the real tool loop
// and the real dispatcher with a scripted model; only what a tool would touch
// outside the process (document writer, review engine, remote connector) is a
// spy.

const h = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(),
  runEditDocument: vi.fn(),
  generateDocx: vi.fn(),
  reviewWithPlaybook: vi.fn(),
  executeMcpToolCall: vi.fn(),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: unknown) => h.streamChatWithTools(params),
}));
vi.mock("../tools/documentOps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tools/documentOps")>()),
  runEditDocument: h.runEditDocument,
  generateDocx: h.generateDocx,
}));
vi.mock("../../../playbooks/playbooks.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../playbooks/playbooks.service")>()),
  reviewWithPlaybook: h.reviewWithPlaybook,
}));
vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => [
    { type: "function", function: { name: "mcp_dummymail_send_message", parameters: {} } },
  ]),
  executeMcpToolCall: h.executeMcpToolCall,
}));
vi.mock("../tools/connectorApprovals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tools/connectorApprovals")>()),
  planConnectorToolCall: vi.fn(async () => ({ type: "run" })),
}));
vi.mock("../../../../lib/integrations/googleDrive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/integrations/googleDrive")>()),
  buildGoogleDriveTools: vi.fn(async () => []),
}));
vi.mock("../../../../lib/integrations/googleWorkspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/integrations/googleWorkspace")>()),
  buildGoogleWorkspaceTools: vi.fn(async () => []),
}));

process.env.LITT_CHAT_SUBAGENTS = "enabled";

import { runLLMStream } from "../streaming";
import * as dispatcher from "../tools/toolDispatcher";
import { runToolCalls } from "../tools/toolDispatcher";
import type { ToolCapability } from "../tools/toolCapabilities";
import { PROJECT_EXTRA_TOOLS } from "../tools/toolSchemas";
import { buildUserMcpTools } from "../../../../lib/mcpConnectors";
import { buildGoogleDriveTools } from "../../../../lib/integrations/googleDrive";
import { buildGoogleWorkspaceTools } from "../../../../lib/integrations/googleWorkspace";

type Call = { id: string; name: string; input: Record<string, unknown> };
type Result = { tool_use_id: string; content: string };
type StreamCall = {
  systemPrompt: string;
  tools: { function: { name: string } }[];
  runTools?: (calls: Call[]) => Promise<Result[]>;
};

const READ: ToolCapability[] = ["read"];
const READ_WRITE: ToolCapability[] = ["read", "write"];
const READ_RUN_WRITE: ToolCapability[] = ["read", "run", "write"];

const isSubagent = (params: StreamCall) => params.systemPrompt.includes("SUBAGENT:");
const toolNames = (params: StreamCall) => params.tools.map((tool) => tool.function.name);

// What a model could ask for: change a document, run a review, write a new
// document, reach a connector.
const ASKS: Call[] = [
  { id: "edit", name: "edit_document", input: { doc_id: "doc-0", edits: [{ find: "a", replace: "b" }] } },
  { id: "review", name: "run_playbook", input: { doc_id: "doc-0", playbook_id: "p1" } },
  { id: "docx", name: "generate_docx", input: { title: "Note", sections: [] } },
  { id: "mail", name: "mcp_dummymail_send_message", input: { to: "x@example.test" } },
];

function params(extra: Record<string, unknown> = {}) {
  return {
    model: "gemini-3.8-flash",
    credentialRef: "user:u1:gemini:v1",
    apiMessages: [
      { role: "system", content: "Base prompt." },
      { role: "user", content: "Do it." },
    ],
    docStore: new Map([["doc-0", { filename: "Lease.docx", file_type: "docx" }]]) as never,
    docIndex: { "doc-0": { document_id: "d1", version_id: "v1", version_number: 1 } } as never,
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    nonce: "turnnonce",
    extraTools: PROJECT_EXTRA_TOOLS,
    subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) } as never,
    ...extra,
  };
}

/** The scripted model asks for every tool in ASKS; returns what the loop answered. */
function scriptedModel() {
  const answers: Result[][] = [];
  h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
    answers.push((await call.runTools?.(ASKS)) ?? []);
    return { fullText: "" };
  });
  return answers;
}

const touched = () => ({
  edit: h.runEditDocument.mock.calls.length,
  review: h.reviewWithPlaybook.mock.calls.length,
  docx: h.generateDocx.mock.calls.length,
  mail: h.executeMcpToolCall.mock.calls.length,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.runEditDocument.mockResolvedValue({ ok: false, error: "stub" });
  h.generateDocx.mockResolvedValue({ error: "stub" });
  h.reviewWithPlaybook.mockRejectedValue(new Error("stub"));
  h.executeMcpToolCall.mockResolvedValue({
    content: JSON.stringify({ ok: true }),
    event: {
      type: "mcp_tool_call",
      connector_id: "c1",
      connector_name: "DummyMail",
      tool_name: "send_message",
      openai_tool_name: "mcp_dummymail_send_message",
      status: "ok",
    },
  });
});

describe("runLLMStream: a turn narrowed to what a connection allows", () => {
  it("leaves a turn with no restriction (the web app, Word) with every tool", async () => {
    scriptedModel();
    await runLLMStream(params());

    const offered = toolNames(h.streamChatWithTools.mock.calls[0][0]);
    expect(offered).toEqual(expect.arrayContaining(["edit_document", "run_playbook", "generate_docx", "mcp_dummymail_send_message"]));
    expect(touched()).toEqual({ edit: 1, review: 1, docx: 1, mail: 1 });
  });

  it("with read only: offers no writer, no review and no connector, and refuses them if named", async () => {
    const answers = scriptedModel();
    await runLLMStream(params({ allowedCapabilities: READ }));

    const offered = toolNames(h.streamChatWithTools.mock.calls[0][0]);
    for (const name of ["edit_document", "replicate_document", "generate_docx", "generate_excel", "generate_ppt", "run_playbook", "mcp_dummymail_send_message"])
      expect(offered, name).not.toContain(name);
    expect(offered).toEqual(expect.arrayContaining(["read_document", "find_in_document", "list_documents", "fetch_documents", "list_workflows"]));
    expect(touched()).toEqual({ edit: 0, review: 0, docx: 0, mail: 0 });
    expect(answers[0].map((r) => r.content)).toEqual(ASKS.map((c) => JSON.stringify({ error: `Tool '${c.name}' is not available.` })));
  });

  it("with write: documents are written, but no review runs and no connector is reached", async () => {
    scriptedModel();
    await runLLMStream(params({ allowedCapabilities: READ_WRITE }));

    expect(touched()).toEqual({ edit: 1, review: 0, docx: 1, mail: 0 });
    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).not.toContain("run_playbook");
  });

  it("with run and write: the review runs, the connector is still never reached", async () => {
    scriptedModel();
    await runLLMStream(params({ allowedCapabilities: READ_RUN_WRITE }));

    expect(touched()).toEqual({ edit: 1, review: 1, docx: 1, mail: 0 });
    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).not.toContain("mcp_dummymail_send_message");
  });

  it("a tool nobody declared is offered to the web but never to a narrowed turn", async () => {
    const undeclared = { type: "function", function: { name: "brand_new_tool", parameters: {} } };
    scriptedModel();
    await runLLMStream(params({ extraTools: [...PROJECT_EXTRA_TOOLS, undeclared] }));
    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).toContain("brand_new_tool");

    h.streamChatWithTools.mockClear();
    scriptedModel();
    await runLLMStream(params({ extraTools: [...PROJECT_EXTRA_TOOLS, undeclared], allowedCapabilities: READ_RUN_WRITE }));
    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).not.toContain("brand_new_tool");
  });

  it("the dispatcher itself refuses a tool outside the capabilities, before anything runs", async () => {
    const toolCalls = ASKS.map((c) => ({ id: c.id, function: { name: c.name, arguments: JSON.stringify(c.input) } }));
    const { docStore, docIndex } = params();
    const result = await runToolCalls(toolCalls, docStore, "u1", {} as never, vi.fn(), undefined, undefined, docIndex, undefined, undefined, undefined, undefined, {
      allowedCapabilities: READ,
      model: "gemini-3.8-flash",
    });

    expect(touched()).toEqual({ edit: 0, review: 0, docx: 0, mail: 0 });
    expect(result.toolResults.map((r) => (r as { content: string }).content)).toEqual(ASKS.map((c) => JSON.stringify({ error: `Tool '${c.name}' is not available.` })));
  });

  describe("subagents", () => {
    const delegate: Call = { id: "d1", name: "delegate", input: { title: "Task", task: "Do it." } };
    function parentDelegates() {
      const subagent: { tools: string[]; answers: Result[] } = { tools: [], answers: [] };
      h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
        if (isSubagent(call)) {
          subagent.tools = toolNames(call);
          subagent.answers = (await call.runTools?.(ASKS)) ?? [];
          return { fullText: "Brief." };
        }
        await call.runTools?.([delegate]);
        return { fullText: "Answer." };
      });
      return subagent;
    }

    it("a subagent of a narrowed turn does not regain the tools", async () => {
      const subagent = parentDelegates();
      await runLLMStream(params({ allowedCapabilities: READ }));

      expect(subagent.tools.length).toBeGreaterThan(0);
      for (const name of ["edit_document", "generate_docx", "run_playbook", "mcp_dummymail_send_message"])
        expect(subagent.tools, name).not.toContain(name);
      expect(touched()).toEqual({ edit: 0, review: 0, docx: 0, mail: 0 });
      expect(subagent.answers.every((r) => r.content.includes("not available"))).toBe(true);
    });

    it("a subagent of a turn with write keeps the writers and still has no connector", async () => {
      const subagent = parentDelegates();
      await runLLMStream(params({ allowedCapabilities: READ_WRITE }));

      expect(subagent.tools).toContain("generate_docx");
      expect(subagent.tools).not.toContain("mcp_dummymail_send_message");
      expect(subagent.tools).not.toContain("run_playbook");
      expect(touched().mail).toBe(0);
      expect(touched().review).toBe(0);
    });

    it("a subagent of an unrestricted turn keeps its connectors", async () => {
      parentDelegates();
      await runLLMStream(params());
      expect(touched().mail).toBe(1);
    });
  });

  it("does not even build the person's connector tools for a narrowed turn", async () => {
    scriptedModel();
    await runLLMStream(params({ allowedCapabilities: READ_RUN_WRITE }));
    expect(buildUserMcpTools).not.toHaveBeenCalled();
    expect(buildGoogleDriveTools).not.toHaveBeenCalled();
    expect(buildGoogleWorkspaceTools).not.toHaveBeenCalled();

    await runLLMStream(params());
    expect(buildUserMcpTools).toHaveBeenCalledTimes(1);
    expect(buildGoogleDriveTools).toHaveBeenCalledTimes(1);
    expect(buildGoogleWorkspaceTools).toHaveBeenCalledTimes(1);
  });

  it("hands the same capabilities to the dispatcher that runs the calls", async () => {
    const seen: unknown[] = [];
    h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
      seen.push(await call.runTools?.([{ id: "one", name: "list_documents", input: {} }]));
      return { fullText: "" };
    });
    const spy = vi.spyOn(dispatcher, "runToolCalls");
    await runLLMStream(params({ allowedCapabilities: READ }));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.every((c) => (c[12] as { allowedCapabilities?: unknown }).allowedCapabilities === READ)).toBe(true);
    spy.mockRestore();
  });
});

describe("runLLMStream: a turn a connection starts never pauses for the person", () => {
  const ASK: Call = { id: "ask", name: "ask_inputs", input: { items: [{ id: "q1", kind: "text", question: "Which one?" }] } };
  const eventTypes = (write: ReturnType<typeof vi.fn>) =>
    write.mock.calls.map((c) => String(c[0])).filter((frame) => frame.includes('"type":"ask_inputs"'));

  const SCOPES: [string, ToolCapability[]][] = [
    ["read", READ],
    ["read and write", READ_WRITE],
    ["read and run", ["read", "run"]],
    ["read, run and write", READ_RUN_WRITE],
  ];

  it.each(SCOPES)("with %s: ask_inputs is not offered and is refused if named, and the turn completes", async (_label, allowed) => {
    const write = vi.fn();
    let answer: Result[] = [];
    h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
      answer = (await call.runTools?.([ASK])) ?? [];
      return { fullText: "Done." };
    });
    const out = await runLLMStream(params({ allowedCapabilities: allowed, write }));

    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).not.toContain("ask_inputs");
    expect(answer.map((r) => r.content)).toEqual([JSON.stringify({ error: "Tool 'ask_inputs' is not available." })]);
    expect(eventTypes(write)).toEqual([]);
    expect(out.events.some((e: { type: string }) => e.type === "ask_inputs")).toBe(false);
  });

  it("a subagent of such a turn cannot ask either", async () => {
    const seen: { tools: string[]; answers: Result[] } = { tools: [], answers: [] };
    h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
      if (isSubagent(call)) {
        seen.tools = toolNames(call);
        seen.answers = (await call.runTools?.([ASK])) ?? [];
        return { fullText: "Brief." };
      }
      await call.runTools?.([{ id: "d1", name: "delegate", input: { title: "Task", task: "Do it." } }]);
      return { fullText: "Answer." };
    });
    const write = vi.fn();
    const out = await runLLMStream(params({ allowedCapabilities: READ_RUN_WRITE, write }));

    expect(seen.tools).not.toContain("ask_inputs");
    expect(seen.answers.map((r) => r.content)).toEqual([JSON.stringify({ error: "Tool 'ask_inputs' is not available." })]);
    expect(eventTypes(write)).toEqual([]);
    expect(out.events.some((e: { type: string }) => e.type === "ask_inputs")).toBe(false);
  });

  it("without limits the person's own turn is offered ask_inputs and pauses on it", async () => {
    const write = vi.fn();
    h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
      await call.runTools?.([ASK]);
      return { fullText: "" };
    });
    const out = await runLLMStream(params({ write }));

    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).toContain("ask_inputs");
    expect(eventTypes(write)).toHaveLength(1);
    expect(out.events.some((e: { type: string }) => e.type === "ask_inputs")).toBe(true);
  });

  it("without limits includeAskInputs false still hides it", async () => {
    scriptedModel();
    await runLLMStream(params({ includeAskInputs: false }));
    expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).not.toContain("ask_inputs");
  });
});

describe("runLLMStream: the methodology annex needs write", () => {
  const METHOD: Call = {
    id: "m1",
    name: "compute_methodology",
    input: {
      calculation: "proportion",
      inputs: [
        { name: "numerator", value: "1", source: { kind: "person" } },
        { name: "denominator", value: "4", source: { kind: "person" } },
      ],
    },
  };
  const methodParams = (allowedCapabilities?: ToolCapability[]) =>
    params({
      trainingPlan: { methodology: true },
      apiMessages: [{ role: "user", content: "What share is 1 of 4?" }],
      ...(allowedCapabilities ? { allowedCapabilities } : {}),
    });

  function scriptMethodology() {
    h.streamChatWithTools.mockImplementation(async (call: StreamCall) => {
      await call.runTools?.([METHOD]);
      return { fullText: "" };
    });
  }

  it.each([["read", READ], ["read and run", ["read", "run"] as ToolCapability[]]])(
    "with %s: the calculation is returned and no annex is written",
    async (_label, allowed) => {
      scriptMethodology();
      const out = await runLLMStream(methodParams(allowed));

      expect(toolNames(h.streamChatWithTools.mock.calls[0][0])).toContain("compute_methodology");
      expect(h.generateDocx).not.toHaveBeenCalled();
      expect(out.events.some((e: { type: string }) => e.type === "doc_created")).toBe(false);
    },
  );

  it("with write: the annex is written", async () => {
    scriptMethodology();
    await runLLMStream(methodParams(READ_WRITE));
    expect(h.generateDocx).toHaveBeenCalledTimes(1);
  });

  it("without limits: the annex is written", async () => {
    scriptMethodology();
    await runLLMStream(methodParams());
    expect(h.generateDocx).toHaveBeenCalledTimes(1);
  });
});
