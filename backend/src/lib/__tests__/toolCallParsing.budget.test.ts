import { afterEach, describe, expect, it } from "vitest";

import { MODEL_TEXT_MAX_CHARS } from "../modelJsonFence";
import {
    parseDsmlToolCalls,
    parseTextToolCalls,
    parseToolInput,
    parseToolScalar,
    setRepairObserverForTests,
    TOOL_ARGUMENT_REPAIR_REPLY_BUDGET_MS,
} from "../llm/toolCallParsing";

// The repairs of one reading of a reply (one call of an entry point) share one time budget, and each
// runs under a deadline. An argument a bound refuses (its size, or the time) ends the reading with the
// error of a call that cannot be read: no call of that reply is handed on. Time assertions keep 3x the
// budget as slack, because the host that runs them is shared.

type Outcome<T> = { result: T | undefined; failure: unknown; repairs: number; ms: number };
function counting<T>(read: () => T): Outcome<T> {
    let repairs = 0;
    setRepairObserverForTests(() => {
        repairs += 1;
    });
    const started = performance.now();
    try {
        return { result: read(), failure: undefined, repairs, ms: performance.now() - started };
    } catch (failure) {
        return { result: undefined, failure, repairs, ms: performance.now() - started };
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

const BUDGET_MS = 1_000;
const SLACK_MS = 3 * BUDGET_MS;
const OVER_LIMIT = 250_000;
const CAP = MODEL_TEXT_MAX_CHARS - 1_000;

const dsmlParameter = (i: number, value: string) => `<|DSML|parameter name=p${i}>${value}</|DSML|parameter>`;
const dsml = (parameters: string[]) => `<|DSML|invoke name=a>${parameters.join("")}</|DSML|invoke>`;

describe("the time budget of one reading is fixed by its value", () => {
    it("is 1,000 ms", () => {
        expect(TOOL_ARGUMENT_REPAIR_REPLY_BUDGET_MS).toBe(1_000);
    });
});

// Closed quote-heavy text: the library takes seconds to minutes on it, so it is refused by time.
const CLOSED: [string, string, string][] = [
    ["ASCII apostrophe", "'", "'"],
    ["curly quote", "\u2018", "\u2018"],
    ["backtick", "`", "`"],
];
const closed = (quote: string, length: number, open: string, close: string) => open + (quote + "a").repeat((length - 2) / 2) + close;

describe.each(CLOSED)("text full of a %s that ends in a closing bracket", (_name, quote) => {
    describe.each([8_002, 20_002])("of %i characters", (length) => {
        const object = closed(quote, length, "{", "}");
        const array = closed(quote, length, "[", "]");
        it.each([
            ["a tool_call body, object", () => parseTextToolCalls(`<tool_call>{"name":"n","arguments":${object}}</tool_call>`, 0)],
            ["a tool_call body, array", () => parseTextToolCalls(`<tool_call>{"name":"n","arguments":${array}}</tool_call>`, 0)],
            ["a DSML parameter", () => parseDsmlToolCalls(dsml([dsmlParameter(0, object)]), 0)],
            ["a function field", () => parseTextToolCalls(`<tool_call><function=f><a>${object}</a></function></tool_call>`, 0)],
            ["a scalar", () => parseToolScalar(object)],
            ["a scalar array", () => parseToolScalar(array)],
            ["tool input", () => parseToolInput(object)],
        ])("is refused within the slack, in %s", (_where, read) => {
            const outcome = counting(read as () => unknown);
            if (_where === "tool input") {
                // The reader of a call's input keeps its own contract for text that cannot be read; only time matters.
                expect(outcome.ms).toBeLessThan(SLACK_MS);
                return;
            }
            expectUnreadable(outcome);
            expect(outcome.ms).toBeLessThan(SLACK_MS);
        }, 30_000);
    });
});

describe("the budget is shared by the texts of one reading", () => {
    const text = closed("'", 2_002, "{", "}");
    it("ends a reading of 40 costly arguments within the slack", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsml(Array.from({ length: 40 }, (_, i) => dsmlParameter(i, text))), 0));
        expectUnreadable(outcome);
        expect(outcome.ms).toBeLessThan(SLACK_MS);
    }, 30_000);

    it("ends a reading of 40 costly bodies within the slack", () => {
        const body = `<tool_call>{"name":"n","arguments":${text}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(Array.from({ length: 40 }, () => body).join("\n"), 0));
        expectUnreadable(outcome);
        expect(outcome.ms).toBeLessThan(SLACK_MS);
    }, 30_000);

    it("takes the wall time of every repair from the budget, so that two costly texts cannot each have the whole of it", () => {
        // Each text alone is stopped at the time left; together they are stopped at the budget, not at twice it.
        const slow = closed("'", 8_002, "{", "}");
        const outcome = counting(() => parseDsmlToolCalls(dsml([0, 1].map((i) => dsmlParameter(i, slow))), 0));
        expectUnreadable(outcome);
        expect(outcome.ms).toBeLessThan(BUDGET_MS * 1.9);
        expect(outcome.repairs).toBe(1);
    }, 30_000);

    it("reads 20,000 tiny repairs, or refuses them, within the slack", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsmlOfValues("{'a':'x"), 0));
        expect(outcome.ms).toBeLessThan(SLACK_MS);
        if (outcome.failure !== undefined) expectUnreadable(outcome);
        else expect(outcome.result).toHaveLength(1);
    }, 30_000);

    it("gives every reading its own budget, and a text that is repaired alone is still repaired", () => {
        counting(() => parseDsmlToolCalls(dsml([0, 1].map((i) => dsmlParameter(i, text))), 0));
        const again = counting(() => parseToolScalar("{'a':'b"));
        expect(again.result).toEqual({ a: "b" });
        expect(again.repairs).toBe(1);
    }, 30_000);
});

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

describe("a text over the limit of one text is refused without a repair", () => {
    const quoted = (length: number) => "{" + "'a".repeat(length / 2);
    it("in a DSML parameter", () => {
        const outcome = counting(() => parseDsmlToolCalls(dsml([dsmlParameter(0, quoted(OVER_LIMIT))]), 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in a field of a function call", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call><function=f><a>${quoted(OVER_LIMIT)}</a></function></tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in the JSON of a body, which is not then read loosely", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>{"name":"n","arguments":${quoted(OVER_LIMIT)}</tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in the arguments of a loose body", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>name: n arguments: ${quoted(OVER_LIMIT)}</tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in the loose reading of a body whose JSON names no tool", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>{"x":1} name: n arguments: ${quoted(OVER_LIMIT)}</tool_call>`, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in the JSON of a body though its arguments alone would be read", () => {
        const body = `<tool_call>{"name":"n","note":"x","pad":${quoted(OVER_LIMIT)},"arguments":{"q":1}}</tool_call>`;
        const outcome = counting(() => parseTextToolCalls(body, 0));
        expectUnreadable(outcome);
        expect(outcome.repairs).toBe(0);
    });
    it("in a scalar read on its own", () => {
        expect(() => parseToolScalar(quoted(OVER_LIMIT))).toThrow(UNREADABLE);
    });
});

describe("a refusal by time in the loose reading and the body's catch ends the reading", () => {
    const text = closed("'", 8_002, "{", "}");
    it("when the arguments of a loose body are too slow", () => {
        expectUnreadable(counting(() => parseTextToolCalls(`<tool_call>name: n arguments: ${text}</tool_call>`, 0)));
    }, 30_000);
    it("when the loose reading of a body whose JSON names no tool is too slow", () => {
        expectUnreadable(counting(() => parseTextToolCalls(`<tool_call>{"x":1} name: n arguments: ${text}</tool_call>`, 0)));
    }, 30_000);
    it("when the JSON of a body is too slow though its arguments alone would be read", () => {
        const body = `<tool_call>{"name":"n","pad":${text},"arguments":{"q":1}}</tool_call>`;
        expectUnreadable(counting(() => parseTextToolCalls(body, 0)));
    }, 30_000);
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
        expect(outcome.repairs).toBe(0);
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
        expect(outcome.repairs).toBe(3);
        expect(outcome.ms).toBeLessThan(BUDGET_MS);
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
        expect(outcome.repairs).toBe(3);
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
        expect(outcome.repairs).toBe(30);
        expect(outcome.ms).toBeLessThan(BUDGET_MS);
    });
});


describe("a body whose JSON holds the call is read once", () => {
    it("repairs it once", () => {
        const outcome = counting(() => parseTextToolCalls(`<tool_call>{"name":"n","arguments":{"a":1,}}</tool_call>`, 0));
        expect(outcome.repairs).toBe(1);
    });
    it("repairs a single large argument that is cut off, as before", () => {
        const call = `<tool_call>{"name":"n","arguments":{"text":"${"x".repeat(199_000)}`;
        const { result, repairs } = counting(() => parseTextToolCalls(call, 0));
        expect((result![0].input as { text: string }).text).toHaveLength(199_000);
        expect(repairs).toBeGreaterThan(0);
    });
});
