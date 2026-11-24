import { createRequire } from "node:module";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    isRepairRefusal,
    RepairBudget,
    RepairDeadlineError,
    repairContextInputForTests,
    repairJson,
    setRepairObserverForTests,
} from "../boundedJsonRepair";
import { BoundedTextError } from "../modelJsonFence";

afterEach(() => setRepairObserverForTests(null));

const direct = createRequire(join(__dirname, "boundedJsonRepair.test.ts"))("jsonrepair") as { jsonrepair: (text: string) => string };
const LIMITS = { maxChars: 200_000, maxMs: 300 };
/** A closed text of quotes: the library takes seconds on it, however short it looks. */
const closed = (quote: string, length: number, open = "{", close = "}") => open + (quote + "a").repeat((length - 2) / 2) + close;

describe("a repair runs under a deadline", () => {
    it.each([
        ["ASCII apostrophe", "'"],
        ["curly quote", "\u2018"],
        ["backtick", "`"],
    ])("refuses a closed text of %s within three times its time", (_name, quote) => {
        for (const length of [8_002, 20_002]) {
            for (const [open, close] of [["{", "}"], ["[", "]"]]) {
                const started = performance.now();
                expect(() => repairJson(closed(quote, length, open, close), LIMITS)).toThrow(RepairDeadlineError);
                expect(performance.now() - started).toBeLessThan(3 * LIMITS.maxMs);
            }
        }
    }, 30_000);

    it("says the length of the text and the milliseconds it was allowed", () => {
        try {
            repairJson(closed("'", 8_002), { maxChars: 200_000, maxMs: 120 });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(RepairDeadlineError);
            expect((error as RepairDeadlineError).length).toBe(8_002);
            expect((error as RepairDeadlineError).allowedMs).toBe(120);
            expect(isRepairRefusal(error)).toBe(true);
        }
    });

    it("hands the library the whole of the text, and returns what it returns", () => {
        const text = '{"a":"' + 'x \\"q\\" y '.repeat(15_000) + '",}';
        expect(repairJson(text, LIMITS)).toBe(direct.jsonrepair(text));
    });

    it("repairs an honest text after a refusal, with the library's own output", () => {
        expect(() => repairJson(closed("'", 8_002), LIMITS)).toThrow(RepairDeadlineError);
        for (const text of ["{'a':'b'}", "{'a':'b", '{"a":[1,2,],}']) expect(repairJson(text, LIMITS)).toBe(direct.jsonrepair(text));
    });

    it("keeps no text in the context, after a repair, a refusal or a library error", () => {
        expect(repairContextInputForTests()).toBe("");
        repairJson("{'a':'b'}", LIMITS);
        expect(repairContextInputForTests()).toBe("");
        expect(() => repairJson(closed("'", 8_002), LIMITS)).toThrow(RepairDeadlineError);
        expect(repairContextInputForTests()).toBe("");
        expect(() => repairJson("{ nothing sensible ] here", LIMITS)).toThrow();
        expect(repairContextInputForTests()).toBe("");
    });
});

describe("a refused repair says what was refused", () => {
    it("reports a text over the limit of one text with that text's own sizes", () => {
        const failures: BoundedTextError[] = [];
        for (const length of [30_000, 60_000]) {
            try {
                repairJson("{" + "'a".repeat(length / 2), { maxChars: 20_000, maxMs: 300 });
            } catch (error) {
                failures.push(error as BoundedTextError);
            }
        }
        expect(failures).toHaveLength(2);
        for (const failure of failures) expect(failure).toBeInstanceOf(BoundedTextError);
        expect(failures[0].length).toBe(30_001);
        expect(failures[1].length).toBe(60_001);
    });

    it("refuses a text over its size limit before the library is called", () => {
        let calls = 0;
        setRepairObserverForTests(() => calls++);
        expect(() => repairJson("[".repeat(101), { maxChars: 100, maxMs: 300 })).toThrow(BoundedTextError);
        expect(calls).toBe(0);
    });

    it("tells a refusal from text the library cannot read", () => {
        let unreadable: unknown;
        try {
            repairJson("{ nothing sensible ] here", LIMITS);
        } catch (error) {
            unreadable = error;
        }
        expect(unreadable).toBeInstanceOf(Error);
        expect(isRepairRefusal(unreadable)).toBe(false);
        expect(unreadable).not.toBeInstanceOf(RepairDeadlineError);
        expect(isRepairRefusal(new BoundedTextError(1, 2))).toBe(true);
        expect(isRepairRefusal(new Error("text over the limit"))).toBe(false);
    });
});

describe("the repairs of one reading share one time budget", () => {
    it("gives a repair what is left, whole milliseconds, and takes its wall time", () => {
        const budget = new RepairBudget(1_000);
        const given: number[] = [];
        setRepairObserverForTests((_chars, ms) => given.push(ms));
        repairJson("{'a':'b'}", LIMITS, budget);
        expect(given).toEqual([1_000]);
        expect(budget.remaining).toBeLessThan(1_000);
        expect(budget.remaining).toBeGreaterThan(0);
        const left = budget.remaining;
        repairJson("{'a':'b'}", LIMITS, budget);
        expect(given[1]).toBe(Math.floor(left));
        expect(budget.remaining).toBeLessThan(left);
    });

    it("takes the time of a refusal and of a library error from the budget as well", () => {
        const budget = new RepairBudget(400);
        expect(() => repairJson(closed("'", 8_002), LIMITS, budget)).toThrow(RepairDeadlineError);
        expect(budget.remaining).toBeLessThan(150);
        const other = new RepairBudget(1_000);
        expect(() => repairJson("{ nothing sensible ] here", LIMITS, other)).toThrow();
        expect(other.remaining).toBeLessThan(1_000);
    }, 30_000);

    it("refuses before the library when less than a millisecond is left", () => {
        let calls = 0;
        setRepairObserverForTests(() => calls++);
        const budget = new RepairBudget(0.9);
        expect(() => repairJson("{'a':'b'}", LIMITS, budget)).toThrow(RepairDeadlineError);
        expect(calls).toBe(0);
    });

    it("stops many costly texts at the budget, not at the budget of each", () => {
        const budget = new RepairBudget(500);
        const started = performance.now();
        let refused = 0;
        for (let i = 0; i < 40; i++) {
            try {
                repairJson(closed("'", 2_002), LIMITS, budget);
            } catch (error) {
                if (error instanceof RepairDeadlineError) refused++;
            }
        }
        expect(refused).toBeGreaterThan(0);
        expect(performance.now() - started).toBeLessThan(3 * 500);
    }, 30_000);

    it("lets 20,000 tiny repairs all be repaired or refused, within three times the budget", () => {
        const budget = new RepairBudget(1_000);
        const started = performance.now();
        let done = 0;
        let refused = 0;
        for (let i = 0; i < 20_000; i++) {
            try {
                expect(repairJson("{'a':1}", LIMITS, budget)).toBe('{"a":1}');
                done++;
            } catch (error) {
                if (!(error instanceof RepairDeadlineError)) throw error;
                refused++;
            }
        }
        expect(done + refused).toBe(20_000);
        expect(performance.now() - started).toBeLessThan(3_000);
    }, 30_000);
});
