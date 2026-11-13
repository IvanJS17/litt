import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractPresentationText } from "../officeText";

async function slide(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><a:t>${text}</a:t></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
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
