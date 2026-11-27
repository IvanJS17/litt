// An error that crosses a worker thread reaches the supervisor as a structured
// copy: it keeps its fields (request body, reply, headers, URL) but not the AI
// SDK's registry marker. What the supervisor logs must still hide them.
import "../logRedaction";
import { formatWithOptions } from "node:util";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactedProviderError } from "./log";
import { jobErrorMessage } from "./dbq/jobError";

const MARK = "PLANTED-7f3a";

// The thread builds a real SDK call error carrying a marker in the prompt, the
// reply, a header and the URL, then fails the way a thread can fail unhandled.
const thread = (how: "throw" | "reject" | "message") => `
const { APICallError } = require("@ai-sdk/provider");
const { parentPort } = require("node:worker_threads");
const error = new APICallError({
  message: "provider said ${MARK}-message",
  url: "https://provider.test/v1?k=${MARK}-url",
  requestBodyValues: { messages: [{ role: "user", content: "${MARK}-prompt" }] },
  statusCode: 400,
  responseHeaders: { "x-echo": "${MARK}-header" },
  responseBody: JSON.stringify({ error: { type: "invalid_request_error", message: "${MARK}-reply" } }),
  isRetryable: false,
  data: { error: { type: "invalid_request_error", message: "${MARK}-reply" } },
});
${how === "throw" ? "setTimeout(() => { throw error; }, 10);" : ""}
${how === "reject" ? "Promise.reject(error);" : ""}
${how === "message" ? 'parentPort.postMessage({ kind: "failed", error });' : ""}
`;

function fromThread(how: "throw" | "reject" | "message"): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(thread(how), { eval: true });
    worker.once("error", resolve);
    worker.once("message", (message: { error: unknown }) => {
      resolve(message.error);
      void worker.terminate();
    });
    worker.once("exit", () => reject(new Error("thread ended without an error")));
  });
}

function captured(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => formatWithOptions({ colors: false }, ...args)).join("\n");
}

describe("a provider error that crossed a worker thread", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["throw", "reject", "message"] as const)(
    "is logged by the supervisor without prompt, reply, header or URL (%s)",
    async (how) => {
      const copy = await fromThread(how);
      // What the structured clone really did: the marker is gone.
      expect((copy as Record<symbol, unknown>)[Symbol.for("vercel.ai.error")]).toBeUndefined();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      console.error("[worker-thread:jobs] error", copy);
      const out = captured(spy);
      expect(out).not.toContain(MARK);
      expect(out).toContain("AI_APICallError");
      if (how !== "message") expect(out).toContain("400");
      // The reply's error type survives where the thread kept the fields.
      if (how !== "message") expect(out).toContain("invalid_request_error");
    },
  );

  it("leaves an ordinary error from a thread, or one that only mentions an SDK name, as it was", async () => {
    const ordinary = Object.assign(new Error("queue row 42 missing"), { jobId: "j1" });
    const lookalike = new Error("AI_APICallError: copied text");
    for (const error of [ordinary, lookalike]) {
      expect(redactedProviderError(error)).toBeUndefined();
      expect(formatWithOptions({ colors: false }, error)).toContain(error.message);
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    console.error("x", ordinary);
    expect(captured(spy)).toContain("jobId: 'j1'");
  });

  it("is named and given its safe tags by the helper, and its job text is redacted", async () => {
    const copy = await fromThread("throw");
    expect(redactedProviderError(copy)).toMatch(/^AI provider error AI_APICallError /);
    expect(jobErrorMessage(copy)).not.toContain(MARK);
  });
});
