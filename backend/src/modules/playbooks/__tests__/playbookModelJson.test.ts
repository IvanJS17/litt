import { afterEach, describe, expect, it, vi } from "vitest";
import { spyOnJsonrepair } from "../../../__tests__/helpers/jsonrepairCalls";
import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import { parseModelJson, PlaybookModelOutputError, validatePlaybookCompilationWithRetry } from "../playbooks.operations";

describe("parseModelJson on an answer that overflows the library's stack", () => {
    it("ends as the error of an answer that cannot be read", () => {
        const deep = '[{"a":'.repeat(15_000) + "}";
        expect(() => parseModelJson(deep)).toThrow(PlaybookModelOutputError);
        expect(() => parseModelJson(deep)).toThrow("The model did not return structured JSON.");
    });
});

describe("parseModelJson", () => {
    it("reads an answer followed by a long run of blanks in linear time", () => {
        expectLinearCost((n) => parseModelJson('{"findings":[]}' + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expect(parseModelJson('{"findings":[]}' + " ".repeat(64_000) + "x")).toEqual({ findings: [] });
    });
    it("reads a fenced answer as before", () => {
        expect(parseModelJson('```json\n{"summary":"ok","findings":[]}\n```')).toEqual({ summary: "ok", findings: [] });
        expect(parseModelJson('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
        expect(parseModelJson("{'a': 1,}")).toEqual({ a: 1 });
    });
    it("refuses an answer over the shared bound with the error the runs already report", () => {
        expect(() => parseModelJson("x".repeat(MODEL_TEXT_MAX_CHARS + 1))).toThrow(PlaybookModelOutputError);
    });
});

// The largest answer a review or an import can ask for: 20,000 tokens of output plus the
// 4,096 allowance for models that always reason, at five characters a token at most.
const LARGEST_ANSWER_CHARS = (20_000 + 4_096) * 5;

const finding = (i: number) => ({ rule_id: `rule-${i}`, status: "not_met", note: `The clause ${i} sets a term of ${i} days, which is shorter than the playbook allows.` });
/** An answer of `length` characters or a little less: whole findings, with one cut or damaged by `shape`. */
function longReview(length: number, shape: "complete" | "cut" | "unescaped quote"): { text: string; findings: number } {
    let findings = 0;
    let body = "";
    while (body.length + 140 < length) body += `${findings++ ? "," : ""}${JSON.stringify(finding(findings))}`;
    const head = '{"summary":"A long review.","findings":[';
    if (shape === "cut") return { text: head + body + ',{"rule_id":"rule-last","status":"not_', findings };
    if (shape === "unescaped quote") return { text: head + body.replace("shorter", 'sho"rter') + "]}", findings };
    return { text: head + body + "]}", findings };
}

describe("parseModelJson on the longest answers the product asks a model for", () => {
    const countOf = (value: unknown) => (value as { findings: unknown[] }).findings.length;

    it("repairs a review cut at the output limit", () => {
        const { text, findings } = longReview(LARGEST_ANSWER_CHARS - 200, "cut");
        expect(text.length).toBeGreaterThan(LARGEST_ANSWER_CHARS - 400);
        expect(countOf(parseModelJson("```json\n" + text))).toBeGreaterThanOrEqual(findings);
    });
    it("repairs a review of that size with one unescaped quote", () => {
        const { text, findings } = longReview(LARGEST_ANSWER_CHARS - 200, "unescaped quote");
        expect(countOf(parseModelJson(text))).toBe(findings);
    });
    it("repairs a longer answer, up to the cap, but not beyond it", () => {
        expect(() => parseModelJson(longReview(LARGEST_ANSWER_CHARS - 200, "cut").text)).not.toThrow();
        const over = longReview(LARGEST_ANSWER_CHARS * 1.5, "cut").text;
        expect(over.length).toBeGreaterThan(LARGEST_ANSWER_CHARS);
        expect(() => parseModelJson(over)).toThrow("The model did not return structured JSON.");
    });
    it("fails an import whose answer is over the cap with the failure of an invalid answer", async () => {
        const over = longReview(LARGEST_ANSWER_CHARS * 1.5, "unescaped quote").text;
        const retry = vi.fn(async () => over);
        const structure = { sections: [] } as unknown as Parameters<typeof validatePlaybookCompilationWithRetry>[0]["structure"];
        const failure = await validatePlaybookCompilationWithRetry({ raw: over, structure, retry }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(PlaybookModelOutputError);
        expect((failure as Error).message).toContain("invalid structured output twice");
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe("the size check of the playbook answer repair", () => {
    const spies: { mockRestore: () => void }[] = [];
    afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));
    const load = async () => {
        vi.resetModules();
        const repair = spyOnJsonrepair();
        spies.push(repair);
        return { repair, ...(await import("../playbooks.operations.js")) };
    };

    it("reads a valid answer over the repair limit whole, without repairing it", async () => {
        const { repair, parseModelJson: parse } = await load();
        const valid = longReview(LARGEST_ANSWER_CHARS * 1.5, "complete");
        expect(valid.text.length).toBeGreaterThan(LARGEST_ANSWER_CHARS);
        expect((parse(valid.text) as { findings: unknown[] }).findings).toHaveLength(valid.findings);
        expect((parse("Here it is: " + valid.text + " Done.") as { findings: unknown[] }).findings).toHaveLength(valid.findings);
        expect(repair).not.toHaveBeenCalled();
    });
    it("repairs a damaged answer under the limit", async () => {
        const { repair, parseModelJson: parse } = await load();
        expect(() => parse(longReview(LARGEST_ANSWER_CHARS - 200, "cut").text)).not.toThrow();
        expect(repair).toHaveBeenCalled();
    });
    it("does not start the repair of a damaged answer over the limit", async () => {
        const { repair, parseModelJson: parse } = await load();
        expect(() => parse(longReview(LARGEST_ANSWER_CHARS * 1.5, "cut").text)).toThrow("The model did not return structured JSON.");
        expect(() => parse(longReview(LARGEST_ANSWER_CHARS * 1.5, "unescaped quote").text)).toThrow("The model did not return structured JSON.");
        expect(repair).not.toHaveBeenCalled();
    });
    // A closed text of quotes takes the library seconds to minutes; the repair runs under a deadline of one
    // second and is refused when it does not finish. The assertions keep three times that as slack.
    it.each([
        ["an apostrophe", "'"],
        ["a curly quote", "\u2018"],
        ["a backtick", "`"],
    ])("refuses a damaged answer full of %s that ends in a bracket, within three times the time allowed", async (_name, quote) => {
        const { parseModelJson: parse } = await load();
        for (const length of [8_002, 20_002]) {
            const answer = "{" + (quote + "a").repeat((length - 2) / 2) + "}";
            const started = performance.now();
            expect(() => parse(answer)).toThrow("The model did not return structured JSON.");
            expect(performance.now() - started).toBeLessThan(3_000);
        }
        // After a refusal the next honest answer is repaired.
        expect(parse("{'a': 1,}")).toEqual({ a: 1 });
    }, 30_000);
    it("reads a long damaged answer of paired quotes without being refused", async () => {
        const { parseModelJson: parse } = await load();
        const answer = `{"text":"${'say \\"x\\" '.repeat(11_000)}",}`;
        expect((parse(answer) as { text: string }).text.length).toBeGreaterThan(80_000);
    });
});
