import { expect } from "vitest";
import type { Db } from "../../lib/supabase";

export type Query = {
  table: string;
  op: string;
  payload?: unknown;
  /** RPC arguments, for `op: "rpc"` calls (table is the function name). */
  args?: unknown;
  filters: Array<[string, ...unknown[]]>;
};
type Step =
  | {
      table: string;
      op?: string;
      data?: unknown;
      error?: unknown;
    }
  | {
      /** A `db.rpc(name, args)` call; the function name stands in for the table. */
      rpc: string;
      data?: unknown;
      error?: unknown;
    };

/** Strict query script: an unexpected query or changed mutation order fails.
 * Filters are recorded separately so tests can assert scope and ownership.
 */
export function scriptedDb(steps: Step[], accountEmail = "a@example.test") {
  const calls: Query[] = [];
  let cursor = 0;
  const from = (table: string) => {
    const call: Query = { table, op: "select", filters: [] };
    const settle = () => {
      calls.push(call);
      const step = steps[cursor++];
      expect(step, `Unexpected ${call.op} on ${table}`).toBeDefined();
      expect({ table, op: call.op }).toEqual(
        "rpc" in step
          ? { table: step.rpc, op: "rpc" }
          : { table: step.table, op: step.op ?? "select" },
      );
      return Promise.resolve({
        data: step.data ?? null,
        error: step.error ?? null,
      });
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      single: settle,
      maybeSingle: settle,
      then: (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => settle().then(resolve, reject),
    };
    for (const op of ["update", "insert", "delete", "upsert"]) {
      builder[op] = (payload?: unknown) => {
        call.op = op;
        call.payload = payload;
        return builder;
      };
    }
    for (const filter of ["eq", "is", "in", "or", "order", "range", "limit", "gt"]) {
      builder[filter] = (...args: unknown[]) => {
        call.filters.push([filter, ...args]);
        return builder;
      };
    }
    return builder;
  };
  const rpc = (name: string, args?: unknown) => {
    const call: Query = { table: name, op: "rpc", args, filters: [] };
    calls.push(call);
    const step = steps[cursor++];
    expect(step, `Unexpected rpc ${name}`).toBeDefined();
    expect(
      "rpc" in step ? { rpc: step.rpc } : { table: step.table, op: step.op },
    ).toEqual({ rpc: name });
    return Promise.resolve({
      data: step.data ?? null,
      error: step.error ?? null,
    });
  };
  return {
    // The account's confirmed address, for jobs that read it when they run.
    db: {
      from,
      rpc,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: accountEmail, email_confirmed_at: "2026-01-01T00:00:00Z" } },
            error: null,
          }),
        },
      },
    } as unknown as Db,
    calls,
    done: () =>
      expect(cursor, "Not all expected queries ran").toBe(steps.length),
  };
}
