import { describe, expect, it } from "vitest";
import { firstXmlElement, scanXmlElements, xmlAttribute } from "../xmlScan";

const found = (xml: string, containers: string[], tags: string[] = []) => [...scanXmlElements(xml, containers, tags)];
const inners = (xml: string, containers: string[], tags: string[] = []) =>
    found(xml, containers, tags).map((element) => element.inner);

/** The time of `run` in milliseconds. */
function timed(run: () => unknown): number {
    const started = performance.now();
    run();
    return performance.now() - started;
}

describe("scanXmlElements", () => {
    it("finds an element with its attributes, body and closing tag, in document order", () => {
        const [first, second] = found('<w:p w:rsid="1"><w:r>a</w:r></w:p><w:p>b</w:p>', ["w:p"]);
        expect(first).toMatchObject({
            name: "w:p",
            attrs: ' w:rsid="1"',
            selfClosing: false,
            inner: "<w:r>a</w:r>",
            outer: '<w:p w:rsid="1"><w:r>a</w:r></w:p>',
        });
        expect(second.inner).toBe("b");
    });

    it("takes a self-closing start tag as an empty element", () => {
        const [empty, next] = found('<a:t/><a:t xml:space="preserve"/><a:t>x</a:t>', ["a:t"]);
        expect(empty).toMatchObject({ selfClosing: true, inner: "", outer: "<a:t/>", attrs: "/" });
        expect(found('<a:t/><a:t xml:space="preserve"/><a:t>x</a:t>', ["a:t"]).map((e) => e.selfClosing)).toEqual([
            true,
            true,
            false,
        ]);
        expect(next.selfClosing).toBe(true);
    });

    it("does not take a name for a longer one: w:t is not w:tab, w:tbl, w:tc or w:tr", () => {
        const xml = "<w:tab/><w:tbl><w:tr><w:tc>c</w:tc></w:tr></w:tbl><w:t>t</w:t><w:tcPr/>";
        expect(inners(xml, ["w:t"])).toEqual(["t"]);
        expect(inners(xml, ["w:tc"])).toEqual(["c"]);
        expect(inners(xml, ["w:tr"])).toEqual(["<w:tc>c</w:tc>"]);
        expect(found(xml, [], ["w:tab", "w:t"]).map((e) => e.name)).toEqual(["w:tab", "w:t"]);
    });

    it("keeps the word-boundary rule of the expressions it replaced: a non-word character may follow the name", () => {
        expect(inners("<w:t-x>a</w:t><w:t.y>b</w:t>", ["w:t"])).toEqual(["a", "b"]);
        expect(inners("<w:t_x>a</w:t><w:t1>b</w:t><w:tä>c</w:t>", ["w:t"])).toEqual(["c"]);
    });

    it("compares names as written: the case of a name is significant", () => {
        expect(inners("<A:T>a</A:T><a:T>b</a:T><a:t>c</a:t>", ["a:t"])).toEqual(["c"]);
        expect(inners("<a:t>a</A:T>", ["a:t"])).toEqual([]);
    });

    it("ends an element at the first closing tag, so a nested element of the same name is not balanced", () => {
        const [outer, ...rest] = found("<w:p>a<w:p>b</w:p>c</w:p>d", ["w:p"]);
        expect(outer.inner).toBe("a<w:p>b");
        expect(rest).toEqual([]);
    });

    it("ends a start tag at the first `>`, even inside a quoted attribute value", () => {
        const [element] = found('<a:t note="x>y">hi</a:t>', ["a:t"]);
        expect(element.attrs).toBe(' note="x');
        expect(element.inner).toBe('y">hi');
    });

    it("does not recognise comments or CDATA sections: what looks like an element inside one is found", () => {
        expect(inners("<!-- <a:t>c</a:t> --><![CDATA[<a:t>d</a:t>]]>", ["a:t"])).toEqual(["c", "d"]);
    });

    it("skips an element with no closing tag and still finds the others", () => {
        const xml = "<w:t>never closed<w:tab/><w:p>x</w:p><w:t>again";
        expect(found(xml, ["w:t", "w:p"], ["w:tab"]).map((e) => [e.name, e.inner])).toEqual([
            ["w:tab", ""],
            ["w:p", "x"],
        ]);
    });

    it("finds elements after one of another name that has no closing tag, and none of its own name after a missing one", () => {
        expect(inners("<w:p><w:tbl>t</w:tbl>", ["w:p", "w:tbl"])).toEqual(["t"]);
        expect(inners("<w:t>a</w:t><w:t>b<w:t>c</w:t>", ["w:t"])).toEqual(["a", "b<w:t>c"]);
    });

    it("finds a start tag only, for names without a body", () => {
        const tags = found('<w:br w:type="page"/><w:tab>text', [], ["w:br", "w:tab"]);
        expect(tags.map((t) => [t.name, t.attrs, t.outer, t.inner])).toEqual([
            ["w:br", ' w:type="page"/', '<w:br w:type="page"/>', ""],
            ["w:tab", "", "<w:tab>", ""],
        ]);
    });

    it("ends at a start tag that nothing closes with `>`", () => {
        expect(inners("<a:t>a</a:t><a:t b", ["a:t"])).toEqual(["a"]);
        expect(inners("<a:t b <a:t>c</a:t>", ["a:t"])).toEqual(["c"]);
    });

    it("reports where an element ends in the text", () => {
        const xml = "<a:t>a</a:t>tail";
        const [element] = found(xml, ["a:t"]);
        expect(xml.slice(element.end)).toBe("tail");
    });

    it("finds nothing in text without markup or without the name", () => {
        expect(found("plain text, 1 < 2 > 0", ["a:t"])).toEqual([]);
        expect(found("", ["a:t"])).toEqual([]);
        expect(firstXmlElement("<b>x</b>", ["a:t"])).toBeNull();
        expect(firstXmlElement("<b/><a:t>x</a:t><a:t>y</a:t>", ["a:t"])?.inner).toBe("x");
    });
});

describe("xmlAttribute", () => {
    it("reads the first double-quoted value of a name, as written", () => {
        expect(xmlAttribute(' w:val="a &amp; b" w:val="c"', "w:val")).toBe("a &amp; b");
        expect(xmlAttribute(' w:id="1" w:styleId="Heading1"', "w:styleId")).toBe("Heading1");
        expect(xmlAttribute(' w:val=""', "w:val")).toBe("");
    });

    it("needs the quotes and the equals sign as the old pattern did", () => {
        expect(xmlAttribute(" w:val='x'", "w:val")).toBeNull();
        expect(xmlAttribute(' w:val = "x"', "w:val")).toBeNull();
        expect(xmlAttribute(' w:val="unclosed', "w:val")).toBeNull();
        expect(xmlAttribute("", "w:val")).toBeNull();
    });

    it("does not take a name for the tail of a longer one", () => {
        expect(xmlAttribute(' xw:val="no" w:val="yes"', "w:val")).toBe("yes");
        expect(xmlAttribute(' w:val="x"', "val")).toBe("x");
        expect(xmlAttribute(' foo_val="x"', "val")).toBeNull();
    });
});

describe("the cost of a scan", () => {
    // Bounds are generous: the machine may be busy, and a quadratic scan of
    // inputs this size takes many seconds.
    const SMALL = 40_000;
    const LARGE = 160_000;
    const shapes: Record<string, (n: number) => string> = {
        "start tags with no closing tag": (n) => "<w:p>".repeat(n),
        "start tags never ended by `>`": (n) => "<w:p ".repeat(n),
        "start tags that all end at one far `>`": (n) => `${"<w:t ".repeat(n)}>`,
        "nested elements of one name": (n) => "<w:p>".repeat(n) + "x" + "</w:p>".repeat(n),
        "one huge attribute": (n) => `<w:p a="${"x".repeat(n * 5)}">t</w:p>`,
        "a long run of blanks": (n) => `<w:p>${" ".repeat(n * 5)}`,
        "tags of several names, none closed": (n) => "<w:t><w:tab/><w:p><w:tr>".repeat(n),
        "open angle brackets": (n) => "<".repeat(n * 5),
    };

    it.each(Object.entries(shapes))("reads %s in time proportional to its length", (_label, make) => {
        const run = (n: number) => timed(() => {
            for (const element of scanXmlElements(make(n), ["w:p", "w:t", "w:tr"], ["w:tab"])) void element.inner.length;
        });
        run(1_000);
        // The fastest of three runs: a pause of a busy machine slows one run, not all.
        const small = Math.min(run(SMALL), run(SMALL), run(SMALL));
        const large = Math.min(run(LARGE), run(LARGE));
        expect(small, `${SMALL} units took ${small.toFixed(0)} ms`).toBeLessThan(1_500);
        expect(large, `${LARGE} units took ${large.toFixed(0)} ms`).toBeLessThan(6_000);
        // Four times the input: a linear scan takes about four times as long, a quadratic one sixteen.
        expect(large / Math.max(small, 50), `ratio ${(large / Math.max(small, 50)).toFixed(1)}`).toBeLessThan(10);
    });

    it("finds the attribute of a huge start tag in time proportional to its length", () => {
        const attrs = (n: number) => ` a="${"x".repeat(n)}" ` + 'w:val="v"'.repeat(1);
        const small = Math.min(...[1, 2, 3].map(() => timed(() => xmlAttribute(attrs(2_000_000), "w:val"))));
        const large = Math.min(...[1, 2].map(() => timed(() => xmlAttribute(attrs(8_000_000), "w:val"))));
        expect(large).toBeLessThan(2_000);
        expect(large / Math.max(small, 50)).toBeLessThan(10);
    });
});
