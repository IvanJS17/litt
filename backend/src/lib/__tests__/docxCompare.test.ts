// The comparison engine, run for real in the isolated parser process, on
// synthetic contracts (fixtures/compare: invented parties, clauses, amounts).
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentRangeEnd, CommentRangeStart, CommentReference, Document, Packer, Paragraph, TextRun } from "docx";
import { COMPARE_AUTHOR, compareDocx, packComparePair } from "../docxCompare";
import { runIsolatedExtraction, stopExtractionProcess } from "../extraction/isolated";

const FIXTURES = path.join(__dirname, "fixtures", "compare");
const ab = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const fixture = (name: string) => ab(readFileSync(path.join(FIXTURES, name)));

async function documentXml(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return (await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string"));
}
const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

/** The text of each paragraph once every change is accepted or rejected. */
function view(xml: string, mode: "accept" | "reject"): string[] {
  const drop = mode === "accept" ? ["w:del", "w:moveFrom"] : ["w:ins", "w:moveTo"];
  let out = xml;
  for (const tag of drop) out = out.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"), "");
  return [...out.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)]
    .map((p) => [...p[0].matchAll(/<w:(?:t|delText)(?:\s[^>]*)?>([^<]*)<\/w:(?:t|delText)>/g)].map((t) => t[1]).join(""))
    .filter((text) => text.trim() !== "");
}

const PAIRS = [
  { name: "par1_arrendamiento", ins: 10, del: 9, fmt: 0 },
  { name: "par2_servicios", ins: 11, del: 4, fmt: 3 },
  { name: "par3_confidencialidad", ins: 3, del: 3, fmt: 0 },
];

// vitest.config turns isolation off; this file exists to test the parser process.
beforeEach(() => vi.stubEnv("EXTRACTION_ISOLATION", "on"));
afterEach(() => vi.unstubAllEnvs());
afterAll(stopExtractionProcess);

describe("docxCompare in the isolated parser", () => {
  it.each(PAIRS)("$name: counts the changes and round-trips", async ({ name, ins, del, fmt }) => {
    const original = fixture(`${name}_original.docx`);
    const modified = fixture(`${name}_negociado.docx`);
    const out = await runIsolatedExtraction("docxCompare", async () => packComparePair(original, modified), { fileType: "docx" });
    const xml = await documentXml(out);
    expect(count(xml, /<w:ins[\s>]/g)).toBe(ins);
    expect(count(xml, /<w:del[\s>]/g)).toBe(del);
    expect(count(xml, /<w:rPrChange[\s>]/g)).toBe(fmt);
    // Accept all gives the negotiated file, reject all the original.
    expect(view(xml, "accept")).toEqual(view(await documentXml(modified), "accept"));
    expect(view(xml, "reject")).toEqual(view(await documentXml(original), "accept"));
    // Authored by LiTT, dated now (the engine's own default is 2000-01-01).
    expect(new Set(xml.match(/w:author="[^"]*"/g))).toEqual(new Set([`w:author="${COMPARE_AUTHOR}"`]));
    const year = xml.match(/w:date="(\d{4})/)![1];
    expect(Number(year)).toBeGreaterThanOrEqual(2026);
  }, 120_000);

  it("keeps a table, the footer and the comments of the inputs", async () => {
    const out = await compareDocx(packComparePair(fixture("par2_servicios_original.docx"), fixture("par2_servicios_negociado.docx")));
    const zip = await JSZip.loadAsync(out);
    expect(count(await zip.file("word/document.xml")!.async("string"), /<w:tbl>/g)).toBeGreaterThan(0);
    expect(Object.keys(zip.files).some((n) => /^word\/footer\d*\.xml$/.test(n))).toBe(true);
    const withComments = await compareDocx(packComparePair(fixture("par3_confidencialidad_original.docx"), fixture("par3_confidencialidad_negociado.docx")));
    const inputComments = await (await JSZip.loadAsync(fixture("par3_confidencialidad_original.docx"))).file("word/comments.xml")!.async("string");
    const outComments = await (await JSZip.loadAsync(withComments)).file("word/comments.xml")!.async("string");
    expect(count(inputComments, /<w:comment[\s>]/g)).toBe(2);
    expect(count(outComments, /<w:comment[\s>]/g)).toBe(2);
  }, 120_000);

  it("a file that is not Word fails instead of returning a document", async () => {
    const junk = ab(Buffer.from("not a zip"));
    await expect(compareDocx(packComparePair(junk, junk))).rejects.toBeDefined();
  }, 120_000);

  it("refuses a malformed pack", async () => {
    await expect(compareDocx(ab(Buffer.from([0xff, 0xff, 0xff, 0xff, 1])))).rejects.toThrow("malformed");
  });

  // Known limitation (docs/document-compare.md): a comment anchored on text that changes. The
  // test records what the engine does; LiTT does not post-process it.
  it("records what happens to a comment anchored on text that changes", async () => {
    const build = async (text: string) =>
      Packer.toBuffer(
        new Document({
          comments: { children: [{ id: 0, author: "Revisor Sintético", date: new Date("2026-01-01T00:00:00Z"), children: [new Paragraph("revisar el plazo")] }] },
          sections: [{ children: [new Paragraph({ children: [new TextRun("El plazo es de "), new CommentRangeStart(0), new TextRun(text), new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] }), new TextRun(" días.")] })] }],
        }),
      );
    const out = await compareDocx(packComparePair(ab(await build("treinta")), ab(await build("sesenta"))));
    const zip = await JSZip.loadAsync(out);
    const comments = (await zip.file("word/comments.xml")?.async("string")) ?? "";
    const xml = await zip.file("word/document.xml")!.async("string");
    const copies = count(comments, /<w:comment[\s>]/g);
    // The change itself is marked either way.
    expect(count(xml, /<w:ins[\s>]/g)).toBeGreaterThan(0);
    expect(count(xml, /<w:del[\s>]/g)).toBeGreaterThan(0);
    // Measured on this synthetic case: one comment in, one out. A real 36-comment contract
    // came out with 2 duplicated; that is not reproduced by a case this small.
    expect(copies).toBe(1);
  }, 120_000);
});
