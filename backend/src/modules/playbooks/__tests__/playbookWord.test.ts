import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_WORD_PART_BYTES, extractPlaybookWordStructure } from "../playbooks.word";

async function sampleDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Limitation of Liability</w:t></w:r></w:p>
    <w:tbl><w:tr>
      <w:tc><w:p><w:r><w:t>Concept</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Preferred clause</w:t></w:r></w:p><w:p><w:r><w:t>Liability is capped at fees paid.</w:t></w:r></w:p></w:tc>
    </w:tr></w:tbl>
    <w:p><w:r><w:t>Escalate uncapped liability to the General Counsel.</w:t></w:r></w:p>
  </w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("playbook Word extraction", () => {
  it.each([
    ["&amp;lt; &amp;gt; &amp;quot; &amp;apos;", "&lt; &gt; &quot; &apos;"],
    ["&amp;#65; &amp;#x41; &#38;#x41;", "&#65; &#x41; &#x41;"],
    ["&amp;amp; &#38;lt; &#x26;lt;", "&amp; &lt; &lt;"],
    ["&amp; &lt; &gt; &quot; &apos; &#65; &#x41;", "& < > \" ' A A"],
  ])("decodes each XML reference once: %s", async (encoded, decoded) => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:pStyle w:val="${encoded}"/></w:pPr><w:r><w:t>${encoded}</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>${encoded}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`);

    const structure = await extractPlaybookWordStructure(await zip.generateAsync({ type: "nodebuffer" }));
    expect(structure.sources[0]).toMatchObject({ text: decoded, style: decoded });
    expect(structure.sources[1]).toMatchObject({ text: decoded });
  });

  it("preserves heading and table-cell structure with stable source references", async () => {
    const structure = await extractPlaybookWordStructure(await sampleDocx());
    expect(structure.blocks).toHaveLength(3);
    expect(structure.blocks[0]).toMatchObject({ kind: "paragraph", sourceRef: "P1", level: 1, text: "Limitation of Liability" });
    expect(structure.blocks[1]).toMatchObject({ kind: "table", index: 1 });
    expect(structure.sources.map((source) => source.id)).toEqual(["P1", "T1R1C1", "T1R1C2", "P2"]);
    expect(structure.text).toContain("[T1R1C2] Preferred clause\nLiability is capped at fees paid.");
  });

  it.each([
    [
      "line breaks",
      "<w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r>",
      "Line one\nLine two",
    ],
    [
      "tabs",
      "<w:r><w:t>Cap</w:t><w:tab/><w:t>Fees paid</w:t></w:r>",
      "Cap\tFees paid",
    ],
    [
      "carriage returns",
      "<w:r><w:t>One</w:t><w:cr/><w:t>Two</w:t></w:r>",
      "One\nTwo",
    ],
    [
      "page breaks",
      '<w:r><w:t>Before</w:t><w:br w:type="page"/><w:t>After</w:t></w:r>',
      "Before\nAfter",
    ],
    [
      "empty text runs",
      "<w:r><w:t/><w:t>Real text</w:t></w:r>",
      "Real text",
    ],
    [
      "preserved whitespace across runs",
      '<w:r><w:t xml:space="preserve">Hello </w:t><w:t>world</w:t></w:r>',
      "Hello world",
    ],
  ])("keeps the text that follows %s", async (_label, runs, expected) => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${runs}</w:p></w:body></w:document>`);
    const structure = await extractPlaybookWordStructure(await zip.generateAsync({ type: "nodebuffer" }));
    expect(structure.sources[0]?.text).toBe(expected);
  });

  it("keeps every cell of a multi-line table row", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>Standard</w:t><w:br/><w:t>Mutual cap</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Fallback</w:t><w:br/><w:t>Cap at 2x fees</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>
    </w:body></w:document>`);
    const structure = await extractPlaybookWordStructure(await zip.generateAsync({ type: "nodebuffer" }));
    expect(structure.sources.map((source) => source.text)).toEqual([
      "Standard\nMutual cap",
      "Fallback\nCap at 2x fees",
    ]);
  });

  it("rejects archives without a readable Word body", async () => {
    const zip = new JSZip();
    zip.file("empty.txt", "empty");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(extractPlaybookWordStructure(buffer)).rejects.toThrow(/document body/i);
  });
});

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string, styles?: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  if (styles !== undefined) zip.file("word/styles.xml", styles);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("playbook Word extraction of well-formed documents", () => {
  const styles = `<?xml version="1.0"?><w:styles ${NS}><w:docDefaults><w:rPrDefault/></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="Heading 2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body Text"/></w:style>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="table" w:styleId="Grid"><w:basedOn w:val="TableNormal"/></w:style>
    <w:latentStyles><w:lsdException w:name="Normal"/></w:latentStyles></w:styles>`;

  it("reads text runs, preserved blanks, empty and self-closing runs, entities, tabs and breaks", async () => {
    const structure = await extractPlaybookWordStructure(
      await docx(
        `<w:p w:rsidR="00A1"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Fees </w:t></w:r><w:r><w:t/></w:r><w:r><w:t>&amp; costs &lt;5%&gt;</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="Titulo2"/></w:pPr><w:r><w:t>Cap</w:t><w:tab/><w:t>1.5x</w:t><w:br/><w:t>   </w:t><w:br w:type="page"/><w:t>Next  </w:t><w:cr/><w:t>Last</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="Body"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Numbered item</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="Unknown9"/></w:pPr><w:r><w:t>Style missing from styles</w:t></w:r></w:p>
         <w:p/><w:p><w:r><w:t></w:t></w:r></w:p>
         <w:sectPr><w:pgSz w:w="11906"/></w:sectPr>`,
        styles,
      ),
    );
    expect(structure).toMatchInlineSnapshot(`
      {
        "blocks": [
          {
            "kind": "paragraph",
            "level": 1,
            "sourceRef": "P1",
            "style": "heading 1",
            "text": "Fees & costs <5%>",
          },
          {
            "kind": "paragraph",
            "level": 2,
            "sourceRef": "P2",
            "style": "Heading 2",
            "text": "Cap	1.5x

      Next
      Last",
          },
          {
            "kind": "paragraph",
            "level": 3,
            "sourceRef": "P3",
            "style": "Body Text",
            "text": "Numbered item",
          },
          {
            "kind": "paragraph",
            "level": null,
            "sourceRef": "P4",
            "style": "Unknown9",
            "text": "Style missing from styles",
          },
        ],
        "format": "docx",
        "sources": [
          {
            "id": "P1",
            "kind": "paragraph",
            "level": 1,
            "style": "heading 1",
            "text": "Fees & costs <5%>",
          },
          {
            "id": "P2",
            "kind": "paragraph",
            "level": 2,
            "style": "Heading 2",
            "text": "Cap	1.5x

      Next
      Last",
          },
          {
            "id": "P3",
            "kind": "paragraph",
            "level": 3,
            "style": "Body Text",
            "text": "Numbered item",
          },
          {
            "id": "P4",
            "kind": "paragraph",
            "level": null,
            "style": "Unknown9",
            "text": "Style missing from styles",
          },
        ],
        "text": "[P1] # Fees & costs <5%>

      [P2] ## Cap	1.5x

      Next
      Last

      [P3] ### Numbered item

      [P4] Style missing from styles",
      }
    `);
  });

  it("reads tables, nested tables, cells of several paragraphs and rows without cells", async () => {
    const structure = await extractPlaybookWordStructure(
      await docx(
        `<w:p><w:r><w:t>Before</w:t></w:r></w:p>
         <w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>
           <w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:p><w:r><w:t>A1b</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>C1</w:t><w:br/><w:t>line</w:t></w:r></w:p></w:tc></w:tr>
           <w:tr></w:tr>
           <w:tr><w:tc><w:p><w:r><w:t>A3</w:t></w:r></w:p></w:tc></w:tr>
         </w:tbl>
         <w:p><w:r><w:t>Between</w:t></w:r></w:p>
         <w:tbl><w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
         <w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>
         <w:p><w:r><w:t>After</w:t></w:r></w:p>`,
      ),
    );
    expect({ ...structure, text: structure.text.split("\n") }).toMatchInlineSnapshot(`
      {
        "blocks": [
          {
            "kind": "paragraph",
            "level": null,
            "sourceRef": "P1",
            "style": null,
            "text": "Before",
          },
          {
            "index": 1,
            "kind": "table",
            "rows": [
              [
                {
                  "sourceRef": "T1R1C1",
                  "text": "A1
      A1b",
                },
                {
                  "sourceRef": "T1R1C2",
                  "text": "",
                },
                {
                  "sourceRef": "T1R1C3",
                  "text": "C1
      line",
                },
              ],
              [
                {
                  "sourceRef": "T1R3C1",
                  "text": "A3",
                },
              ],
            ],
          },
          {
            "kind": "paragraph",
            "level": null,
            "sourceRef": "P2",
            "style": null,
            "text": "Between",
          },
          {
            "index": 2,
            "kind": "table",
            "rows": [
              [
                {
                  "sourceRef": "T2R1C1",
                  "text": "Inner",
                },
              ],
            ],
          },
          {
            "kind": "paragraph",
            "level": null,
            "sourceRef": "P3",
            "style": null,
            "text": "After inner",
          },
          {
            "index": 3,
            "kind": "table",
            "rows": [
              [
                {
                  "sourceRef": "T3R1C1",
                  "text": "",
                },
              ],
            ],
          },
          {
            "kind": "paragraph",
            "level": null,
            "sourceRef": "P4",
            "style": null,
            "text": "After",
          },
        ],
        "format": "docx",
        "sources": [
          {
            "id": "P1",
            "kind": "paragraph",
            "level": null,
            "style": null,
            "text": "Before",
          },
          {
            "column": 1,
            "id": "T1R1C1",
            "kind": "table_cell",
            "level": null,
            "row": 1,
            "style": null,
            "table": 1,
            "text": "A1
      A1b",
          },
          {
            "column": 3,
            "id": "T1R1C3",
            "kind": "table_cell",
            "level": null,
            "row": 1,
            "style": null,
            "table": 1,
            "text": "C1
      line",
          },
          {
            "column": 1,
            "id": "T1R3C1",
            "kind": "table_cell",
            "level": null,
            "row": 3,
            "style": null,
            "table": 1,
            "text": "A3",
          },
          {
            "id": "P2",
            "kind": "paragraph",
            "level": null,
            "style": null,
            "text": "Between",
          },
          {
            "column": 1,
            "id": "T2R1C1",
            "kind": "table_cell",
            "level": null,
            "row": 1,
            "style": null,
            "table": 2,
            "text": "Inner",
          },
          {
            "id": "P3",
            "kind": "paragraph",
            "level": null,
            "style": null,
            "text": "After inner",
          },
          {
            "id": "P4",
            "kind": "paragraph",
            "level": null,
            "style": null,
            "text": "After",
          },
        ],
        "text": [
          "[P1] Before",
          "",
          "[T1R1C1] A1",
          "A1b | [T1R1C2]  | [T1R1C3] C1",
          "line",
          "[T1R3C1] A3",
          "",
          "[P2] Between",
          "",
          "[T2R1C1] Inner",
          "",
          "[P3] After inner",
          "",
          "[T3R1C1] ",
          "",
          "[P4] After",
        ],
      }
    `);
  });

  it("keeps a table that follows an empty self-closing paragraph a table", async () => {
    const structure = await extractPlaybookWordStructure(
      await docx(
        `<w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>`,
      ),
    );
    expect(structure.sources.map((source) => [source.id, source.text])).toEqual([
      ["T1R1C1", "Cell"],
      ["P1", "After"],
    ]);
  });

  it("reads an empty body as having no readable text", async () => {
    await expect(extractPlaybookWordStructure(await docx(""))).rejects.toThrow(/body could not be read/i);
    await expect(extractPlaybookWordStructure(await docx("<w:p/>"))).rejects.toThrow(/readable text/i);
  });

  it("reads a document without a styles part", async () => {
    const structure = await extractPlaybookWordStructure(
      await docx(`<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Plain</w:t></w:r></w:p>`),
    );
    expect(structure.blocks).toEqual([
      { kind: "paragraph", sourceRef: "P1", text: "Plain", style: "Heading3", level: 3 },
    ]);
  });
});

describe("playbook Word extraction cost", () => {
  // Bounds are generous: the machine may be busy, and the quadratic scans
  // these replaced take many seconds on inputs this size.
  const SMALL_MS = 1_500;
  const LARGE_MS = 6_000;
  const shapes: Record<string, { units: number; build: (n: number) => Promise<Buffer> }> = {
    "paragraphs with no closing tag": { units: 10_000, build: (n) => docx("<w:p>".repeat(n)) },
    "text runs with no closing tag": { units: 10_000, build: (n) => docx(`<w:p>${"<w:t>".repeat(n)}</w:p>`) },
    "rows with no closing tag": { units: 10_000, build: (n) => docx(`<w:tbl>${"<w:tr>".repeat(n)}</w:tbl>`) },
    "cells with no closing tag": { units: 10_000, build: (n) => docx(`<w:tbl><w:tr>${"<w:tc>".repeat(n)}</w:tr></w:tbl>`) },
    "start tags never ended by >": { units: 10_000, build: (n) => docx("<w:p ".repeat(n)) },
    "text run start tags that all end at one far >": {
      units: 10_000,
      build: (n) => docx(`<w:p>${"<w:t ".repeat(n)}></w:p>`),
    },
    "a long run of blanks inside a text run": {
      units: 40_000,
      build: (n) => docx(`<w:p><w:r><w:t>${" ".repeat(n)}x</w:t></w:r></w:p>`),
    },
    "a long run of tabs and blanks with no line break after": {
      units: 40_000,
      build: (n) => docx(`<w:p><w:r><w:t>${" \t".repeat(n / 2)}x</w:t></w:r></w:p>`),
    },
    "style names with no closing tag": {
      units: 10_000,
      build: (n) =>
        docx("<w:p><w:r><w:t>x</w:t></w:r></w:p>", `<w:styles>${'<w:style w:styleId="A">'.repeat(n)}</w:styles>`),
    },
    "style names that never end": {
      units: 10_000,
      build: (n) =>
        docx("<w:p><w:r><w:t>x</w:t></w:r></w:p>", `<w:styles><w:style w:styleId="A">${"<w:name ".repeat(n)}</w:style></w:styles>`),
    },
    "a very long style name used by many paragraphs": {
      units: 5_000,
      build: (n) =>
        docx(
          '<w:p><w:pPr><w:pStyle w:val="Long"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'.repeat(n),
          `<w:styles><w:style w:styleId="Long"><w:name w:val="${"z".repeat(2_000_000)}"/></w:style></w:styles>`,
        ),
    },
  };

  async function elapsed(build: (n: number) => Promise<Buffer>, n: number): Promise<number> {
    const buffer = await build(n);
    const started = performance.now();
    await extractPlaybookWordStructure(buffer).catch(() => undefined);
    return performance.now() - started;
  }

  it.each(Object.entries(shapes))(
    "reads %s in time proportional to its length",
    async (_label, { units, build }) => {
      await elapsed(build, 200);
      // The fastest of three runs: a pause of a busy machine slows one run, not all.
      const small = Math.min(await elapsed(build, units), await elapsed(build, units), await elapsed(build, units));
      expect(small, `${units} units took ${small.toFixed(0)} ms`).toBeLessThan(SMALL_MS);
      const large = Math.min(await elapsed(build, units * 4), await elapsed(build, units * 4));
      expect(large, `${units * 4} units took ${large.toFixed(0)} ms`).toBeLessThan(LARGE_MS);
      // Four times the input: a linear scan takes about four times as long, a quadratic one sixteen.
      const ratio = large / Math.max(small, 50);
      expect(ratio, `ratio ${ratio.toFixed(1)}`).toBeLessThan(10);
    },
    120_000,
  );
});

describe("playbook Word extraction size bound", () => {
  const blanks = " ".repeat(MAX_WORD_PART_BYTES + 1);

  it("refuses a body that inflates past the bound before scanning it", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document ${NS}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p>${blanks}</w:body></w:document>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(buffer.byteLength).toBeLessThan(1024 * 1024);
    await expect(extractPlaybookWordStructure(buffer)).rejects.toThrow(/too large/i);
  }, 120_000);

  it("refuses a body whose header declares a small size while it inflates past the bound", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document ${NS}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p>${blanks}</w:body></w:document>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    // The uncompressed size of the body, as the central directory and the local header write it, rewritten to 100.
    const name = Buffer.from("word/document.xml");
    buffer.writeUInt32LE(100, buffer.lastIndexOf(name) - 46 + 24);
    buffer.writeUInt32LE(100, buffer.indexOf(name) - 30 + 22);
    await expect(extractPlaybookWordStructure(buffer)).rejects.toThrow(/too large/i);
  }, 120_000);

  it("refuses a styles part that inflates past the bound", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document ${NS}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`);
    zip.file("word/styles.xml", `<w:styles>${blanks}</w:styles>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await expect(extractPlaybookWordStructure(buffer)).rejects.toThrow(/too large/i);
  }, 120_000);
});
