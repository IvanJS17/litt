// The one list of document types a person can upload. The web app and the
// Word add-in both read it; the server keeps its own authoritative copy in
// backend/src/lib/documentTypes.ts (a test keeps the two in step).

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "ppt",
  "md",
] as const;

/** The value for an `<input type="file" accept>` attribute. */
export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

/** Says which types are accepted, so a refusal tells the person what to pick. */
export const UNSUPPORTED_DOCUMENT_WARNING_MESSAGE =
  "Unsupported file type. Only PDF, Word, Excel, PowerPoint, and Markdown (.md) files can be uploaded.";

const SUPPORTED_EXTENSION_SET: ReadonlySet<string> = new Set(
  SUPPORTED_DOCUMENT_EXTENSIONS,
);

/** True when the last extension of `filename` is an uploadable type. */
export function hasSupportedDocumentExtension(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase();
  return !!extension && SUPPORTED_EXTENSION_SET.has(extension);
}
