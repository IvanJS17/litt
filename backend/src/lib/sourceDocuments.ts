export type { SourceDocumentType } from "@mike/contracts";
import type { SourceDocumentType } from "@mike/contracts";

export type { SourceDocumentMetadata } from "@mike/contracts";
export type { SourceDocumentAction } from "@mike/contracts";
export type { SourceDocumentQuote } from "@mike/contracts";
export type { SourceSubdocument } from "@mike/contracts";
export type { SourceDocument } from "@mike/contracts";

export function sourceDocumentType(filename: string): SourceDocumentType {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "docx" || extension === "doc") return "docx";
  if (extension === "xlsx" || extension === "xlsm" || extension === "xls") {
    return "spreadsheet";
  }
  return "pdf";
}
