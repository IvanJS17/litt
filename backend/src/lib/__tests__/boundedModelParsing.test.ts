import { afterEach, describe, expect, it, vi } from "vitest";
import { spyOnJsonrepair } from "../../__tests__/helpers/jsonrepairCalls";
import { expectLinearCost } from "../../__tests__/helpers/linearCost";
import { extractJsonCandidate, parseTextToolCalls, parseToolScalar } from "../llm/toolCallParsing";
import { parseGymDraft } from "../trainingGym";
import { parseMachineFindings, parseMatches } from "../trainingReading";
import { parseRetakeContrast, parseRetakeQuestion } from "../trainingRetake";
import { parseDefenseQuestions, parseWorkReview } from "../trainingSupervisionAi";
import { parseBackingConclusions } from "../trainingTurn/accountability";
import { parseContrastTrailer, trimTopic } from "../trainingVerdict";
import { MODEL_TEXT_MAX_CHARS } from "../modelJsonFence";

// Model answers are parsed on a thread every tenant shares: the work grows in
// step with the answer, and an answer over the shared bound is refused.
const BOUND = { small: 2_000, large: 64_000 };
const OVER_THE_BOUND = MODEL_TEXT_MAX_CHARS + 1;

// A fence whose body starts after a long run of line breaks.
const fencedAfterBlankLines = (n: number) => "```" + "\n".repeat(n) + "x";

describe("the training parsers read a long fenced answer in linear time", () => {
    it("parses a gym draft", () => {
        const args = { practice: "p", count: 1 };
        expectLinearCost((n) => parseGymDraft(fencedAfterBlankLines(n), args), BOUND);
        expect(parseGymDraft("x".repeat(OVER_THE_BOUND), args)).toBeNull();
    });
    it("parses the reading answers", () => {
        expectLinearCost((n) => parseMachineFindings(fencedAfterBlankLines(n), "source", () => null), BOUND);
        expectLinearCost((n) => parseMatches(fencedAfterBlankLines(n), 1, 1), BOUND);
        expect(parseMatches(" ".repeat(OVER_THE_BOUND), 1, 1)).toBeNull();
    });
    it("parses the retake answers", () => {
        expectLinearCost((n) => parseRetakeQuestion(fencedAfterBlankLines(n), []), BOUND);
        expectLinearCost((n) => parseRetakeContrast(fencedAfterBlankLines(n), []), BOUND);
    });
    it("parses the work review and the defense questions", () => {
        expectLinearCost((n) => parseWorkReview(fencedAfterBlankLines(n), ["N1"]), BOUND);
        expectLinearCost((n) => parseDefenseQuestions(fencedAfterBlankLines(n), "input"), BOUND);
        expect(parseDefenseQuestions("x".repeat(OVER_THE_BOUND), "input")).toBeNull();
    });
    it("parses the backing conclusions", () => {
        expectLinearCost((n) => parseBackingConclusions(fencedAfterBlankLines(n), "answer", []), BOUND);
    });
});

describe("parseContrastTrailer", () => {
    it("reads a long label line in linear time", () => {
        // Cubic cost: the sizes stay small enough to measure before the bound.
        expectLinearCost((n) => parseContrastTrailer(`Veredicto: x${" ".repeat(n)}\rx`), { small: 48, large: 1_536 });
    });
    it("reads a long topics line in linear time", () => {
        const topicsLine = (value: string) => `Cuerpo.\n\nVeredicto: coincide\nTemas: ${value}`;
        const bound = { small: 1_000, large: 32_000 };
        // Runs of the characters a topic is trimmed of, then a character that stops the trim.
        expectLinearCost((n) => parseContrastTrailer(topicsLine(".".repeat(n) + "x")), bound);
        expectLinearCost((n) => parseContrastTrailer(topicsLine("a" + ". ".repeat(n) + "x")), bound);
        expectLinearCost((n) => parseContrastTrailer(topicsLine("a" + " ".repeat(n) + "x")), bound);
        expectLinearCost((n) => parseContrastTrailer(topicsLine("-".repeat(n) + "x")), bound);
        expect(parseContrastTrailer(topicsLine(".".repeat(20_000) + "x")).topics).toEqual([]);
    });
    it("reads an ordinary trailer as before", () => {
        const got = parseContrastTrailer("Cuerpo.\n\n**Veredicto:** Coincide\n_Fundamento_: sólido\nTemas: plazo; prescripción.");
        expect(got).toMatchObject({ body: "Cuerpo.", verdict: "coincide", foundation: "solid", topics: ["plazo", "prescripción"] });
    });
});

describe("extractJsonCandidate", () => {
    it("strips a fence around a long answer in linear time", () => {
        expectLinearCost((n) => extractJsonCandidate("```json " + " ".repeat(n) + "x"), BOUND);
        expectLinearCost((n) => extractJsonCandidate("{\"a\":1} ``` " + " ".repeat(n) + "x"), BOUND);
    });
    it("strips an ordinary fence as before", () => {
        expect(extractJsonCandidate("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
        expect(extractJsonCandidate('  ```{"a":[1,2]}```  ')).toBe('{"a":[1,2]}');
    });
});

describe("trimTopic", () => {
    // What a topic was trimmed with before: bullets and blanks at its start, dots and blanks at its end.
    const before = (value: string) => value.replace(/\s+/g, " ").replace(/^[-*•\s]+|[.\s]+$/g, "").trim();
    const alphabet = ["a", "é", " ", "\t", ".", "-", "*", "•", "\u00a0", "\u2003", "\n"];

    it("gives what the earlier expression gave for every short text of the usual characters", () => {
        const differences: string[] = [];
        const walk = (prefix: string, left: number) => {
            if (trimTopic(prefix) !== before(prefix)) differences.push(JSON.stringify(prefix));
            if (left === 0) return;
            for (const piece of alphabet) walk(prefix + piece, left - 1);
        };
        walk("", 5);
        expect(differences.slice(0, 5)).toEqual([]);
    });
    it("gives what the earlier expression gave for longer generated texts", () => {
        let seed = 7;
        const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
        for (let i = 0; i < 4_000; i++) {
            let value = "";
            for (let length = 6 + (next() % 40); length > 0; length--) value += alphabet[next() % alphabet.length];
            expect(trimTopic(value), JSON.stringify(value)).toBe(before(value));
        }
    });
});

describe("the repair of a tool call's arguments", () => {
    // The most an argument may hold and still be put before a person for approval.
    const ARGUMENT_CHARS = 200_000;
    // A call whose arguments are cut short: the closing braces are missing.
    const cutCall = (argumentChars: number) => `<tool_call>{"name":"write_note","arguments":{"text":"${"x".repeat(argumentChars)}`;
    const textOf = (calls: ReturnType<typeof parseTextToolCalls>) => (calls[0]?.input as { text?: string }).text;

    it("repairs a cut call whose argument is as large as the engine accepts", () => {
        const calls = parseTextToolCalls(cutCall(ARGUMENT_CHARS - 100), 0);
        expect(calls[0].name).toBe("write_note");
        expect(textOf(calls)).toHaveLength(ARGUMENT_CHARS - 100);
    });
    it("hands on a call with no arguments when they are over that size, for the connector to refuse as it does a call with missing ones", () => {
        const calls = parseTextToolCalls(cutCall(ARGUMENT_CHARS + 1_000), 0);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe("write_note");
        expect(calls[0].input).toEqual({});
    });
    it("keeps a large value of a tag-style call as the text it is when it is over that size", () => {
        const value = `[${"1,".repeat(ARGUMENT_CHARS)}`;
        expect(parseToolScalar(value)).toBe(value);
        expect(parseToolScalar(`[1,2,`)).toEqual([1, 2]);
    });
});

describe("a tool call's arguments that are valid JSON", () => {
    const ARGUMENT_CHARS = 200_000;
    const OVER = ARGUMENT_CHARS + 1_000;
    const text = (calls: ReturnType<typeof parseTextToolCalls>) => (calls[0]?.input as { text?: string }).text;

    it("keep their arguments whatever their size, up to the shared bound", () => {
        const call = (chars: number) => `<tool_call>{"name":"write_note","arguments":{"text":"${"x".repeat(chars)}"}}</tool_call>`;
        expect(text(parseTextToolCalls(call(OVER), 0))).toHaveLength(OVER);
        expect(text(parseTextToolCalls(call(MODEL_TEXT_MAX_CHARS / 2), 0))).toHaveLength(MODEL_TEXT_MAX_CHARS / 2);
    });
    it("keep their arguments when the call is written loosely", () => {
        const loose = `<tool_call>name=write_note arguments={"text":"${"x".repeat(OVER)}"}</tool_call>`;
        expect(text(parseTextToolCalls(loose, 0))).toHaveLength(OVER);
    });
    it("keep a large nested value of a tag-style call", () => {
        const value = `[${"1,".repeat(OVER / 2)}1]`;
        expect(parseToolScalar(value)).toHaveLength(OVER / 2 + 1);
    });
    it("are read in linear time", () => {
        expectLinearCost((n) => parseTextToolCalls(`<tool_call>{"name":"write_note","arguments":{"text":"${"x".repeat(n)}"}}</tool_call>`, 0), { small: 2_000, large: 128_000 });
    });
});

describe("the size check of the tool-argument repair", () => {
    const ARGUMENT_CHARS = 200_000;
    const cutCall = (chars: number) => `<tool_call>{"name":"write_note","arguments":{"text":"${"x".repeat(chars)}`;
    const spies: { mockRestore: () => void }[] = [];
    afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));
    const load = async () => {
        vi.resetModules();
        const repair = spyOnJsonrepair();
        spies.push(repair);
        return { repair, ...(await import("../llm/toolCallParsing.js")) };
    };

    it("repairs a cut call under the size limit", async () => {
        const { repair, parseTextToolCalls: parse } = await load();
        expect((parse(cutCall(ARGUMENT_CHARS - 100), 0)[0].input as { text: string }).text).toHaveLength(ARGUMENT_CHARS - 100);
        expect(repair).toHaveBeenCalled();
    });
    it("does not start the repair of a cut call over the size limit", async () => {
        const { repair, parseTextToolCalls: parse } = await load();
        expect(parse(cutCall(ARGUMENT_CHARS + 1_000), 0)[0].input).toEqual({});
        expect(repair).not.toHaveBeenCalled();
    });
    it("does not start the repair of a loosely written call or a nested value over the size limit", async () => {
        const { repair, parseTextToolCalls: parse, parseToolScalar: scalar } = await load();
        expect(parse(`<tool_call>name=write_note arguments={"text":"${"x".repeat(ARGUMENT_CHARS + 1_000)}`, 0)[0].input).toEqual({});
        const value = `[${"1,".repeat(ARGUMENT_CHARS)}`;
        expect(scalar(value)).toBe(value);
        expect(repair).not.toHaveBeenCalled();
    });
});
