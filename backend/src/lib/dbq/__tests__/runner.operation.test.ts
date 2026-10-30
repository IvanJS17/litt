import { afterEach, expect, it, vi } from "vitest";
import type { DbJob } from "../types";
import { setOperation, withDiagnosticScope } from "../../observability/report";
import { processClaimedJob } from "../runner";

afterEach(() => { vi.restoreAllMocks(); });

it.each(["future.kind", "storage.cleanup"])("isolates an unknown %s job's dispatch operation", async (kind) => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  const updates: Array<Record<string, unknown>> = [];
  const query = { eq: () => query, then: (done: (result: unknown) => unknown) => Promise.resolve({ error: null }).then(done) };
  const db = { from: () => ({ update: (payload: Record<string, unknown>) => { updates.push(payload); return query; } }) };
  const job = { id: "job-1", kind, attempts: 1, max_attempts: 3, claimed_at: "2026-10-26T00:00:00Z" } as DbJob;
  await withDiagnosticScope(async () => {
    setOperation("chat.turn");
    await processClaimedJob(db as never, {}, job);
    const reports = [...errors.mock.calls, ...warnings.mock.calls].filter(call => call[0] === "[report]").map(call => JSON.parse(String(call[1])));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ operation: "jobs.dispatch" });
  });
  expect(updates[0]?.status).toBe(kind === "storage.cleanup" ? "pending" : "failed");
});
