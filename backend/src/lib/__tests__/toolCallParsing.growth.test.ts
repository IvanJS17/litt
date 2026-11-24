import { describe, expect, it } from "vitest";

import { families, growth, pairs, TEXT_READERS, ENTRY_POINTS, WRAPPERS, MARKER_NAMES } from "./toolCallGrowth";

// The reader of tool calls written as text takes the whole reply of a model that does not report
// them itself. This is the guard for the whole module: a table of generators of adversarial text
// (toolCallGrowth.ts), every entry point that receives model text, and a growth check. Each text is
// built at N, 2N, 4N and 8N characters and the best of three runs of each size must not grow faster
// than the text does (8 times the text may take at most 20 times as long; a quadratic reader takes 64).

describe("the reader of tool calls written as text grows with the text", () => {
    it("lists the markers it is built for", () => {
        expect(MARKER_NAMES.length).toBeGreaterThanOrEqual(40);
        expect(families.length).toBeGreaterThan(300);
    });

    describe.each(WRAPPERS)("%s", (_wrapper, wrap) => {
        const own = _wrapper === "plain" ? ENTRY_POINTS : TEXT_READERS;
        it.each(families.map((f) => [f.name, f] as const))("%s", (_name, family) => {
            const n = 8192;
            expect(growth(own, (size) => wrap(family.text(size), size), n)).toBe("");
        }, 120_000);
    });

    it("reads a reply with a megabyte of prose in front of the markup in the time of its size", () => {
        const prose = "A plain sentence of the answer, without any markup. ".repeat(Math.ceil(1_048_576 / 52));
        for (const family of families.filter((f) => /^probe:/.test(f.name))) {
            const text = prose + family.text(8192);
            const started = performance.now();
            for (const [, run] of TEXT_READERS) {
                try {
                    run(text);
                } catch {
                    // refused text
                }
            }
            expect(performance.now() - started, family.name).toBeLessThan(10_000);
        }
    }, 600_000);

    it("every pair of markers, alternated, grows with the text for the two readers of calls", () => {
        const failures: string[] = [];
        for (const pair of pairs) {
            const result = growth(TEXT_READERS.slice(0, 2), pair.text, 2048);
            if (result) failures.push(`${pair.name}: ${result}`);
        }
        expect(failures).toEqual([]);
    }, 600_000);
});
