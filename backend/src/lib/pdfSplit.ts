// Copy chosen pages of a PDF into new PDFs (docs/document-split.md). Parser-only:
// the isolated extraction process loads this file, which keeps pdf-lib's work
// on a whole file inside that process's size, time and memory limits.
import { PDFDocument } from "pdf-lib";
import { AppError } from "./appError";

/** Most new PDFs one request makes; a page can sit in only one group, so this also caps the groups. */
export const SPLIT_MAX_GROUPS = 400;

/**
 * One new PDF per group of 1-indexed pages, in the order given inside each
 * group. The pages are the original ones (content streams, fonts and images
 * are copied, not redrawn). Bad page numbers throw: the caller has already
 * validated them, so reaching here with one is a bug, never a user error.
 */
export async function copyPdfPages(bytes: ArrayBuffer, groups: readonly (readonly number[])[]): Promise<Uint8Array[]> {
  if (groups.length === 0 || groups.length > SPLIT_MAX_GROUPS) throw new AppError("extraction.failed", "split_groups_invalid");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  } catch (cause) {
    throw new AppError("extraction.pdf_parse_failed", "document_split_pdf_unreadable", { cause });
  }
  const total = source.getPageCount();
  const out: Uint8Array[] = [];
  for (const pages of groups) {
    if (pages.length === 0 || pages.some((page) => !Number.isInteger(page) || page < 1 || page > total))
      throw new AppError("extraction.failed", "split_pages_invalid");
    const target = await PDFDocument.create();
    const copied = await target.copyPages(source, pages.map((page) => page - 1));
    for (const page of copied) target.addPage(page);
    out.push(await target.save({ useObjectStreams: false }));
  }
  return out;
}
