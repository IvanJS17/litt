import { describe, expect, it } from "vitest";
import {
    ALLOWED_DOCUMENT_TYPES,
    ALLOWED_DOCUMENT_TYPES_LABEL,
    contentTypeForDocumentType,
    decodeMarkdownBytes,
    isMarkdownDocumentType,
    isPresentationDocumentType,
    isSpreadsheetDocumentType,
    isWordDocumentType,
    shouldConvertToPdf,
} from "../documentTypes";

describe("ALLOWED_DOCUMENT_TYPES", () => {
    it("matches the human-readable label exactly", () => {
        expect([...ALLOWED_DOCUMENT_TYPES].sort()).toEqual(
            ALLOWED_DOCUMENT_TYPES_LABEL.split(", ").sort(),
        );
    });
});

describe("isWordDocumentType", () => {
    it("recognizes docx and doc, case-insensitively", () => {
        expect(isWordDocumentType("docx")).toBe(true);
        expect(isWordDocumentType("doc")).toBe(true);
        expect(isWordDocumentType("DOCX")).toBe(true);
    });

    it("rejects other types and missing input", () => {
        expect(isWordDocumentType("pdf")).toBe(false);
        expect(isWordDocumentType("")).toBe(false);
        expect(isWordDocumentType(null)).toBe(false);
        expect(isWordDocumentType(undefined)).toBe(false);
    });
});

describe("isSpreadsheetDocumentType", () => {
    it("recognizes xlsx, xlsm, and xls, case-insensitively", () => {
        expect(isSpreadsheetDocumentType("xlsx")).toBe(true);
        expect(isSpreadsheetDocumentType("xlsm")).toBe(true);
        expect(isSpreadsheetDocumentType("XLS")).toBe(true);
    });

    it("rejects other types and missing input", () => {
        expect(isSpreadsheetDocumentType("docx")).toBe(false);
        expect(isSpreadsheetDocumentType(null)).toBe(false);
        expect(isSpreadsheetDocumentType(undefined)).toBe(false);
    });
});

describe("isPresentationDocumentType", () => {
    it("recognizes pptx and ppt, case-insensitively", () => {
        expect(isPresentationDocumentType("pptx")).toBe(true);
        expect(isPresentationDocumentType("PPT")).toBe(true);
    });

    it("rejects other types and missing input", () => {
        expect(isPresentationDocumentType("pdf")).toBe(false);
        expect(isPresentationDocumentType(null)).toBe(false);
        expect(isPresentationDocumentType(undefined)).toBe(false);
    });
});

describe("shouldConvertToPdf", () => {
    it("converts Word and presentation documents", () => {
        expect(shouldConvertToPdf("docx")).toBe(true);
        expect(shouldConvertToPdf("doc")).toBe(true);
        expect(shouldConvertToPdf("pptx")).toBe(true);
        expect(shouldConvertToPdf("PPT")).toBe(true);
    });

    it("deliberately skips spreadsheets (rendered natively as a grid)", () => {
        expect(shouldConvertToPdf("xlsx")).toBe(false);
        expect(shouldConvertToPdf("xlsm")).toBe(false);
        expect(shouldConvertToPdf("xls")).toBe(false);
    });

    it("skips pdf itself and missing input", () => {
        expect(shouldConvertToPdf("pdf")).toBe(false);
        expect(shouldConvertToPdf(null)).toBe(false);
        expect(shouldConvertToPdf(undefined)).toBe(false);
    });
});

describe("contentTypeForDocumentType", () => {
    it("maps every allowed type to its MIME type", () => {
        const expected: Record<string, string> = {
            pdf: "application/pdf",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            doc: "application/msword",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
            xls: "application/vnd.ms-excel",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ppt: "application/vnd.ms-powerpoint",
            md: "text/markdown; charset=utf-8",
        };
        for (const type of ALLOWED_DOCUMENT_TYPES) {
            expect(contentTypeForDocumentType(type)).toBe(expected[type]);
        }
    });

    it("is case-insensitive", () => {
        expect(contentTypeForDocumentType("PDF")).toBe("application/pdf");
    });

    it("falls back to application/octet-stream for unknown or missing input", () => {
        expect(contentTypeForDocumentType("exe")).toBe("application/octet-stream");
        expect(contentTypeForDocumentType("")).toBe("application/octet-stream");
        expect(contentTypeForDocumentType(null)).toBe("application/octet-stream");
        expect(contentTypeForDocumentType(undefined)).toBe(
            "application/octet-stream",
        );
    });
});

describe("Markdown", () => {
    it("is its own type: no PDF rendition, case-insensitive", () => {
        expect(isMarkdownDocumentType("md")).toBe(true);
        expect(isMarkdownDocumentType("MD")).toBe(true);
        expect(isMarkdownDocumentType("txt")).toBe(false);
        expect(isMarkdownDocumentType(null)).toBe(false);
        expect(shouldConvertToPdf("md")).toBe(false);
    });

    it("decodes UTF-8 as the file is, keeping a byte order mark", () => {
        const bytes = new TextEncoder().encode("\uFEFF# ñ 日本 😀\n");
        expect(decodeMarkdownBytes(bytes)).toBe("\uFEFF# ñ 日本 😀\n");
        expect(decodeMarkdownBytes(bytes.buffer as ArrayBuffer)).toBe("\uFEFF# ñ 日本 😀\n");
    });

    it("replaces invalid bytes unless fatal, in which case it throws", () => {
        const bad = new Uint8Array([0x61, 0xff]);
        expect(decodeMarkdownBytes(bad)).toBe("a\uFFFD");
        expect(() => decodeMarkdownBytes(bad, { fatal: true })).toThrow();
    });
});
