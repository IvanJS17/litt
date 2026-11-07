import { ownerlessRpcResult } from "../../../__tests__/helpers/ownerlessRpc";

export type Row = Record<string, unknown>;

// Read-only fake supporting the query subset buildUserAccountExport uses
// (select/range/eq/neq/gt/in/order/filter + thenable).
export function makeExportDb(
    tables: Record<string, Row[]>,
    errors: Record<string, { message: string }> = {},
) {
    const reads: string[] = [];
    function query(table: string) {
        let rows = [...(tables[table] ?? [])];
        let from = 0;
        let to = Infinity;
        const orders: [string, boolean][] = [];
        const sorted = () =>
            orders.length === 0
                ? rows
                : [...rows].sort((a, b) => {
                      for (const [col, asc] of orders) {
                          const x = String(a[col] ?? "");
                          const y = String(b[col] ?? "");
                          if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
                      }
                      return 0;
                  });
        const error = errors[table] ?? null;
        const builder: any = {
            select: () => builder,
            range: (start: number, end: number) => {
                from = start;
                to = end;
                return builder;
            },
            // Applied when the query resolves, first call first (PostgREST
            // order), so a keyset page's `.gt` cursor is the real maximum.
            order: (col: string, options?: { ascending?: boolean }) => {
                orders.push([col, options?.ascending !== false]);
                return builder;
            },
            limit: () => builder,
            // Keyset pages (selectAllByKey): rows past the cursor.
            gt: (col: string, val: unknown) => {
                rows = rows.filter((r) => String(r[col]) > String(val));
                return builder;
            },
            eq: (col: string, val: unknown) => {
                rows = rows.filter((r) => r[col] === val);
                return builder;
            },
            neq: (col: string, val: unknown) => {
                rows = rows.filter((r) => r[col] !== val);
                return builder;
            },
            is: (col: string, val: unknown) => {
                rows = rows.filter((r) => (r[col] ?? null) === val);
                return builder;
            },
            not: (col: string, op: string, val: unknown) => {
                if (op === "is" && val === null)
                    rows = rows.filter((r) => (r[col] ?? null) !== null);
                return builder;
            },
            in: (col: string, vals: unknown[]) => {
                rows = rows.filter((r) => vals.includes(r[col]));
                return builder;
            },
            filter: (col: string, op: string, value: string) => {
                reads.push(`${table}.${col}:${op}`);
                if (op !== "cs") return builder;
                const expected = JSON.parse(value) as string[];
                rows = rows.filter((r) => {
                    const actual = r[col];
                    return (
                        Array.isArray(actual) &&
                        expected.every((item) => actual.includes(item))
                    );
                });
                return builder;
            },
            maybeSingle: async () => ({ data: error ? null : rows[0] ?? null, error }),
            single: async () => ({ data: error ? null : rows[0] ?? null, error }),
            // Every read answers its own exact count: the review-chat
            // transcript read pages until it sees a short page and refuses to
            // decide on a subset it cannot prove complete.
            then: (
                resolve: (v: {
                    data: Row[] | null;
                    error: { message: string } | null;
                    count: number | null;
                }) => unknown,
                reject?: (e: unknown) => unknown,
            ) =>
                Promise.resolve({
                    data: error ? null : sorted().slice(from, to + 1),
                    error,
                    count: rows.length,
                }).then(resolve, reject),
        };
        return builder;
    }
    return {
        db: {
            from: (t: string) => query(t),
            // LiTT C2 access functions, answered from the same tables.
            rpc: async (name: string, args?: Record<string, unknown>) =>
                ownerlessRpcResult(tables, name, args) ?? {
                    data: null,
                    error: { message: `unexpected rpc ${name}` },
                },
        } as any,
        reads,
    };
}
