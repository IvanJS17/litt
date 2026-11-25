import { describe, expect, it, vi } from "vitest";

const { streamChatWithTools } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: unknown) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: vi.fn(async () => []) }));
vi.mock("../tools/toolDispatcher", () => ({ runToolCalls: vi.fn() }));

import { startAssistantTurnRun } from "../../../../lib/assistantTurnRuns";
import { getStreamRun, MAX_RUN_BUFFERED_BYTES, resetStreamRunsForTests } from "../../../../lib/streamRuns";
import { runLLMStream } from "../streaming";

type Callbacks = { onContentDelta?: (text: string) => void };

/** A long answer that cites a hundred documents, `count` times over. */
async function answerWithCitations(count: number, frames?: Array<{ line: string; slot?: string }>) {
  const docIndex: Record<string, unknown> = {};
  for (let d = 0; d < 100; d++) {
    docIndex[`doc-${d}`] = {
      document_id: `00000000-0000-4000-8000-${String(d).padStart(12, "0")}`,
      filename: `Lease agreement number ${d} (signed copy).pdf`,
      version_id: `10000000-0000-4000-8000-${String(d).padStart(12, "0")}`,
      version_number: 3,
    };
  }
  const quote =
    "The tenant shall keep the premises in good repair and condition throughout the term, fair wear and tear excepted, at its own cost";
  streamChatWithTools.mockImplementation(async (params: { callbacks: Callbacks }) => {
    let body = "";
    for (let k = 1; k <= count; k++) body += `Point ${k} is supported [${k}]. `;
    params.callbacks.onContentDelta?.(`${body}\n<CITATIONS>\n[`);
    for (let k = 1; k <= count; k++) {
      params.callbacks.onContentDelta?.(
        (k > 1 ? "," : "") + JSON.stringify({ ref: k, doc_id: `doc-${k % 100}`, page: 4, quote }),
      );
    }
    params.callbacks.onContentDelta?.("]\n</CITATIONS>");
    return { fullText: "" };
  });
  const run = startAssistantTurnRun({ id: `t-${count}`, chatId: `c-${count}`, userId: "u1", assistantMessageId: "m1" })!;
  await runLLMStream({
    model: "gemini-3.8-flash",
    apiMessages: [{ role: "user", content: "Review the lease." }],
    docStore: new Map(),
    docIndex,
    userId: "u1",
    db: {} as never,
    write: (line: string, opts?: { slot?: string; replay?: () => boolean }) => {
      frames?.push({ line, slot: opts?.slot });
      return run.write(line, opts);
    },
    signal: run.signal,
    nonce: "n",
  } as never);
  let replayed = 0;
  getStreamRun(`t-${count}`)!.subscribe(1, { write: (chunk) => (replayed += Buffer.byteLength(chunk)), end: () => {} });
  return { run, replayed };
}

describe("a long answer with many citations", () => {
  it.each([300, 1_000])("is not stopped at %i citations and leaves one snapshot to replay", async (count) => {
    resetStreamRunsForTests();
    const { run, replayed } = await answerWithCitations(count);
    expect(run.stopReason).toBeNull();
    // Far below the ceiling: only the newest snapshot is held and replayed.
    expect(replayed).toBeLessThan(MAX_RUN_BUFFERED_BYTES / 20);
    run.finish();
  }, 120_000);

  it("writes the final citations frame in the slot of the partial ones, so it replaces the last partial snapshot", async () => {
    resetStreamRunsForTests();
    const frames: Array<{ line: string; slot?: string }> = [];
    const { run } = await answerWithCitations(5, frames);
    const citationFrames = frames.filter(({ line }) => line.includes('"type":"citations"'));
    const final = citationFrames.filter(({ line }) => line.includes('"status":"final"'));
    const partial = citationFrames.filter(({ line }) => !line.includes('"status":"final"'));
    expect(partial.length).toBeGreaterThan(0);
    expect(final).toHaveLength(1);
    expect(new Set(partial.map((frame) => frame.slot))).toEqual(new Set(["citations"]));
    expect(final[0]!.slot).toBe("citations");
    run.finish();
  });
});
