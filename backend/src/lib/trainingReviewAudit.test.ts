import { describe, expect, it } from "vitest";
import {
    allMarked,
    cellDigest,
    drawSample,
    isAuditMark,
    lintColumns,
    sampleSize,
    seededRandom,
    tallyByColumn,
    type AuditItem,
} from "./trainingReviewAudit";

const good = { prompt: "Summarize the termination clause in detail", format: "text" };

describe("lintColumns", () => {
    it("says nothing about well-formed questions", () => {
        expect(
            lintColumns([
                { index: 0, name: "Termination", ...good },
                { index: 1, name: "Governing law", ...good },
            ]),
        ).toEqual([]);
    });

    const cases: [string, Parameters<typeof lintColumns>[0], unknown][] = [
        ["empty name", [{ index: 0, name: "  ", ...good }], [{ code: "empty_name", column_index: 0 }]],
        ["non-text name", [{ index: 3, name: 7, ...good }], [{ code: "empty_name", column_index: 3 }]],
        [
            "repeated name ignoring case, accents kept and spacing",
            [
                { index: 0, name: "Law", ...good },
                { index: 1, name: "  law ", ...good },
                { index: 2, name: "Lá w", ...good },
            ],
            [{ code: "duplicate_name", column_index: 1, other_index: 0 }],
        ],
        ["empty instruction", [{ index: 0, name: "A", prompt: "   ", format: "text" }], [{ code: "empty_instruction", column_index: 0 }]],
        ["missing instruction", [{ index: 0, name: "A", format: "text" }], [{ code: "empty_instruction", column_index: 0 }]],
        ["short instruction", [{ index: 0, name: "A", prompt: "Termination?", format: "text" }], [{ code: "short_instruction", column_index: 0 }]],
        [
            "exactly 20 characters is enough",
            [{ index: 0, name: "A", prompt: "x".repeat(20), format: "text" }],
            [],
        ],
        ["no format", [{ index: 0, name: "A", prompt: good.prompt }], [{ code: "no_format", column_index: 0 }]],
        ["blank format", [{ index: 0, name: "A", prompt: good.prompt, format: " " }], [{ code: "no_format", column_index: 0 }]],
    ];
    it.each(cases)("%s", (_name, columns, expected) => {
        expect(lintColumns(columns)).toEqual(expected);
    });

    it("lists every warning of a column, in column order", () => {
        expect(lintColumns([{ index: 4, name: "", prompt: "" }])).toEqual([
            { code: "empty_name", column_index: 4 },
            { code: "empty_instruction", column_index: 4 },
            { code: "no_format", column_index: 4 },
        ]);
    });
});

describe("sampleSize", () => {
    it.each([
        [0, 0],
        [-3, 0],
        [Number.NaN, 0],
        [1, 1],
        [3, 3],
        [5, 5],
        [30, 5],
        [50, 5],
        [51, 6],
        [100, 10],
        [199, 20],
        [200, 20],
        [10_000, 20],
    ])("%i done cells -> %i", (done, expected) => {
        expect(sampleSize(done)).toBe(expected);
    });
});

const grid = (rows: number, columns: number) =>
    Array.from({ length: rows * columns }, (_, i) => ({
        row_id: `row-${String(Math.floor(i / columns)).padStart(3, "0")}`,
        column_index: i % columns,
    }));

describe("drawSample", () => {
    it("is reproducible from the seed, whatever the input order", () => {
        const cells = grid(40, 4);
        const a = drawSample(cells, 8, "seed-1");
        const b = drawSample([...cells].reverse(), 8, "seed-1");
        expect(b).toEqual(a);
        expect(drawSample(cells, 8, "seed-2")).not.toEqual(a);
    });

    it("pins a fixed sample for a fixed seed", () => {
        const picked = drawSample(grid(10, 3), 6, "fixed-seed").map((c) => `${c.row_id}:${c.column_index}`);
        expect(picked).toHaveLength(6);
        expect(new Set(picked).size).toBe(6);
        expect(picked).toEqual(drawSample(grid(10, 3), 6, "fixed-seed").map((c) => `${c.row_id}:${c.column_index}`));
    });

    it("takes at least one cell from every column while the size allows", () => {
        const cells = grid(30, 5);
        for (const seed of ["a", "b", "c", "d"]) {
            const columns = new Set(drawSample(cells, 5, seed).map((c) => c.column_index));
            expect(columns.size).toBe(5);
        }
    });

    it("spreads the rest evenly and never repeats a cell", () => {
        const picked = drawSample(grid(30, 4), 10, "even");
        const counts = [0, 1, 2, 3].map((c) => picked.filter((p) => p.column_index === c).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        expect(new Set(picked.map((p) => `${p.row_id}:${p.column_index}`)).size).toBe(10);
    });

    it("picks a subset of columns when there are more columns than cells to draw", () => {
        const picked = drawSample(grid(5, 8), 5, "wide");
        expect(new Set(picked.map((c) => c.column_index)).size).toBe(5);
    });

    it("moves on to the other columns when one runs out", () => {
        const cells = [...grid(1, 1), ...grid(6, 1).map((c) => ({ ...c, column_index: 1 }))];
        const picked = drawSample(cells, 5, "uneven");
        expect(picked).toHaveLength(5);
        expect(picked.some((c) => c.column_index === 0)).toBe(true);
    });

    it("never returns more than exist, and nothing for a size of zero", () => {
        expect(drawSample(grid(1, 2), 9, "x")).toHaveLength(2);
        expect(drawSample(grid(3, 3), 0, "x")).toEqual([]);
        expect(drawSample([], 5, "x")).toEqual([]);
        expect(drawSample(grid(3, 3), -2, "x")).toEqual([]);
    });
});

describe("seededRandom", () => {
    it("repeats for a seed and stays in [0, 1)", () => {
        const a = seededRandom("s");
        const b = seededRandom("s");
        const seen = Array.from({ length: 200 }, () => a());
        expect(seen).toEqual(Array.from({ length: 200 }, () => b()));
        expect(seen.every((n) => n >= 0 && n < 1)).toBe(true);
        expect(new Set(seen).size).toBeGreaterThan(190);
    });
});

describe("cellDigest", () => {
    it("tells a changed cell apart and holds no content", () => {
        const a = cellDigest('{"summary":"Yes"}', null);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
        expect(cellDigest('{"summary":"Yes"}', null)).toBe(a);
        expect(cellDigest('{"summary":"No"}', null)).not.toBe(a);
        expect(cellDigest('{"summary":"Yes"}', [{ page: 1 }])).not.toBe(a);
        expect(cellDigest({ summary: "Yes" }, undefined)).toBe(cellDigest({ summary: "Yes" }, null));
        expect(cellDigest(null, null)).toMatch(/^[0-9a-f]{16}$/);
    });
});

describe("marks", () => {
    it("recognizes only the three marks", () => {
        expect(["correct", "incomplete", "incorrect"].every(isAuditMark)).toBe(true);
        expect([isAuditMark("wrong"), isAuditMark(null), isAuditMark(1)]).toEqual([false, false, false]);
    });

    const item = (column_index: number, mark?: AuditItem["mark"]): AuditItem => ({
        row_id: "r",
        column_index,
        digest: "d",
        ...(mark ? { mark } : {}),
    });

    it("counts the person's own marks by column", () => {
        expect(
            tallyByColumn([
                item(2, "incorrect"),
                item(0, "correct"),
                item(2, "incomplete"),
                item(2),
                { ...item(0, "incorrect"), mentor_mark: "correct" },
            ]),
        ).toEqual([
            { column_index: 0, marked: 2, incorrect: 1, incomplete: 0 },
            { column_index: 2, marked: 2, incorrect: 1, incomplete: 1 },
        ]);
    });

    it("is complete only when every sampled cell has a mark", () => {
        expect(allMarked([])).toBe(false);
        expect(allMarked([item(0, "correct"), item(1)])).toBe(false);
        expect(allMarked([item(0, "correct"), item(1, "incorrect")])).toBe(true);
    });
});
