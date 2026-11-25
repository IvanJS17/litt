import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractPresentationText } from "../officeText";

async function slideXml(xml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function slide(text: string): Promise<Buffer> {
  return slideXml(`<p:sld><a:t>${text}</a:t></p:sld>`);
}

describe("extractPresentationText entities", () => {
  it("decodes each entity once, so the text &lt; is not turned into <", async () => {
    expect(await extractPresentationText(await slide("&amp;lt; &amp;amp; &amp;#65;"))).toBe(
      "## Slide 1\n\n&lt; &amp; &#65;",
    );
  });

  it("still decodes the entities and character references", async () => {
    expect(await extractPresentationText(await slide("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;"))).toBe(
      "## Slide 1\n\na & b <c> \"d\" 'e' AB",
    );
  });
});

describe("extractPresentationText of well-formed slides", () => {
  it("reads runs, preserved blanks, attributes, line breaks, several slides in natural order", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide10.xml",
      '<p:sld><p:txBody><a:p><a:r><a:rPr lang="es-MX"/><a:t>Ten</a:t></a:r></a:p></p:txBody></p:sld>',
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<p:sld><p:txBody><a:p><a:r><a:t xml:space="preserve"> Two </a:t></a:r><a:br/><a:r><a:t>&amp; more</a:t></a:r></a:p>
        <a:p><a:r><a:t>

          spaced
        </a:t></a:r></a:p><a:p><a:r><a:t>   </a:t></a:r></a:p><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sld>`,
    );
    zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>");
    zip.file("ppt/slides/slide3.xml", "<p:sld><a:p><a:endParaRPr/></a:p></p:sld>");
    zip.file("ppt/slides/_rels/slide1.xml.rels", "<Relationships/>");
    const text = await extractPresentationText(await zip.generateAsync({ type: "nodebuffer" }));
    expect(text).toBe(
      "## Slide 1\n\nOne\n\n## Slide 2\n\nTwo\n& more\nspaced\n\n## Slide 4\n\nTen",
    );
  });

  it("reads an empty self-closing text tag as empty, without the markup that follows it", async () => {
    const text = await extractPresentationText(
      await slideXml(
        '<p:sld><a:p><a:r><a:t/></a:r><a:r><a:t>After</a:t></a:r></a:p><a:p><a:r><a:t xml:space="preserve"/></a:r><a:r><a:t>Last</a:t></a:r></a:p></p:sld>',
      ),
    );
    expect(text).toBe("## Slide 1\n\nAfter\nLast");
  });

  it("reads a presentation with no text as empty", async () => {
    expect(await extractPresentationText(await slideXml("<p:sld/>"))).toBe("");
  });
});

describe("extractPresentationText cost", () => {
  // Bounds are generous: the machine may be busy, and the quadratic scan this
  // replaced takes many seconds on inputs this size.
  const shapes: Record<string, (n: number) => string> = {
    "text tags with no closing tag": (n) => `<p:sld>${"<a:t>".repeat(n)}</p:sld>`,
    "text tags with text and no closing tag": (n) => `<p:sld>${"<a:t>word ".repeat(n)}</p:sld>`,
    "text tags never ended by >": (n) => `<p:sld>${"<a:t ".repeat(n)}</p:sld>`,
  };

  async function elapsed(make: (n: number) => string, n: number): Promise<number> {
    const buffer = await slideXml(make(n));
    const started = performance.now();
    await extractPresentationText(buffer);
    return performance.now() - started;
  }

  it.each(Object.entries(shapes))(
    "reads %s in time proportional to its length",
    async (_label, make) => {
      await elapsed(make, 200);
      // The fastest of three runs: a pause of a busy machine slows one run, not all.
      const small = Math.min(await elapsed(make, 10_000), await elapsed(make, 10_000), await elapsed(make, 10_000));
      expect(small, `10000 tags took ${small.toFixed(0)} ms`).toBeLessThan(1_500);
      const large = Math.min(await elapsed(make, 40_000), await elapsed(make, 40_000));
      expect(large, `40000 tags took ${large.toFixed(0)} ms`).toBeLessThan(6_000);
      const ratio = large / Math.max(small, 50);
      expect(ratio, `ratio ${ratio.toFixed(1)}`).toBeLessThan(10);
    },
    120_000,
  );
});
