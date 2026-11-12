// Markdown views of source documents for tabular review. Parser-only imports:
// this module is loaded inside the isolated extraction worker.

import { docxToPdf } from "../convert";
import { docxToMarkdown } from "../docxMarkdown";
import {
    decodeMarkdownBytes,
    isMarkdownDocumentType,
    isPresentationDocumentType,
    isSpreadsheetDocumentType,
    isWordDocumentType,
} from "../documentTypes";
import { extractPresentationText } from "../officeText";
import { loadPdfjs } from "../pdfjs";
import { spreadsheetToLLMText } from "../spreadsheet";
import { splitOcrPages, type OcrFill } from "../ocr/pages";

/**
 * Route a document buffer to the right text extractor for its file type:
 * PDFs and DOCX extract directly; spreadsheets go through SheetJS; PPTX has a
 * native XML extractor; remaining Office types take the LibreOffice → PDF
 * detour.
 */
export async function extractDocumentMarkdown(
    buf: ArrayBuffer,
    fileType: string | null | undefined,
    ocr?: OcrFill,
): Promise<string> {
    const normalizedType = (fileType ?? "").toLowerCase();
    if (normalizedType === "pdf") return extractPdfMarkdown(buf, ocr);
    if (isMarkdownDocumentType(normalizedType)) return decodeMarkdownBytes(buf);
    if (normalizedType === "docx") return extractDocxMarkdown(buf);
    if (isSpreadsheetDocumentType(normalizedType)) {
        // SheetJS handles .xlsx/.xlsm/.xls directly, no PDF detour.
        return spreadsheetToLLMText(Buffer.from(buf));
    }
    if (normalizedType === "pptx") {
        return extractPresentationText(Buffer.from(buf));
    }
    if (
        isPresentationDocumentType(normalizedType) ||
        isWordDocumentType(normalizedType)
    ) {
        const pdfBuf = await docxToPdf(Buffer.from(buf));
        const pdfArrayBuffer = pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
        ) as ArrayBuffer;
        return extractPdfMarkdown(pdfArrayBuffer);
    }
    return extractDocxMarkdown(buf);
}

export async function extractPdfMarkdown(buf: ArrayBuffer, ocr?: OcrFill): Promise<string> {
    try {
        const pdfjsLib = await loadPdfjs();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
            .promise;
        const pages: string[] = [];
        // A scan reading stands in for the pages that have no text layer.
        const read = ocr ? splitOcrPages(ocr.markdown, pdf.numPages) : null;
        const failed = new Set(ocr?.failedPages ?? []);
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const text = tc.items
                .filter((it): it is { str: string } => "str" in it)
                .map((it) => it.str)
                .join(" ")
                .trim();
            const scanned = !text && read && !failed.has(i) ? read[i - 1] : "";
            if (text || scanned) pages.push(`## Page ${i}\n\n${text || scanned}`);
        }
        return pages.join("\n\n");
    } catch {
        return "";
    }
}

export async function extractDocxMarkdown(buf: ArrayBuffer): Promise<string> {
    try {
        return await docxToMarkdown(buf);
    } catch {
        return "";
    }
}
