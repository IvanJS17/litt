import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfPageTexts } from "../pdfText";
import { copyPdfPages } from "../pdfSplit";
import { syntheticPdf } from "./pdfFixtures";

describe("extractPdfPageTexts", () => {
  it("returns the text of each page without the [Page N] heading and lists the unread pages", async () => {
    const pdf = await syntheticPdf(["Alpha one", null, "Gamma three"]);
    const read = await extractPdfPageTexts(pdf);
    expect(read.pages).toEqual(["Alpha one", "", "Gamma three"]);
    expect(read.unread).toEqual([2]);
  });

  it("fills a page without a text layer from the scan reading, and keeps a failed page unread", async () => {
    const pdf = await syntheticPdf(["Alpha one", null, null]);
    const read = await extractPdfPageTexts(pdf, { pages: [{ page: 2, text: "Read by OCR" }, { page: 3, text: "Late" }], failedPages: [3] });
    expect(read.pages).toEqual(["Alpha one", "Read by OCR", ""]);
    expect(read.unread).toEqual([3]);
  });

  it("throws for bytes that are not a PDF", async () => {
    await expect(extractPdfPageTexts(new TextEncoder().encode("not a pdf").buffer as ArrayBuffer)).rejects.toThrow();
  });
});

describe("copyPdfPages", () => {
  it("makes one PDF per group holding the original pages in the order given", async () => {
    const pdf = await syntheticPdf(["Page A", "Page B", "Page C", "Page D"]);
    const out = await copyPdfPages(pdf, [[3, 1], [2]]);
    expect(out).toHaveLength(2);
    const first = await extractPdfPageTexts(out[0].buffer.slice(out[0].byteOffset, out[0].byteOffset + out[0].byteLength) as ArrayBuffer);
    expect(first.pages).toEqual(["Page C", "Page A"]);
    const second = await PDFDocument.load(out[1]);
    expect(second.getPageCount()).toBe(1);
  });

  it("rejects a page outside the file, an empty group and no groups", async () => {
    const pdf = await syntheticPdf(["x", "y"]);
    await expect(copyPdfPages(pdf, [[3]])).rejects.toThrow("split_pages_invalid");
    await expect(copyPdfPages(pdf, [[0]])).rejects.toThrow("split_pages_invalid");
    await expect(copyPdfPages(pdf, [[1.5]])).rejects.toThrow("split_pages_invalid");
    await expect(copyPdfPages(pdf, [[]])).rejects.toThrow("split_pages_invalid");
    await expect(copyPdfPages(pdf, [])).rejects.toThrow("split_groups_invalid");
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(copyPdfPages(new TextEncoder().encode("nope").buffer as ArrayBuffer, [[1]])).rejects.toThrow("document_split_pdf_unreadable");
  });
});
