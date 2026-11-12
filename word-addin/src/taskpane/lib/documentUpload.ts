import {
  SUPPORTED_DOCUMENT_ACCEPT,
  unsupportedDocumentWarningMessage,
  hasSupportedDocumentExtension,
} from "@mike/client";

// The list itself lives in @mike/client, shared with the web app.
export { SUPPORTED_DOCUMENT_ACCEPT, unsupportedDocumentWarningMessage };

export function partitionSupportedDocumentFiles(files: File[]): {
  supported: File[];
  unsupported: File[];
} {
  const supported: File[] = [];
  const unsupported: File[] = [];

  for (const file of files) {
    (hasSupportedDocumentExtension(file.name) ? supported : unsupported).push(
      file,
    );
  }

  return { supported, unsupported };
}
