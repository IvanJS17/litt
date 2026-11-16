import { describe, expect, it } from "vitest";
import { citationCheckStats } from "./platform.stats";

// A PostgREST-like builder over fixed rows: gte on the filter, keyset on id.
function dbOf(rows: Record<string, unknown>[]) {
    return {
        from: (table: string) => {
            expect(table).toBe("citation_support_checks");
            let since = "";
            let after: unknown = null;
            let size = 1000;
            const builder = {
                select: (columns: string) => {
                    // Counts only: the columns asked for hold no text.
                    expect(columns).toBe("id,created_at,band");
                    return builder;
                },
                gte: (_column: string, value: string) => ((since = value), builder),
                order: () => builder,
                limit: (n: number) => ((size = n), builder),
                gt: (_column: string, value: unknown) => ((after = value), builder),
                then: (resolve: (value: unknown) => unknown) =>
                    Promise.resolve({
                        data: rows
                            .filter((r) => (r.created_at as string) >= since && (after === null || (r.id as string) > (after as string)))
                            .sort((a, b) => (a.id as string).localeCompare(b.id as string))
                            .slice(0, size),
                        error: null,
                    }).then(resolve),
            };
            return builder;
        },
    } as never;
}

describe("citationCheckStats", () => {
    it("counts results by band and UTC day, newest day first, and nothing else", async () => {
        const rows = [
            { id: "1", created_at: "2026-11-14T10:00:00Z", band: "supported" },
            { id: "2", created_at: "2026-11-14T23:59:00Z", band: "review" },
            { id: "3", created_at: "2026-11-14T01:00:00Z", band: "supported" },
            { id: "4", created_at: "2026-11-13T12:00:00Z", band: "not_supported" },
            { id: "5", created_at: "2026-10-01T12:00:00Z", band: "supported" },
            { id: "6", created_at: "2026-11-13T12:00:00Z", band: "strange" },
        ];
        const stats = await citationCheckStats(dbOf(rows), "2026-10-16T00:00:00Z");
        expect(stats).toEqual({
            totals: { not_supported: 1, review: 1, supported: 2 },
            days: [
                { day: "2026-11-14", not_supported: 0, review: 1, supported: 2 },
                { day: "2026-11-13", not_supported: 1, review: 0, supported: 0 },
            ],
        });
        expect(JSON.stringify(stats)).not.toMatch(/quote|text|claim/);
    });

    it("is empty with no results", async () => {
        expect(await citationCheckStats(dbOf([]), "2026-10-16T00:00:00Z")).toEqual({
            totals: { not_supported: 0, review: 0, supported: 0 },
            days: [],
        });
    });
});
