import { describe, expect, it } from "vitest";

import { patternsApplied, UNBOUNDED_WILDCARD } from "../llm/__tests__/regexUse";
import { MODEL_TEXT_MAX_CHARS } from "../modelJsonFence";
import { parseDsmlToolCalls, parseTextToolCalls, TextToolMarkupFilter } from "../llm/toolCallParsing";

// Text a model wrote is read for tool calls while a turn runs, so the work must
// grow in proportion to the text, whatever the text holds. The proof is by
// structure: no pattern applied to it has a wildcard between two searched parts.
const SHAPES: [string, string][] = [
    ["whitespace lines that name nothing", "\n ".repeat(20_000)],
    ["opening tags that never close", "<tool_call ".repeat(10_000)],
    ["fields that never close", `<tool_call><function=f>${"<a>".repeat(10_000)}`],
    ["invocations that never close", "<|DSML|invoke name=a>".repeat(5_000)],
    ["parameters that never close", `<|DSML|invoke name=a>${"<|DSML|parameter name=p>".repeat(5_000)}</|DSML|invoke>`],
    ["parameter tags that never end", `<|DSML|invoke name=a>${"<|DSML|parameter name=p ".repeat(5_000)}</|DSML|invoke>`],
];

describe("reading tool calls out of a model's text", () => {
    it.each(SHAPES)("applies no pattern with a wildcard between two searched parts to %s", (_name, text) => {
        const sources = patternsApplied(() => {
            try {
                parseTextToolCalls(text, 0);
            } catch {
                // Text that looks like a call and holds none is refused; only the work matters here.
            }
        });
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.filter((source) => UNBOUNDED_WILDCARD.test(source))).toEqual([]);
    });

    it("still reads what the earlier expressions read", () => {
        const calls = (text: string) => parseTextToolCalls(text, 0).map(({ name, input }) => ({ name, input }));
        // A line that begins with a tool/name key is markup (and, with no tag around it, no executable call).
        expect(() => calls("x\n  \n tool: nothing here")).toThrow(/did not identify/);
        expect(() => calls("   name = lookup")).toThrow(/did not identify/);
        expect(() => calls("\n\n\t function : f")).toThrow(/did not identify/);
        expect(calls("a name: b is not at a line start")).toEqual([]);
        expect(calls('<tool_call id="1" kind="x">{"name":"n","arguments":{"q":1}}</tool_call>')).toEqual([{ name: "n", input: { q: 1 } }]);
        expect(calls("<tool_call><function=f><a> 1 </a><b>two</b><c>unclosed<a>3</a></tool_call>")).toEqual([
            { name: "f", input: { a: 3, b: "two" } },
        ]);
        expect(calls("<tool_call><function=f><a>\n</a></tool_call>")).toEqual([{ name: "f", input: { a: "" } }]);
        expect(calls("<tool_call><function=f><x>1</y><x>2</x></tool_call>")).toEqual([{ name: "f", input: { x: "1</y><x>2" } }]);
        expect(
            parseDsmlToolCalls(
                '<|DSML|invoke name="a"><|DSML|parameter name="p" type="s">v</|DSML|parameter><|DSML|parameter name=q>2</|DSML|parameter></|DSML|invoke><|DSML|invoke name=b></|DSML|invoke><|DSML|invoke name=c>',
                0,
            ).map(({ name, input }) => ({ name, input })),
        ).toEqual([
            { name: "a", input: { p: "v", q: 2 } },
            { name: "b", input: {} },
        ]);
    });

    it("stays quick on large text of each shape (a generous bound, not the proof)", () => {
        const started = Date.now();
        for (const [, text] of SHAPES) {
            try {
                parseTextToolCalls(text.repeat(4), 0);
            } catch {
                // see above
            }
        }
        expect(Date.now() - started).toBeLessThan(20_000);
    });

    it("reads a name of exactly the longest length, and not one character more", () => {
        const dsml = (name: string, parameter: string) =>
            `<|DSML|invoke name=${name}><|DSML|parameter name=${parameter}>v</|DSML|parameter></|DSML|invoke>`;
        const longest = "n".repeat(200);
        expect(parseDsmlToolCalls(dsml(longest, "p"), 0).map((c) => c.name)).toEqual([longest]);
        expect(parseDsmlToolCalls(dsml("n".repeat(201), "p"), 0)).toEqual([]);
        expect(parseDsmlToolCalls(dsml("a", longest), 0)[0].input).toEqual({ [longest]: "v" });
        expect(parseDsmlToolCalls(dsml("a", "p".repeat(201)), 0)[0].input).toEqual({});
        const xml = (name: string) => `<tool_call><function=${name}><a>1</a></tool_call>`;
        expect(parseTextToolCalls(xml(longest), 0).map((c) => c.name)).toEqual([longest]);
        const tooLong = (() => {
            try {
                return parseTextToolCalls(xml("n".repeat(201)), 0).map((c) => c.name);
            } catch {
                return [];
            }
        })();
        expect(tooLong).not.toContain("n".repeat(201));
        const quoted = (name: string) => `<tool_call><function name="${name}"><a>1</a></tool_call>`;
        expect(parseTextToolCalls(quoted(longest), 0).map((c) => c.name)).toEqual([longest]);
    });

    it("reads what follows the name of an opening tag up to 200 characters, and not one more", () => {
        const tag = (attributes: number) => `<tool_call ${"a".repeat(attributes)}>{"name":"n","arguments":{"q":1}}</tool_call>`;
        expect(parseTextToolCalls(tag(199), 0).map((c) => c.name)).toEqual(["n"]);
        expect(() => parseTextToolCalls(tag(200), 0)).toThrow(/did not identify/);
        const parameter = (attributes: number) =>
            `<|DSML|invoke name=a><|DSML|parameter name=p ${"a".repeat(attributes)}>v</|DSML|parameter></|DSML|invoke>`;
        expect(parseDsmlToolCalls(parameter(200), 0)[0].input).toEqual({ p: "v" });
        expect(parseDsmlToolCalls(parameter(201), 0)[0].input).toEqual({});
    });

    it("repairs a cut argument of any size up to its bound, and leaves a quote-dense one that would cost too much", () => {
        const cut = (text: string) => `<tool_call>{"name":"n","arguments":{"text":"${text}`;
        const call = parseTextToolCalls(cut("x".repeat(199_000)), 0);
        expect((call[0].input as { text: string }).text).toHaveLength(199_000);
        const quoted = parseTextToolCalls(cut('he said "hi" and '.repeat(10_000)), 0);
        expect(quoted).toHaveLength(1);
        expect(quoted[0].input).toEqual({});
        const small = parseTextToolCalls(cut('he said "hi" and "bye" '), 0);
        expect((small[0].input as { text: string }).text).toContain("hi");
    });

    it("pairs each field with the first closing after it, whatever the names around it", () => {
        const calls = (body: string) => parseTextToolCalls(`<tool_call><function=f>${body}</tool_call>`, 0).map((c) => c.input);
        expect(calls("<a>1</a><b>2</b>")).toEqual([{ a: 1, b: 2 }]);
        expect(calls("<a>x<a>y</a>")).toEqual([{ a: "x<a>y" }]);
        expect(calls("<a>1</a><a>2</a>")).toEqual([{ a: 2 }]);
        expect(calls("<a>1<b>2</b>3</a>")).toEqual([{ a: "1<b>2</b>3" }]);
        expect(calls("<b>x</a><a>y</a>")).toEqual([{ a: "y" }]);
        expect(calls("<a>x</b></a>")).toEqual([{ a: "x</b>" }]);
        expect(calls("</a><a>x")).toEqual([{}]);
        expect(calls("<a0><a1><a2></a1></a0>")).toEqual([{ a0: "<a1><a2></a1>" }]);
    });

    it("does not scan a reply longer than the bound that applies to model text, and takes it for plain text", () => {
        const call = '<tool_call>{"name":"n","arguments":{}}</tool_call>';
        expect(parseTextToolCalls(call, 0)).toHaveLength(1);
        expect(parseTextToolCalls(call + " ".repeat(MODEL_TEXT_MAX_CHARS), 0)).toEqual([]);
        const dsml = "<|DSML|invoke name=a></|DSML|invoke>";
        expect(parseDsmlToolCalls(dsml, 0)).toHaveLength(1);
        expect(parseDsmlToolCalls(dsml + " ".repeat(MODEL_TEXT_MAX_CHARS), 0)).toEqual([]);
    });

    it("lets ordinary text that begins with an angle bracket through the markup filter, and holds back a marker's beginning", () => {
        const visible = (...chunks: string[]) => {
            const filter = new TextToolMarkupFilter();
            return chunks.map((chunk) => filter.feed(chunk)).join("") + filter.flush();
        };
        expect(new TextToolMarkupFilter().feed("<b>bold</b>")).toBe("<b>bold</b>");
        expect(visible("<", "b>", " text <i>")).toBe("<b> text <i>");
        expect(visible("see <tool", "_call>x")).toBe("see ");
        expect(visible("a <tool_c")).toBe("a <tool_c");
        expect(visible("<<function", "=f>")).toBe("<");
        expect(visible("x<".repeat(50_000))).toBe("x<".repeat(50_000));
    });

    it("keeps a function opening written with a single quote, and a DSML parameter on its own, out of view or unread", () => {
        const visible = (text: string) => {
            const filter = new TextToolMarkupFilter();
            return filter.feed(text) + filter.flush();
        };
        const quoted = "<tool_call><function name='f'><a>1</a></function></tool_call>";
        expect(parseTextToolCalls(quoted, 0).map((call) => call.input)).toEqual([{ a: 1 }]);
        expect(visible("Sure. <function name='f'><a>1</a>")).toBe("Sure. ");
        // No reader takes a parameter that is not inside an invocation, so there is no call to hide.
        for (const bar of ["|", "｜"]) {
            const alone = `<${bar}DSML${bar}parameter name=p>1</${bar}DSML${bar}parameter>`;
            expect(parseDsmlToolCalls(alone, 0)).toEqual([]);
            expect(parseTextToolCalls(alone, 0)).toEqual([]);
        }
    });
});
