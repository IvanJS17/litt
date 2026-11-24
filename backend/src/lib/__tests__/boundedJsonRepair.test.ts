import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    countRepairQuotes,
    isRepairRefusal,
    RepairBudget,
    RepairBudgetSpentError,
    repairJson,
    setRepairObserverForTests,
} from "../boundedJsonRepair";
import { BoundedTextError } from "../modelJsonFence";

afterEach(() => setRepairObserverForTests(null));

describe("the characters counted as quotes are the ones the installed repair library treats as quotes", () => {
    // The library exports its own classifier from a file of its build; it is read by path (the package
    // does not list it), so a new version that knows another quote makes this test fail.
    const load = createRequire(join(__dirname, "boundedJsonRepair.test.ts"));
    const library = load(join(dirname(load.resolve("jsonrepair")), "utils", "stringUtils.js")) as { isQuote: (character: string) => boolean };

    it("counts every UTF-16 code unit the library classifies as a quote", () => {
        const missed: string[] = [];
        for (let code = 0; code <= 0xffff; code++) {
            const character = String.fromCharCode(code);
            if (library.isQuote(character) && countRepairQuotes(character) !== 1) missed.push(code.toString(16));
        }
        expect(missed).toEqual([]);
    });

    it("finds quotes at all, and counts one for each", () => {
        const known = [34, 39, 0x2018, 0x2019, 0x201c, 0x201d, 0x60, 0xb4].map((code) => String.fromCharCode(code));
        expect(known.every((character) => library.isQuote(character))).toBe(true);
        expect(countRepairQuotes(known.join("") + "abc" + known.join(""))).toBe(16);
        expect(countRepairQuotes("no quotes here {}[]:,")).toBe(0);
    });
});

describe("a refused repair says what was refused", () => {
    const quoted = (length: number) => "{" + "'a".repeat(length / 2);

    it("reports a text over the limit of one text with that text's own sizes", () => {
        const failures: BoundedTextError[] = [];
        for (const length of [30_000, 60_000]) {
            try {
                repairJson(quoted(length), { maxChars: 200_000 });
            } catch (error) {
                failures.push(error as BoundedTextError);
            }
        }
        expect(failures).toHaveLength(2);
        for (const failure of failures) expect(failure).toBeInstanceOf(BoundedTextError);
        expect(failures[0].length).toBe(30_001);
        expect(failures[1].length).toBe(60_001);
        expect(failures[0]).not.toBe(failures[1]);
    });

    it("reports a text over its caller's size limit, before reading it", () => {
        expect(() => repairJson("[".repeat(101), { maxChars: 100 })).toThrow(BoundedTextError);
    });

    it("reports a spent budget as such, and every refusal with its own sizes", () => {
        const budget = new RepairBudget(1_000_000, 10_000);
        const failures: RepairBudgetSpentError[] = [];
        expect(repairJson("{'a':'b", { maxChars: 200_000 }, budget)).toBe('{"a":"b"}');
        for (const length of [3_000, 4_000]) {
            try {
                repairJson(quoted(length), { maxChars: 200_000 }, budget);
            } catch (error) {
                failures.push(error as RepairBudgetSpentError);
            }
        }
        expect(failures).toHaveLength(2);
        for (const failure of failures) {
            expect(failure).toBeInstanceOf(RepairBudgetSpentError);
            expect(failure).not.toBeInstanceOf(BoundedTextError);
            expect(failure.message).toMatch(/budget/i);
            expect(failure.message).not.toMatch(/over the limit/);
        }
        expect(failures[0].length).toBe(3_001);
        expect(failures[1].length).toBe(4_001);
        expect(failures[0].message).not.toBe(failures[1].message);
        expect(failures[0]).not.toBe(failures[1]);
    });

    it("tells a refusal from text the library cannot read", () => {
        const budget = new RepairBudget(1, 1);
        let spent: unknown;
        let over: unknown;
        let unreadable: unknown;
        try {
            repairJson("{'a':'b", { maxChars: 200_000 }, budget);
        } catch (error) {
            spent = error;
        }
        try {
            repairJson("x".repeat(101), { maxChars: 100 });
        } catch (error) {
            over = error;
        }
        try {
            repairJson("{ nothing sensible ] here", { maxChars: 200_000 });
        } catch (error) {
            unreadable = error;
        }
        expect(isRepairRefusal(spent)).toBe(true);
        expect(isRepairRefusal(over)).toBe(true);
        expect(unreadable).toBeInstanceOf(Error);
        expect(isRepairRefusal(unreadable)).toBe(false);
        expect(isRepairRefusal(new Error("text over the limit"))).toBe(false);
    });

    it("charges the budget for the repairs it runs, and for no other", () => {
        const budget = new RepairBudget(100_000, 10_000);
        const seen: number[] = [];
        setRepairObserverForTests((_chars, work) => seen.push(work));
        for (let i = 0; i < 9; i++) repairJson("{'a':'b", { maxChars: 200_000 }, budget);
        expect(seen).toHaveLength(9);
        expect(() => repairJson("{'a':'b", { maxChars: 200_000 }, budget)).toThrow(RepairBudgetSpentError);
        expect(seen).toHaveLength(9);
    });
});
