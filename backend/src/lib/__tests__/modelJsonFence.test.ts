import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../__tests__/helpers/linearCost";
import {
    assertBoundedText,
    BoundedTextError,
    charsForTokens,
    findInlineCitations,
    findTaggedBlocks,
    MODEL_TEXT_MAX_CHARS,
    readLabelledLine,
    replaceInlineCitations,
    replaceTags,
    scanHtml,
    splitFrontMatter,
    stripCodeFence,
    trimChars,
    unwrapFencedAnswer,
    unwrapFencedJsonBlock,
} from "../modelJsonFence";

// A small deterministic generator: the same inputs on every run.
function inputs(alphabet: readonly string[], count: number, maxLength: number): string[] {
    let seed = 12345;
    const next = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
    };
    return Array.from({ length: count }, () =>
        Array.from({ length: next() % (maxLength + 1) }, () => alphabet[next() % alphabet.length]).join(""),
    );
}

// The expressions these primitives replaced, kept here as the reference for
// what ordinary text must still give.
const REFERENCE = {
    labelledFence: (text: string) => {
        const t = text.trim();
        const m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
        return m ? m[1].trim() : t;
    },
    jsonBlockFence: (text: string) => text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1").trim(),
    looseFence: (text: string) =>
        text
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, ""),
    citations: (text: string) => [...text.matchAll(/\[\[((?:[^[\]]|\[[^\]]*\])+)\]\]/g)].map((m) => [m.index, m[0], m[1]]),
    frontMatter: (text: string) => /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1].split(/\r?\n/) ?? null,
    block: (text: string) => [...text.matchAll(/<EDITS>\s*([\s\S]*?)\s*<\/EDITS>/gi)].map((m) => [m.index, m.index! + m[0].length, m[1]]),
    tags: (text: string) => text.replace(/<[^>]*>/g, " "),
    label: (line: string) =>
        /^\s*[*_`]*\s*(veredicto|fundamento|temas?|pregunta(?:\s+de\s+fundamento)?)\s*[*_`]*\s*:\s*[*_`]*\s*(.*?)\s*[*_`]*\s*$/i.exec(line),
    title: (text: string) => text.trim().replace(/^["'`]+|["'`.,:;!?]+$/g, ""),
};

describe("assertBoundedText", () => {
    it("returns text within the limit and refuses text over it with a typed error", () => {
        expect(assertBoundedText("abc", 3)).toBe("abc");
        expect(() => assertBoundedText("abcd", 3)).toThrow(BoundedTextError);
        expect(() => assertBoundedText("x".repeat(MODEL_TEXT_MAX_CHARS + 1))).toThrow(BoundedTextError);
        expect(assertBoundedText("x".repeat(MODEL_TEXT_MAX_CHARS))).toHaveLength(MODEL_TEXT_MAX_CHARS);
        try {
            assertBoundedText("abcd", 3);
        } catch (error) {
            expect(error).toMatchObject({ code: "text_too_long", limit: 3, length: 4 });
        }
    });
    it("is applied before any scan of every primitive", () => {
        const big = "a".repeat(MODEL_TEXT_MAX_CHARS + 1);
        expect(() => stripCodeFence(big)).toThrow(BoundedTextError);
        expect(() => unwrapFencedAnswer(big)).toThrow(BoundedTextError);
        expect(() => unwrapFencedJsonBlock(big)).toThrow(BoundedTextError);
        expect(() => findInlineCitations(big)).toThrow(BoundedTextError);
        expect(() => replaceInlineCitations(big, (m) => m)).toThrow(BoundedTextError);
        expect(() => scanHtml(big, 100)).toThrow(BoundedTextError);
        expect(() => replaceTags(big, " ")).toThrow(BoundedTextError);
        expect(() => findTaggedBlocks(big, "EDITS")).toThrow(BoundedTextError);
        expect(() => readLabelledLine(big, ["a"])).toThrow(BoundedTextError);
        expect(() => trimChars(big, "a", "a")).toThrow(BoundedTextError);
    });
});

describe("code fences give what the expressions they replaced gave", () => {
    const pieces = ["```", "json", "JSON", "\n", " ", "\r", "\t", "a", "[1]", "{", "}", "`", "x"];
    const sample = inputs(pieces, 4000, 9);
    const ordinary = [
        "[1,2]",
        " [1,2] ",
        "```json\n[1,2]\n```",
        "```\n{\"a\":1}\n```",
        "```JSON\r\n{\"a\":1}\r\n```",
        "```json [1] ```",
        "```[1]```",
        "```json\n\n```",
        "```\n```",
        "``````",
        "```",
        "",
    ];

    it("unwrapFencedAnswer", () => {
        for (const text of [...ordinary, ...sample]) expect(unwrapFencedAnswer(text), JSON.stringify(text)).toBe(REFERENCE.labelledFence(text));
    });
    it("unwrapFencedJsonBlock", () => {
        for (const text of [...ordinary, ...sample]) expect(unwrapFencedJsonBlock(text), JSON.stringify(text)).toBe(REFERENCE.jsonBlockFence(text));
    });
    it("stripCodeFence", () => {
        for (const text of [...ordinary, ...sample]) expect(stripCodeFence(text), JSON.stringify(text)).toBe(REFERENCE.looseFence(text).trim());
    });
    it("cost grows in step with the text", () => {
        expectLinearCost((n) => stripCodeFence("```json" + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => stripCodeFence("{}" + " ".repeat(n) + "x```"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => unwrapFencedAnswer("```" + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => unwrapFencedJsonBlock("```" + "\n".repeat(n) + "x"), { small: 2_000, large: 64_000 });
    });
});

describe("findInlineCitations", () => {
    const pieces = ["[[", "]]", "[", "]", "a", "|", "x"];
    const sample = inputs(pieces, 6000, 10);

    it("finds the markers the expression it replaced found", () => {
        for (const text of ["", "[[a]]", "x [[a|b]] y [[c]]", "[[a [b] c]]", "[[[a]]]", "[[a[b]]]", "[[]]", "[[a]", "[[a]]]", "[[Yes]] [[page:1||quote:q [n]]]", ...sample]) {
            const found = findInlineCitations(text).map((m) => [m.start, text.slice(m.start, m.end), m.metadata]);
            expect(found, JSON.stringify(text)).toEqual(REFERENCE.citations(text));
        }
    });
    it("replaces markers like String.replace with the same expression did", () => {
        const text = "a [[x||y]] b [[z]] c [[";
        const replaced = replaceInlineCitations(text, (marker, metadata) => (metadata.includes("||") ? `<${metadata}>` : marker));
        expect(replaced).toBe(text.replace(/\[\[((?:[^[\]]|\[[^\]]*\])+)\]\]/g, (marker, metadata: string) => (metadata.includes("||") ? `<${metadata}>` : marker)));
    });
    it("costs time in step with the text on text made of brackets", () => {
        expectLinearCost((n) => findInlineCitations("[[".repeat(n) + "]"), { small: 4_000, large: 128_000 });
        expectLinearCost((n) => findInlineCitations("[[a" + "[".repeat(n)), { small: 4_000, large: 128_000 });
        expectLinearCost((n) => findInlineCitations("[[a]".repeat(n)), { small: 4_000, large: 64_000 });
    });
});

describe("splitFrontMatter", () => {
    const pieces = ["---", "\n", "\r\n", "\r", "name: a", "x", " "];
    const sample = inputs(pieces, 6000, 9);

    it("gives the lines the expression it replaced gave", () => {
        for (const text of ["", "---\nname: a\n---\nbody", "---\r\nname: a\r\n---\r\nbody", "---\n\n---\n", "---\n---\n", "---\nname: a\n---", "---\nname: a\n----\nx\n---", ...sample]) {
            expect(splitFrontMatter(text), JSON.stringify(text)).toEqual(REFERENCE.frontMatter(text));
        }
    });
    it("gives the lines of a long header that fit the window, and none of a line cut by it", () => {
        const long = `---\nname: a\nb: c\n${"x".repeat(100)}\nname: late\n---\nbody`;
        expect(splitFrontMatter(long, 30)).toEqual(["name: a", "b: c"]);
        expect(splitFrontMatter(`---\n${"a".repeat(100)}\n---\n`, 50)).toEqual([]);
        expect(splitFrontMatter(long)).toEqual(["name: a", "b: c", "x".repeat(100), "name: late"]);
    });
    it("gives null, not an error, for a header that never closes, however long the text", () => {
        expect(splitFrontMatter(`---\nname: a\n${"x\n".repeat(50_000)}`, 50)).toBeNull();
        expect(splitFrontMatter("---\nname: a")).toBeNull();
    });
    it("costs time in step with the text", () => {
        expectLinearCost((n) => splitFrontMatter("---\n" + "\n--x".repeat(n), 10_000_000), { small: 4_000, large: 128_000 });
    });
});

describe("findTaggedBlocks", () => {
    const pieces = ["<EDITS>", "</EDITS>", "<edits>", "</edits>", "<", "a", " ", "\n", "/"];
    const sample = inputs(pieces, 6000, 8);

    it("finds the blocks the expression it replaced found", () => {
        for (const text of ["", "<EDITS>[]</EDITS>", "a <edits> [1] </EDITS> b <EDITS></EDITS>", "<EDITS><EDITS>x</EDITS>", "<EDITS>x", ...sample]) {
            const found = findTaggedBlocks(text, "EDITS").map((b) => [b.start, b.end, b.inner]);
            expect(found, JSON.stringify(text)).toEqual(REFERENCE.block(text));
        }
    });
    it("costs time in step with the text", () => {
        expectLinearCost((n) => findTaggedBlocks("<EDITS>".repeat(n), "EDITS"), { small: 500, large: 16_000 });
        expectLinearCost((n) => findTaggedBlocks("<EDITS>" + " ".repeat(n), "EDITS"), { small: 4_000, large: 128_000 });
    });
});

describe("replaceTags", () => {
    it("replaces tags like the expression it replaced did", () => {
        for (const text of ["", "a <b>c</b> d", "<a<b>c", "<>", "a < b > c <", "<<<>", ...inputs(["<", ">", "a", " "], 3000, 9)]) {
            expect(replaceTags(text, " "), JSON.stringify(text)).toBe(REFERENCE.tags(text));
        }
        expectLinearCost((n) => replaceTags("<".repeat(n), " "), { small: 4_000, large: 128_000 });
    });
});

describe("scanHtml", () => {
    const scan = (text: string) => scanHtml(text, MODEL_TEXT_MAX_CHARS);

    it("names the tags, with blanks and a slash allowed after the angle bracket", () => {
        expect([...scan("<b>x</b> < / SCRIPT > <img src=x> <form_x> <scripts>").tagNames].sort()).toEqual(
            ["b", "form_x", "img", "script", "scripts"].sort(),
        );
        expect(scan("<b <script>").tagNames.has("script")).toBe(true);
    });
    it("finds an event handler in a tag", () => {
        for (const text of ["<p onclick=x>", '<p class="a" onMouseOver = "x">', "<a\nonfocus=x>", "<p x=1 onx=2>"]) expect(scan(text).hasEventHandler, text).toBe(true);
        for (const text of ["<p class=x>", "on = 3 <b>", "<b> onclick=x", "<p conclick=x>", "<p on=x>", "<onclick=x>"]) expect(scan(text).hasEventHandler, text).toBe(false);
    });
    it("reads the target of link attributes", () => {
        const schemes = (text: string) => scan(text).links.map((link) => link.scheme);
        expect(schemes('<a href="javascript:x">')).toEqual(["javascript"]);
        expect(schemes("<a HREF = ' JavaScript : x'>")).toEqual(["javascript"]);
        expect(scan("<a src=data:text/html,x>").links).toEqual([{ scheme: "data", detail: "text/html" }]);
        expect(scan("<svg xlink:href=data : text/html>").links).toEqual([{ scheme: "data", detail: "text/html" }]);
        expect(scan("<a href=https://example.com>").links).toEqual([{ scheme: "https", detail: "//example" }]);
        expect(scan("<a href=#top>").links).toEqual([{ scheme: "", detail: "" }]);
        expect(schemes("<a href=javascriptjavascriptjavascript:x>")).toEqual([""]);
        expect(schemes("<a data-src=x href=y>")).toHaveLength(2);
        expect(schemes("href=javascript:x and <b>")).toEqual([]);
    });
    it("costs time in step with the text", () => {
        expectLinearCost((n) => scan("<".repeat(n) + " href=" + " ".repeat(n) + "x"), { small: 2_000, large: 32_000 });
        expectLinearCost((n) => scan("<a href=" + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => scan("<a onx" + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => scan("<" + " ".repeat(n) + "x"), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => scan("<a on".repeat(n)), { small: 1_000, large: 20_000 });
        expectLinearCost((n) => scan("<a href=".repeat(n)), { small: 1_000, large: 20_000 });
    });
});

describe("readLabelledLine", () => {
    const labels = ["veredicto", "fundamento", "tema", "temas", "pregunta", "pregunta de fundamento"];
    const pieces = ["Veredicto", "pregunta", " de ", "fundamento", ":", "*", "_", "`", " ", "\t", "\r", "\u2028", "x", "tema", "s"];
    const sample = inputs(pieces, 8000, 9);

    it("reads the lines the expression it replaced read, to the same label and value", () => {
        const ordinary = ["Veredicto: coincide", "**Veredicto:** coincide", "_Fundamento_: sólido", " `Temas`: a; b ", "Pregunta  de   Fundamento : ¿x?", "Nada: x", "- Veredicto: x", "Veredicto", ":"];
        for (const line of [...ordinary, ...sample]) {
            const old = REFERENCE.label(line);
            const got = readLabelledLine(line, labels);
            expect(got ? [got.label, got.value] : null, JSON.stringify(line)).toEqual(old ? [old[1].toLowerCase().split(/\s+/).join(" "), old[2]] : null);
        }
    });
    it("costs time in step with the line", () => {
        expectLinearCost((n) => readLabelledLine(`Veredicto: x${" ".repeat(n)}\rx`, labels), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => readLabelledLine(`${"* ".repeat(n)}Veredicto: x`, labels), { small: 2_000, large: 64_000 });
    });
});

describe("trimChars", () => {
    it("trims like the expression it replaced did", () => {
        for (const text of ["", "x", "\"x\"", "'`x`'.", "...", "\"..\"", "a,.;", ".a.", ...inputs(["\"", "'", "`", ".", ",", "a", " "], 3000, 9)]) {
            expect(trimChars(text.trim(), "\"'`", "\"'`.,:;!?"), JSON.stringify(text)).toBe(REFERENCE.title(text));
        }
        expectLinearCost((n) => trimChars("T" + ".".repeat(n) + "x", "\"'`", "\"'`.,:;!?"), { small: 2_000, large: 64_000 });
    });
});

describe("the size limits follow what the product asks of models", () => {
    it("lets through the longest answer any model can write", () => {
        // 128,000 tokens is the largest output ceiling of a model the product knows.
        expect(charsForTokens(128_000)).toBe(640_000);
        expect(MODEL_TEXT_MAX_CHARS).toBeGreaterThanOrEqual(charsForTokens(128_000));
        expect(MODEL_TEXT_MAX_CHARS).toBeLessThanOrEqual(2 * 1024 * 1024);
    });
    it("reads a long answer well inside the limit in linear time", () => {
        const answer = (n: number) => "```json\n" + `{"a":"${"x ".repeat(n)}"}` + "\n```";
        expectLinearCost((n) => stripCodeFence(answer(n)), { small: 20_000, large: 400_000 });
        expectLinearCost((n) => findInlineCitations("[[a||b]] ".repeat(n)), { small: 10_000, large: 100_000 });
    });
});
