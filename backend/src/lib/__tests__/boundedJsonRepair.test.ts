import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    isRepairRefusal,
    MAX_REPAIR_DEADLINE_MS,
    RepairBudget,
    RepairDeadlineError,
    repairContextInputForTests,
    repairJson,
    setRepairObserverForTests,
} from "../boundedJsonRepair";
import { parseToolScalar } from "../llm/toolCallParsing";
import { BoundedTextError } from "../modelJsonFence";

afterEach(() => {
    setRepairObserverForTests(null);
    vi.restoreAllMocks();
});

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

const BAD_DEADLINES = [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 32, 1e12];

describe("a deadline the engine would reject is a refusal or is made valid", () => {
    /** Ends as a repair or as a refusal; never as the engine's own range error. */
    function endsWell(read: () => string) {
        try {
            expect(read()).toBe('{"a":"b"}');
        } catch (error) {
            expect(error).not.toBeInstanceOf(RangeError);
            expect((error as { code?: unknown }).code).not.toBe("ERR_OUT_OF_RANGE");
            expect(error).toBeInstanceOf(RepairDeadlineError);
            expect(isRepairRefusal(error)).toBe(true);
        }
    }

    it.each(BAD_DEADLINES)("ends a repair with maxMs %s as a repair or a refusal", (maxMs) => {
        endsWell(() => repairJson("{'a':'b'}", { maxChars: 1_000, maxMs }));
    });

    it.each(BAD_DEADLINES)("ends a repair with %s left in the budget as a repair or a refusal", (left) => {
        const budget = new RepairBudget(1_000);
        budget.remaining = left;
        endsWell(() => repairJson("{'a':'b'}", LIMITS, budget));
    });

    it("refuses a deadline that is not a finite number of at least one millisecond, and floors the rest", () => {
        for (const maxMs of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => repairJson("{'a':'b'}", { maxChars: 1_000, maxMs })).toThrow(RepairDeadlineError);
        }
        const given: number[] = [];
        setRepairObserverForTests((_chars, ms) => given.push(ms));
        repairJson("{'a':'b'}", { maxChars: 1_000, maxMs: 7.9 });
        repairJson("{'a':'b'}", { maxChars: 1_000, maxMs: 2 ** 32 });
        repairJson("{'a':'b'}", { maxChars: 1_000, maxMs: 1e12 });
        expect(given).toEqual([7, MAX_REPAIR_DEADLINE_MS, MAX_REPAIR_DEADLINE_MS]);
        expect(MAX_REPAIR_DEADLINE_MS).toBeLessThanOrEqual(2 ** 32 - 1);
    });
});

describe("the deadline reaches the engine", () => {
    it("passes the whole-millisecond deadline as the timeout option, with a budget and without one", () => {
        const spy = vi.spyOn(vm.Script.prototype, "runInContext");
        repairJson("{'a':'b'}", { maxChars: 1_000, maxMs: 250.7 });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toEqual({ timeout: 250 });
        repairJson("{'a':'b'}", LIMITS, new RepairBudget(640.9));
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy.mock.calls[1][1]).toEqual({ timeout: 640 });
    });
});

describe("a stack overflow inside the library is a refusal", () => {
    const deep = '[{"a":'.repeat(33_000);

    it("is refused by repairJson, with the refusal that ends a reading", () => {
        let failure: unknown;
        try {
            repairJson(deep, LIMITS);
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect(isRepairRefusal(failure)).toBe(true);
        expect(repairJson("{'a':'b'}", LIMITS)).toBe('{"a":"b"}');
    });

    it("ends the reading of a tool scalar as a call that cannot be recovered", () => {
        expect(() => parseToolScalar(deep)).toThrow(/could not recover/);
    });
});
