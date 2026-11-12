import type {
    DocumentConversionDetected,
    DocumentConversionLoss,
    DocumentConversionType,
} from "@mike/contracts";

/**
 * The formats a document can be converted to, by its file type. PDF → Word is
 * absent on purpose: a PDF keeps no paragraphs, tables or styles. Mirrors the
 * server (`conversionTargets`), which is what actually decides.
 */
export function conversionTargetsFor(
    fileType: string | null | undefined,
): DocumentConversionType[] {
    switch ((fileType ?? "").toLowerCase()) {
        case "md":
            return ["docx", "pdf"];
        case "docx":
            return ["md", "pdf"];
        case "pdf":
            return ["md"];
        default:
            return [];
    }
}

/** Catalog key of the menu entry for each target. Decide by target, never by the label. */
export const CONVERT_ACTION_KEYS = {
    docx: "documents.convert.action.docx",
    md: "documents.convert.action.md",
    pdf: "documents.convert.action.pdf",
} as const satisfies Record<DocumentConversionType, string>;

export const CONVERT_TARGET_KEYS = {
    docx: "documents.convert.target.docx",
    md: "documents.convert.target.md",
    pdf: "documents.convert.target.pdf",
} as const satisfies Record<DocumentConversionType, string>;

/** Catalog key of the sentence for each fixed loss the server names. */
export const CONVERT_LOSS_KEYS = {
    md_raw_html: "documents.convert.loss.md_raw_html",
    md_formulas: "documents.convert.loss.md_formulas",
    md_house_style: "documents.convert.loss.md_house_style",
    docx_comments: "documents.convert.loss.docx_comments",
    docx_tracked_changes: "documents.convert.loss.docx_tracked_changes",
    docx_headers_footers: "documents.convert.loss.docx_headers_footers",
    docx_formatting: "documents.convert.loss.docx_formatting",
    docx_legal_numbering: "documents.convert.loss.docx_legal_numbering",
    docx_images: "documents.convert.loss.docx_images",
    docx_merged_cells: "documents.convert.loss.docx_merged_cells",
    docx_footnotes_as_list: "documents.convert.loss.docx_footnotes_as_list",
    pdf_fonts_and_breaks: "documents.convert.loss.pdf_fonts_and_breaks",
    pdf_tracked_changes_as_shown: "documents.convert.loss.pdf_tracked_changes_as_shown",
    pdf_layout_lost: "documents.convert.loss.pdf_layout_lost",
} as const satisfies Record<DocumentConversionLoss, string>;

export type DetectedLine = {
    key:
        | "documents.convert.detected.comments"
        | "documents.convert.detected.trackedChanges"
        | "documents.convert.detected.trackedChangesPdf"
        | "documents.convert.detected.images"
        | "documents.convert.detected.footnotes"
        | "documents.convert.detected.headersFooters";
    count: number;
};

/**
 * What the Word file actually holds that this conversion changes, one line per
 * kind with its count. To Markdown everything counts; to PDF only the tracked
 * changes show (the rest stays in the PDF as LibreOffice draws it).
 */
export function detectedLines(
    target: DocumentConversionType,
    detected: DocumentConversionDetected | null,
): DetectedLine[] {
    if (!detected) return [];
    const tracked = detected.tracked_insertions + detected.tracked_deletions;
    const lines: DetectedLine[] =
        target === "md"
            ? [
                  { key: "documents.convert.detected.comments", count: detected.comments },
                  { key: "documents.convert.detected.trackedChanges", count: tracked },
                  { key: "documents.convert.detected.images", count: detected.images },
                  { key: "documents.convert.detected.footnotes", count: detected.footnotes },
                  {
                      key: "documents.convert.detected.headersFooters",
                      count: detected.headers + detected.footers,
                  },
              ]
            : target === "pdf"
              ? [{ key: "documents.convert.detected.trackedChangesPdf", count: tracked }]
              : [];
    return lines.filter((line) => line.count > 0);
}
