import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// compute_methodology: advertised only when the training plan asks for it, and
// run in-process by the tool loop with exact arithmetic and a Word annex.

const { streamChatWithTools, uploadFileMock } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({ fullText: "" })),
  uploadFileMock: vi.fn(),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));
vi.mock("../../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadFile: vi.fn(),
  generatedDocKey: (userId: string, docId: string, filename: string) => `generated/${userId}/${docId}/${filename}`,
  uploadFile: (...args: unknown[]) => uploadFileMock(...args),
}));
vi.mock("../../../../lib/downloadTokens", () => ({
  buildDownloadUrl: () => "/download/test-token",
}));

import { runLLMStream } from "../streaming";
import { runToolCalls } from "../tools/toolDispatcher";
import { METHODOLOGY_TOOL_NAME } from "../tools/methodologyTool";

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
  };
}

const toolNames = () => streamChatWithTools.mock.calls[0]![0].tools.map((tool) => tool.function.name);

beforeEach(() => vi.clearAllMocks());

describe("what the model is shown", () => {
  it("offers the tool and its instructions only when the plan asks for it", async () => {
    await runLLMStream(params() as never);
    expect(toolNames()).not.toContain(METHODOLOGY_TOOL_NAME);
    expect(streamChatWithTools.mock.calls[0]![0].systemPrompt).not.toContain("METHODOLOGY CALCULATIONS");
    streamChatWithTools.mockClear();
    await runLLMStream({ ...params(), trainingPlan: { noSubagents: true } } as never);
    expect(toolNames()).not.toContain(METHODOLOGY_TOOL_NAME);
    streamChatWithTools.mockClear();
    await runLLMStream({ ...params(), trainingPlan: { methodology: true } } as never);
    expect(toolNames()).toContain(METHODOLOGY_TOOL_NAME);
    const prompt = streamChatWithTools.mock.calls[0]![0].systemPrompt;
    expect(prompt).toContain("METHODOLOGY CALCULATIONS");
    expect(prompt).toContain("Do not present it as legal advice");
  });

  it("keeps the other limits of the same plan", async () => {
    await runLLMStream({
      ...params(),
      trainingPlan: { methodology: true, allowDocumentMutation: false, includeAskInputs: false },
    } as never);
    const names = toolNames();
    expect(names).toContain(METHODOLOGY_TOOL_NAME);
    expect(names).not.toContain("edit_document");
    expect(names).not.toContain("ask_inputs");
  });
});

function fakeDb() {
  return {
    rpc: vi.fn(async () => ({ data: { id: "version-1", version_number: 1 }, error: null })),
    from(table: string) {
      const result = { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of ["insert", "select", "update", "eq"]) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      query.single = vi.fn(async () => ({ data: { id: table === "documents" ? "doc-1" : "version-1" }, error: null }));
      query.then = (resolve: (value: typeof result) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return query;
    },
  };
}

const CONTRACT = "CLÁUSULA TERCERA. El índice inicial será de 100.000 puntos y el índice final, el del mes de pago.";

async function call(
  input: Record<string, unknown>,
  options: { methodology?: boolean; allowDocumentMutation?: boolean } = { methodology: true },
) {
  const docStore = new Map([
    ["doc-0", { storage_path: "x", file_type: "docx", filename: "contrato.docx", inline_text: CONTRACT }],
  ]);
  const write = vi.fn();
  const out = await runToolCalls(
    [{ id: "call-1", function: { name: METHODOLOGY_TOOL_NAME, arguments: JSON.stringify(input) } }],
    docStore as never,
    "u1",
    fakeDb() as never,
    write,
    undefined,
    undefined,
    {},
    undefined,
    undefined,
    null,
    "nonce",
    { userEmail: "junior@example.com", ...options },
  );
  return { out, write };
}

const INDEX_CALL = {
  calculation: "index_update",
  inputs: [
    { name: "amount", value: "1000.00", source: { kind: "person" } },
    { name: "initial_index", value: "100.000", source: { kind: "document", doc_id: "doc-0", quote: "El índice inicial será de 100.000 puntos" } },
    { name: "final_index", value: "133.333", source: { kind: "document", doc_id: "doc-0", quote: "texto que no está en el contrato" } },
  ],
};

describe("running the tool", () => {
  it("calculates, verifies sources and writes the annex a junior can follow", async () => {
    let bytes: ArrayBuffer | undefined;
    uploadFileMock.mockImplementationOnce(async (_key: string, uploaded: ArrayBuffer) => {
      bytes = uploaded;
    });
    const { out, write } = await call(INDEX_CALL);
    expect(out.docsCreated).toHaveLength(1);
    expect(out.docsCreated[0]!.filename).toContain("Anexo de metodolog");
    const payload = JSON.parse((out.toolResults[0] as { content: string }).content);
    expect(payload.calculation.result).toEqual({ label: "Monto actualizado", value: "1333.33" });
    expect(payload.calculation.inputs.map((i: { source: string }) => i.source)).toEqual([
      "Dato dado por la persona",
      expect.stringContaining("(cita verificada)"),
      expect.stringContaining("sin verificar"),
    ]);
    expect(payload).not.toHaveProperty("download_url");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("doc_created"));
    const xml = await (await JSZip.loadAsync(bytes!)).file("word/document.xml")!.async("string");
    for (const text of ["Datos de origen", "Fórmula", "Pasos", "1333.33", "Regla de redondeo", "junior@example.com", "No es una opinión jurídica"]) {
      // Headings are set in capitals by the document generator.
      expect(xml.toUpperCase()).toContain(text.toUpperCase());
    }
  });

  it("returns the steps without a file when the conversation cannot write documents", async () => {
    const { out } = await call(INDEX_CALL, { methodology: true, allowDocumentMutation: false });
    expect(out.docsCreated).toHaveLength(0);
    expect(uploadFileMock).not.toHaveBeenCalled();
    const payload = JSON.parse((out.toolResults[0] as { content: string }).content);
    expect(payload.result.value).toBe("1333.33");
    expect(payload.annex).toContain("cannot write documents");
  });

  it("honours annex: false", async () => {
    const { out } = await call({ ...INDEX_CALL, annex: false });
    expect(out.docsCreated).toHaveLength(0);
    expect(JSON.parse((out.toolResults[0] as { content: string }).content).annex).toBe("not requested");
  });

  it("answers a readable error and creates nothing for bad input", async () => {
    for (const bad of [
      { calculation: "mortgage", inputs: [{ name: "a", value: "1" }] },
      { calculation: "proportion", inputs: [] },
      { calculation: "proportion", inputs: [{ name: "numerator", value: "1" }, { name: "denominator", value: "0" }] },
      { calculation: "proportion", inputs: [{ name: "numerator", value: "1,5" }, { name: "denominator", value: "2" }] },
      { calculation: "proportion", inputs: [{ name: "numerator", value: "1" }, { name: "numerator", value: "2" }] },
    ]) {
      const { out } = await call(bad);
      expect(out.docsCreated).toHaveLength(0);
      expect(JSON.parse((out.toolResults[0] as { content: string }).content)).toHaveProperty("error");
    }
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("rejects a JSON number that would be truncated instead of rounding it", async () => {
    for (const value of [9007199254740993, 0.1]) {
      const { out } = await call({
        calculation: "proportion",
        inputs: [{ name: "numerator", value }, { name: "denominator", value: "2" }],
      });
      expect(out.docsCreated).toHaveLength(0);
      expect(JSON.parse((out.toolResults[0] as { content: string }).content).error).toContain("Send it as text");
    }
    const exact = await call({
      calculation: "proportion",
      inputs: [{ name: "numerator", value: "9007199254740993" }, { name: "denominator", value: "9007199254740993" }],
      annex: false,
    });
    expect(JSON.parse((exact.out.toolResults[0] as { content: string }).content).inputs[0].value).toBe("9007199254740993");
  });

  it("does not run when the turn was not offered the tool", async () => {
    const { out } = await call(INDEX_CALL, {});
    expect(out.toolResults).toHaveLength(0);
    expect(out.docsCreated).toHaveLength(0);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.restoreAllMocks());
