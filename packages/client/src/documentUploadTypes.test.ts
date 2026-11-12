import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  unsupportedDocumentWarningMessage,
  hasSupportedDocumentExtension,
} from "./documentUploadTypes";

describe("document upload types", () => {
  it("builds the accept attribute from the one list", () => {
    expect(SUPPORTED_DOCUMENT_ACCEPT).toBe(
      ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt,.md",
    );
  });

  it("matches the types the server accepts", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../backend/src/lib/documentTypes.ts"),
      "utf8",
    );
    const block = /ALLOWED_DOCUMENT_TYPES = new Set\(\[([^\]]*)\]/.exec(source)![1];
    const server = [...block.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect([...SUPPORTED_DOCUMENT_EXTENSIONS].sort()).toEqual(server.sort());
  });

  it("reads the last extension, any case, and names the accepted types", () => {
    expect(hasSupportedDocumentExtension("Notes.MD")).toBe(true);
    expect(hasSupportedDocumentExtension("v1.2.final.pdf")).toBe(true);
    expect(hasSupportedDocumentExtension("report.pdf.exe")).toBe(false);
    expect(hasSupportedDocumentExtension("")).toBe(false);
    expect(unsupportedDocumentWarningMessage()).toContain("Markdown (.md)");
  });
});
