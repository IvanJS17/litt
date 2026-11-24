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

type Repairs = { calls: number; chars: number; work: number };
function counting<T>(read: () => T): { result: T; repairs: Repairs } {
    const repairs: Repairs = { calls: 0, chars: 0, work: 0 };
    setRepairObserverForTests((chars, work) => {
        repairs.calls += 1;
        repairs.chars += chars;
        repairs.work += work;
    });
    try {
        return { result: read(), repairs };
    } finally {
        setRepairObserverForTests(null);
    }
}
afterEach(() => setRepairObserverForTests(null));

/** About `length` characters, `length / 2` of them quotes: the costliest text a repair is asked to take. */
const quoted = (length: number) => "{" + "'a".repeat(length / 2);
/** The most such a text may hold and still be repaired alone: under the limit of one text. */
const JUST_UNDER = 22_000;
/** A text that costs a tenth of the budget to repair, so that a reply of them is repaired in part. */
const AFFORDABLE = 4_400;
const fill = (piece: string, total: number) => piece.repeat(Math.floor(total / piece.length));
const CAP = MODEL_TEXT_MAX_CHARS - 1_000;
const SPENT = TOOL_ARGUMENT_REPAIR_REPLY_BUDGET;

describe("a reply's repairs share one budget", () => {
    it("holds the repairs of DSML parameters, each just under the limit of one text, to the budget", () => {
        const piece = (i: number) => `<|DSML|parameter name=p${i}>${quoted(AFFORDABLE)}</|DSML|parameter>`;
        let reply = "<|DSML|invoke name=a>";
        for (let i = 0; reply.length + piece(i).length < CAP - 100; i++) reply += piece(i);
        reply += "</|DSML|invoke>";
        const { result, repairs } = counting(() => parseDsmlToolCalls(reply, 0));
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
        expect(repairs.calls).toBeGreaterThan(0);
        // The arguments the budget could not pay for are handed on as they are written.
        expect(typeof result[0].input.p0).toBe("object");
        const last = result[0].input[`p${Object.keys(result[0].input).length - 1}`];
        expect(typeof last).toBe("string");
        expect(String(last).startsWith("{'a'a")).toBe(true);
    });

    it("hands on a text that costs more than the whole budget as it is written", () => {
        const reply = `<|DSML|invoke name=a><|DSML|parameter name=p>${quoted(JUST_UNDER)}</|DSML|parameter></|DSML|invoke>`;
        const { result, repairs } = counting(() => parseDsmlToolCalls(reply, 0));
        expect(repairs.calls).toBe(0);
        expect(result[0].input.p).toBe(quoted(JUST_UNDER));
    });

    it("holds the repairs of fields of a function call to the budget", () => {
        const reply = `<tool_call><function=f>${fill(`<a>${quoted(AFFORDABLE)}</a>`, CAP)}</tool_call>`;
        const { repairs } = counting(() => parseTextToolCalls(reply, 0));
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
        expect(repairs.calls).toBeGreaterThan(0);
    });

    it("holds a body repaired twice (the JSON path, then the loose path) to the budget", () => {
        const body = `<tool_call>name: n arguments: ${quoted(AFFORDABLE)}</tool_call>`;
        expect(counting(() => parseTextToolCalls(body, 0)).repairs.calls).toBe(2);
        const reply = fill(body, CAP);
        const { result, repairs } = counting(() => parseTextToolCalls(reply, 0));
        expect(result.length).toBeGreaterThan(0);
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("holds bodies whose JSON is repaired and then read loosely when it names no tool to the budget", () => {
        const body = `<tool_call>{"name":"n","arguments":${quoted(JUST_UNDER)}</tool_call>`;
        const { repairs } = counting(() => parseTextToolCalls(fill(body, CAP), 0));
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("holds the repairs of a text with unescaped quotes in a string to the budget", () => {
        const body = `<tool_call>{"name":"n","arguments":{"text":"he said ${'and "x" '.repeat(Math.floor(JUST_UNDER / 8))}"}}</tool_call>`;
        const { repairs } = counting(() => parseTextToolCalls(fill(body, CAP), 0));
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
    });

    it("bounds the number of repairs of a reply of many small texts", () => {
        const piece = (i: number) => `<|DSML|parameter name=p${i}>{'a':'xxxxxxxxxx</|DSML|parameter>`;
        let reply = "<|DSML|invoke name=a>";
        for (let i = 0; reply.length + piece(i).length < CAP - 100; i++) reply += piece(i);
        reply += "</|DSML|invoke>";
        const { repairs } = counting(() => parseDsmlToolCalls(reply, 0));
        expect(repairs.calls).toBeLessThanOrEqual(Math.ceil(SPENT / TOOL_ARGUMENT_REPAIR_CALL_COST));
        expect(repairs.calls).toBeGreaterThan(100);
    });

    it("gives every reading its own budget, and a text that is repaired alone is still repaired", () => {
        const piece = (i: number) => `<|DSML|parameter name=p${i}>${quoted(JUST_UNDER)}</|DSML|parameter>`;
        let reply = "<|DSML|invoke name=a>";
        for (let i = 0; reply.length + piece(i).length < CAP - 100; i++) reply += piece(i);
        reply += "</|DSML|invoke>";
        const first = counting(() => parseDsmlToolCalls(reply, 0)).repairs;
        const second = counting(() => parseDsmlToolCalls(reply, 0)).repairs;
        expect(second).toEqual(first);
        expect(counting(() => parseToolScalar("{'a':'b")).repairs.calls).toBe(1);
        expect(parseToolScalar("{'a':'b")).toEqual({ a: "b" });
    });

    it("repairs a single large argument that is cut off, as before", () => {
        const call = `<tool_call>{"name":"n","arguments":{"text":"${"x".repeat(199_000)}`;
        const { result, repairs } = counting(() => parseTextToolCalls(call, 0));
        expect((result[0].input as { text: string }).text).toHaveLength(199_000);
        expect(repairs.calls).toBeGreaterThan(0);
        expect(repairs.work).toBeLessThanOrEqual(SPENT);
    });
});
