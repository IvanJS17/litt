import { randomUUID } from "node:crypto";
import type { Db } from "../../lib/supabase";

/**
 * A tiny in-memory PostgREST stand-in: rows per table, with the filters and
 * writes the training module uses (eq, is, in, gt, order, limit, insert,
 * update, delete, select-after-write, maybeSingle). `gt` and `order` let
 * keyset-paged reads (lib/batchedQuery.ts) run against it. Enough to assert what a service
 * leaves in its tables; it fills a missing `id` but enforces no constraints, so a suite
 * that needs a database error scripts it through `failNext`.
 */
export type Row = Record<string, unknown>;

export function memoryDb(tables: Record<string, Row[]>) {
    const failures: { table: string; op: string; error: unknown }[] = [];
    const from = (table: string) => {
        const rows = (tables[table] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: "select" | "insert" | "update" | "delete" = "select";
        let payload: Row | Row[] | undefined;
        let limit = Infinity;
        const orders: [string, boolean][] = [];
        let columns: string[] | null = null;
        // Copies, projected to the selected columns, as PostgREST returns them.
        const project = (row: Row): Row =>
            columns ? Object.fromEntries(columns.map((c) => [c, row[c] ?? null])) : { ...row };
        const run = () => {
            const failure = failures.findIndex((f) => f.table === table && f.op === op);
            if (failure >= 0) {
                const [{ error }] = failures.splice(failure, 1);
                return { data: null, error };
            }
            const matches = rows.filter((row) => filters.every((f) => f(row)));
            if (op === "insert") {
                const inserted = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
                    id: randomUUID(),
                    ...r,
                }));
                rows.push(...inserted);
                return { data: inserted.map(project), error: null };
            }
            if (op === "update") {
                for (const row of matches) Object.assign(row, payload);
                return { data: matches.map(project), error: null };
            }
            if (op === "delete") {
                for (const row of matches) rows.splice(rows.indexOf(row), 1);
                return { data: matches.map(project), error: null };
            }
            const sorted = orders.length
                ? [...matches].sort((a, b) => {
                      for (const [column, ascending] of orders) {
                          const x = String(a[column] ?? ""), y = String(b[column] ?? "");
                          if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
                      }
                      return 0;
                  })
                : matches;
            return { data: sorted.slice(0, limit).map(project), error: null };
        };
        const builder: Record<string, unknown> = {
            select: (list?: string) => {
                columns =
                    list && list !== "*"
                        ? list.split(",").map((c) => c.trim()).filter((c) => /^\w+$/.test(c))
                        : null;
                return builder;
            },
            eq: (column: string, value: unknown) => {
                filters.push((row) => row[column] === value);
                return builder;
            },
            is: (column: string, value: unknown) => {
                filters.push((row) => (row[column] ?? null) === value);
                return builder;
            },
            in: (column: string, values: unknown[]) => {
                filters.push((row) => values.includes(row[column]));
                return builder;
            },
            gt: (column: string, value: unknown) => {
                filters.push((row) => String(row[column] ?? "") > String(value));
                return builder;
            },
            order: (column: string, options?: { ascending?: boolean }) => {
                orders.push([column, options?.ascending !== false]);
                return builder;
            },
            limit: (n: number) => {
                limit = n;
                return builder;
            },
            insert: (value: Row | Row[]) => {
                op = "insert";
                payload = value;
                return builder;
            },
            update: (value: Row) => {
                op = "update";
                payload = value;
                return builder;
            },
            delete: () => {
                op = "delete";
                return builder;
            },
            maybeSingle: () => {
                const result = run();
                if (result.error) return Promise.resolve(result);
                const data = result.data as Row[];
                return Promise.resolve({ data: data[0] ?? null, error: null });
            },
            single: () => {
                const result = run();
                if (result.error) return Promise.resolve(result);
                const data = result.data as Row[];
                return Promise.resolve(
                    data[0]
                        ? { data: data[0], error: null }
                        : { data: null, error: { message: "no rows" } },
                );
            },
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                Promise.resolve(run()).then(resolve, reject),
        };
        return builder;
    };
    return {
        db: { from } as unknown as Db,
        tables,
        failNext(table: string, op: string, error: unknown) {
            failures.push({ table, op, error });
        },
    };
}
