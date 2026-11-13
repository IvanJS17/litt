// The parsers the isolated extraction process may run, by name. Everything here
// does CPU-bound work on the whole file, so it runs outside the calling process (see
// isolated.ts). Keep imports parser-only: this module is all the parser process loads.

import { extractDocxBodyText } from "../docxTrackedChanges";
import { compareDocx } from "../docxCompare";
import { docxToMarkdown } from "../docxMarkdown";
import { inspectDocx } from "../docxInventory";
import { extractPresentationText } from "../officeText";
import { extractLegacyOfficeText, extractPdfPageTexts, extractPdfTextForModel, findTextlessPdfPages } from "../pdfText";
import { copyPdfPages } from "../pdfSplit";
import { spreadsheetToLLMText } from "../spreadsheet";
import { decodeMarkdownBytes } from "../documentTypes";
import { extractDocumentMarkdown } from "./documentMarkdown";
import { extractDocumentText } from "./documentText";
import type { OcrFill } from "../ocr/pages";

async function mammothRawText(bytes: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

export const EXTRACTION_OPS = {
  /** Search index text (document.extract_text). */
  documentText: (bytes: ArrayBuffer, fileType: string, ocr?: OcrFill) =>
    extractDocumentText(bytes, fileType, ocr),
  /** Tabular review source markdown. */
  documentMarkdown: (bytes: ArrayBuffer, fileType: string, ocr?: OcrFill) =>
    extractDocumentMarkdown(bytes, fileType, ocr),
  /** A person's Word → Markdown conversion. Unlike documentMarkdown it throws on an unreadable file. */
  docxMarkdown: (bytes: ArrayBuffer) => docxToMarkdown(bytes),
  /** A person's comparison of two Word files: one packed buffer in (see packComparePair), the redlined .docx out. Loads the WASM engine, so it runs here, bounded by the parser's limits. */
  docxCompare: (bytes: ArrayBuffer) => compareDocx(bytes),
  /** What a conversion would lose from a Word file. Unzips the package, so it runs here, bounded by the parser's size, time and memory limits. */
  docxInventory: (bytes: ArrayBuffer) => inspectDocx(bytes),
  /** The pages of a PDF with no text layer: the only ones a scan reading sends. */
  pdfTextlessPages: (bytes: ArrayBuffer) => findTextlessPdfPages(bytes),
  /** Text of each page (a scan reading merged in) and the pages still unread: what Split reads. */
  pdfPageTexts: (bytes: ArrayBuffer, _fileType: string, ocr?: OcrFill) => extractPdfPageTexts(bytes, ocr),
  /** One new PDF per group of 1-indexed pages (args.groups), copying the original pages. */
  pdfCopyPages: (bytes: ArrayBuffer, _fileType: string, _ocr?: OcrFill, args?: { groups: number[][] }) =>
    copyPdfPages(bytes, args?.groups ?? []),
  /** read_document views, one per file type. */
  pdfForModel: (bytes: ArrayBuffer) => extractPdfTextForModel(bytes),
  // The same accepted view the edit_document matcher anchors against, with
  // mammoth as the fallback when it comes back empty.
  docxText: async (bytes: ArrayBuffer) =>
    (await extractDocxBodyText(Buffer.from(bytes))) || mammothRawText(bytes),
  spreadsheet: async (bytes: ArrayBuffer) =>
    spreadsheetToLLMText(Buffer.from(bytes)),
  presentation: (bytes: ArrayBuffer) =>
    extractPresentationText(Buffer.from(bytes)),
  /** A Markdown file is its own text. */
  markdownText: (bytes: ArrayBuffer) => decodeMarkdownBytes(bytes),
  legacyOfficeText: (bytes: ArrayBuffer) => extractLegacyOfficeText(bytes),
  rawText: (bytes: ArrayBuffer) => mammothRawText(bytes),
};

export type ExtractionOps = typeof EXTRACTION_OPS;
export type ExtractionOp = keyof ExtractionOps;
