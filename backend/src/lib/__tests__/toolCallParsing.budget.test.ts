import { afterEach, describe, expect, it } from "vitest";

import { MODEL_TEXT_MAX_CHARS } from "../modelJsonFence";
import {
    parseDsmlToolCalls,
    parseTextToolCalls,
    parseToolScalar,
    setRepairObserverForTests,
    TOOL_ARGUMENT_REPAIR_CALL_COST,
    TOOL_ARGUMENT_REPAIR_REPLY_BUDGET,
} from "../llm/toolCallParsing";

// A reply's repairs share one budget: the work the reader may spend repairing damaged arguments is
// counted per reading of a reply (one call of an entry point), not per text. The tests count the
// repairs and the work handed to them through the seam of the module; they do not time anything.
// An argument the bounds refuse (the limit of its own text or the budget of the reply) ends the reading
// with the error of a call that cannot be read: no call of that reply is handed on.

type Repairs = { calls: number; chars: number; work: number };
type Outcome<T> = { result: T | undefined; failure: unknown; repairs: Repairs };
function counting<T>(read: () => T): Outcome<T> {
    const repairs: Repairs = { calls: 0, chars: 0, work: 0 };
    setRepairObserverForTests((chars, work) => {
        repairs.calls += 1;
        repairs.chars += chars;
        repairs.work += work;
    });
    try {
        return { result: read(), failure: undefined, repairs };
    } catch (failure) {
        return { result: undefined, failure, repairs };
    } finally {
        setRepairObserverForTests(null);
    }
}
afterEach(() => setRepairObserverForTests(null));

const UNREADABLE = /could not recover/;
/** The reading ended with the error of a call that cannot be read, and handed on no call. */
function expectUnreadable(outcome: Outcome<unknown>) {
    expect(outcome.result).toBeUndefined();
    expect(outcome.failure).toBeInstanceOf(Error);
    expect((outcome.failure as Error).message).toMatch(UNREADABLE);
}

/** About `length` characters, `length / 2` of them quotes: the costliest text a repair is asked to take. */
const quoted = (length: number) => "{" + "'a".repeat(length / 2);
/** The most such a text may hold and still be repaired alone: under the limit of one text. */
const JUST_UNDER = 22_000;
/** Over the limit of one text: 30,000 characters, 15,000 of them quotes. */
const OVER_LIMIT = 30_000;
/** A text that costs a tenth of the budget to repair, so that a reply of them spends it. */
const AFFORDABLE = 4_400;
const fill = (piece: string, total: number) => piece.repeat(Math.floor(total / piece.length));
const CAP = MODEL_TEXT_MAX_CHARS - 1_000;
const SPENT = TOOL_ARGUMENT_REPAIR_REPLY_BUDGET;

const dsmlParameter = (i: number, value: string) => `<|DSML|parameter name=p${i}>${value}</|DSML|parameter>`;
const dsml = (parameters: string[]) => `<|DSML|invoke name=a>${parameters.join("")}</|DSML|invoke>`;
/** A DSML call holding as many parameters of `value` as the reply cap allows. */
function dsmlOfValues(value: string): string {
    const parameters: string[] = [];
    let length = 0;
    for (;;) {
        const parameter = dsmlParameter(parameters.length, value);
        if (length + parameter.length > CAP - 100) return dsml(parameters);
        parameters.push(parameter);
        length += parameter.length;
    }
}

describe("the budget and the cost of a repair are fixed by their values, not by each other", () => {
    it("keeps the constants that bound one reply", () => {
        expect(TOOL_ARGUMENT_REPAIR_REPLY_BUDGET).toBe(1_000_000_000);
        expect(TOOL_ARGUMENT_REPAIR_CALL_COST).toBeGreaterThanOrEqual(20_000);
    });

    it("bounds the number of repairs of a reply of many small texts", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsmlOfValues("{'a':'xxxxxxxxxx"), 0));
        // 1,000,000,000 units at 20,000 a repair: at most 50,000 (the reply cap allows about 20,000 texts this small).
        expect(outcome.repairs.calls).toBeLessThanOrEqual(50_000);
        expect(outcome.repairs.calls).toBeGreaterThan(5_000);
        expect(outcome.failure).toBeUndefined();
        expect(outcome.repairs.work + outcome.repairs.calls * TOOL_ARGUMENT_REPAIR_CALL_COST).toBeLessThanOrEqual(SPENT);
    });
});

describe("a reply's repairs share one budget", () => {
    it("ends the reading, with no call handed on, when DSML parameters spend the budget", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsmlOfValues(quoted(AFFORDABLE)), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
        expect(outcome.repairs.calls).toBeGreaterThan(0);
    });

    it("ends the reading when one text costs more than the budget has left", () => {
        // Each is under the limit of one text (2.4e8 units); the fifth is more than what the budget has left.
        const outcome = counting(() => parseDsmlToolCalls(dsml([0, 1, 2, 3, 4].map((i) => dsmlParameter(i, quoted(JUST_UNDER)))), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(4);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("ends the reading when a text is over the limit of one text, without a repair", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsml([dsmlParameter(0, quoted(OVER_LIMIT))]), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when the fields of a function call spend the budget", () => {
        const reply = `<tool_call><function=f>${fill(`<a>${quoted(AFFORDABLE)}</a>`, CAP)}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(reply, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
        expect(outcome.repairs.calls).toBeGreaterThan(0);
    });

    it("ends the reading when a field of a function call is over the limit of one text", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call><function=f><a>${quoted(OVER_LIMIT)}</a></function></tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when bodies spend the budget, however they would be read afterwards", () => {
        const body = `<tool_call>name: n arguments: ${quoted(AFFORDABLE)}</tool_call>`;
        expect(counting(() => parseTextToolCalls(body, 0)).repairs.calls).toBe(2);
        const outcome = counting(() => parseTextToolCalls(fill(body, CAP), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("ends the reading when a body's JSON is over the limit of one text, and does not read it loosely", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>{"name":"n","arguments":${quoted(OVER_LIMIT)}</tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when a loose body's arguments are over the limit of one text", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>name: n arguments: ${quoted(OVER_LIMIT)}</tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when the loose reading of a body whose JSON names no tool is over the limit of one text", () => {
        // The JSON path reads `{"x":1}` and finds no call; the arguments written after it are what the loose path repairs.
        const body = `<tool_call>{"x":1} name: n arguments: ${quoted(OVER_LIMIT)}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(body, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when the JSON of a body is over the limit of one text, though its arguments alone would be read", () => {
        const body = `<tool_call>{"name":"n","note":${JSON.stringify("x")},"pad":${quoted(OVER_LIMIT)},"arguments":{"q":1}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(body, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.calls).toBe(0);
    });

    it("ends the reading when bodies whose JSON names no tool spend the budget", () => {
        const body = `<tool_call>{"name":"n","arguments":${quoted(JUST_UNDER)}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(fill(body, CAP), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("ends the reading when texts with unescaped quotes in a string spend the budget", () => {
        const body = `<tool_call>{"name":"n","arguments":{"text":"he said ${'and "x" '.repeat(Math.floor(JUST_UNDER / 8))}"}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(fill(body, CAP), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("ends a scalar read on its own the same way", () => {
        expect(() => parseToolScalar(quoted(OVER_LIMIT))).toThrow(UNREADABLE);
    });

    it("gives every reading its own budget, and a text that is repaired alone is still repaired", () => {
        const reply = dsml([0, 1, 2, 3].map((i) => dsmlParameter(i, quoted(JUST_UNDER))));
        const first = counting(() => parseDsmlToolCalls(reply, 0));
        const second = counting(() => parseDsmlToolCalls(reply, 0));
        expect(first.failure).toBeUndefined();
        expect(second.repairs).toEqual(first.repairs);
        expect(counting(() => parseToolScalar("{'a':'b")).repairs.calls).toBe(1);
        expect(parseToolScalar("{'a':'b")).toEqual({ a: "b" });
    });

    it("repairs a single large argument that is cut off, as before", () => {
        const call = `<tool_call>{"name":"n","arguments":{"text":"${"x".repeat(199_000)}`;
        const { result, repairs } = counting(() => parseTextToolCalls(call, 0));
        expect((result![0].input as { text: string }).text).toHaveLength(199_000);
        expect(repairs.calls).toBeGreaterThan(0);
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
    });
});

describe("text that is not JSON is not a refusal", () => {
    it("keeps a DSML parameter that is not JSON as the string it is", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsml([dsmlParameter(0, "{ nothing sensible ] here")]), 0));
        expect(outcome.failure).toBeUndefined();
        expect(outcome.result![0].input.p0).toBe("{ nothing sensible ] here");
    });

    it("keeps a field of a function call that is not JSON as the string it is", () => {
        const outcome = counting(() => parseTextToolCalls("<tool_call><function=f><a>{ nothing sensible ] here</a></function></tool_call>", 0));
        expect(outcome.failure).toBeUndefined();
        expect(outcome.result![0].input.a).toBe("{ nothing sensible ] here");
    });

    it("keeps a long plain string value, however long, with no repair", () => {
        const long = "word ".repeat(60_000);
        const outcome = counting(() => parseDsmlToolCalls(dsml([dsmlParameter(0, long)]), 0));
        expect(outcome.failure).toBeUndefined();
        expect(outcome.result![0].input.p0).toBe(long.trim());
        expect(outcome.repairs.calls).toBe(0);
    });
});

// Honest replies: what a model really writes must be read in full.
const words = "The party shall indemnify the other party against all claims. ";
/** `length` characters of prose with `quotes` escaped double quotes. */
function document(length: number, quotes: number): string {
    const chars = words.repeat(Math.ceil(length / words.length)).slice(0, length).split("");
    const step = Math.floor(length / Math.max(quotes, 1));
    for (let i = 0; i < quotes; i++) chars[i * step] = '\\"';
    return chars.join("");
}

describe("an honest reply is read in full", () => {
    const DOCUMENT_CHARS = 150_000;
    const QUOTES = 600;
    // The text as read holds the document's characters: an escaped quote is one of them.
    const READ_CHARS = DOCUMENT_CHARS;

    it("reads three 150,000-character documents with 600 escaped quotes and a trailing comma, as tool_call bodies", () => {
        const body = (i: number) => `<tool_call>{"name":"write_doc","arguments":{"title":"t${i}","text":"${document(DOCUMENT_CHARS, QUOTES)}",}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls([0, 1, 2].map(body).join("\n"), 0));
        expect(outcome.failure).toBeUndefined();
        expect(outcome.result).toHaveLength(3);
        for (const [i, call] of outcome.result!.entries()) {
            expect(call.name).toBe("write_doc");
            expect(call.input.title).toBe(`t${i}`);
            expect(typeof call.input.text).toBe("string");
            expect((call.input.text as string).length).toBe(READ_CHARS);
        }
        // A body whose JSON holds the call is not read a second time.
        expect(outcome.repairs.calls).toBe(3);
        expect(outcome.repairs.work + outcome.repairs.calls * TOOL_ARGUMENT_REPAIR_CALL_COST).toBeLessThanOrEqual(SPENT);
    });

    it("reads the same three documents as DSML parameters", () => {
        const parameter = (i: number) => dsmlParameter(i, `{"title":"t${i}","text":"${document(DOCUMENT_CHARS, QUOTES)}",}`);
        const outcome = counting(() => parseTextToolCalls(dsml([0, 1, 2].map(parameter)), 0));
        expect(outcome.failure).toBeUndefined();
        for (const i of [0, 1, 2]) {
            const value = outcome.result![0].input[`p${i}`] as { title: string; text: string };
            expect(typeof value).toBe("object");
            expect(value.title).toBe(`t${i}`);
            expect(value.text.length).toBe(READ_CHARS);
        }
        expect(outcome.repairs.calls).toBe(3);
    });

    it("reads 30 calls, each with a 5,000-character damaged argument of 400 quotes", () => {
        const argument = (i: number) => `n${i} ${document(5_000, 400)}`.replace(/\\"/g, "'");
        const body = (i: number) => `<tool_call>{"name":"note","arguments":{'text':'${argument(i)}',}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(Array.from({ length: 30 }, (_, i) => body(i)).join("\n"), 0));
        expect(outcome.failure).toBeUndefined();
        expect(outcome.result).toHaveLength(30);
        for (const [i, call] of outcome.result!.entries()) {
            expect(call.name).toBe("note");
            expect(typeof call.input.text).toBe("string");
            expect((call.input.text as string).startsWith(`n${i} `)).toBe(true);
        }
        expect(outcome.repairs.calls).toBe(30);
        expect(outcome.repairs.work + outcome.repairs.calls * TOOL_ARGUMENT_REPAIR_CALL_COST).toBeLessThanOrEqual(SPENT);
    });
});

// Every character the repair library treats as a quote costs it what a plain quote does, so a text full of
// any of them is refused by size, as a text full of plain quotes is. The list of characters is checked
// against the installed library in boundedJsonRepair.test.ts.
const QUOTE_CHARACTERS: [string, string][] = [
    ["double quote", '"'],
    ["single quote", "'"],
    ["left single curly quote", "\u2018"],
    ["right single curly quote", "\u2019"],
    ["left double curly quote", "\u201c"],
    ["right double curly quote", "\u201d"],
    ["grave accent", "`"],
    ["acute accent", "\u00b4"],
];
const halfQuotes = (character: string, length: number) => "{" + (character + "a").repeat(length / 2);

describe("a text full of any quote the repair library knows is refused by size", () => {
    // 40,000 characters, 20,000 quotes: 8e8 units, over the limit of one text.
    const LENGTH = 40_000;
    describe.each(QUOTE_CHARACTERS)("%s", (_name, character) => {
        it("in a DSML parameter", () => {
            const outcome = counting(() => parseDsmlToolCalls(dsml([dsmlParameter(0, halfQuotes(character, LENGTH))]), 0));
            expectUnreadable(outcome);
            expect(outcome.repairs.calls).toBe(0);
        });
        it("in the arguments of a tool_call body", () => {
            const outcome = counting(() => parseTextToolCalls(`<tool_call>{"name":"n","arguments":${halfQuotes(character, LENGTH)}</tool_call>`, 0));
            expectUnreadable(outcome);
            expect(outcome.repairs.calls).toBe(0);
        });
        it("in a field of a function call", () => {
            const outcome = counting(() => parseTextToolCalls(`<tool_call><function=f><a>${halfQuotes(character, LENGTH)}</a></function></tool_call>`, 0));
            expectUnreadable(outcome);
            expect(outcome.repairs.calls).toBe(0);
        });
        it("counts them in the work of a repair that is run", () => {
            const outcome = counting(() => parseToolScalar(halfQuotes(character, 2_000)));
            expect(outcome.repairs.calls).toBe(1);
            // 2,001 characters, 1,000 quotes of the character.
            expect(outcome.repairs.work).toBeGreaterThanOrEqual(2_001 * 1_000);
        });
    });
});
