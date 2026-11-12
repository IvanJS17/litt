// Pure helpers for read scans: what a reading costs, and how the Markdown it
// returns lines up with the pages of the PDF it came from. Parser-only: the
// isolated extraction process loads this file.

/** A PDF of this many pages or fewer is read on upload; longer ones wait for a click. */
export const OCR_AUTO_MAX_PAGES = 50;

/** About one US cent per page at LandingAI's standard tier (5.5 credits for 7 pages, 1 credit = 0.01 USD). */
export const OCR_USD_PER_PAGE = 0.01;

/** The PDF is sent whole, so it is capped before anything leaves the server. */
export const OCR_MAX_BYTES = 50 * 1024 * 1024;

export const OCR_PAGE_BREAK = "<!-- PAGE BREAK -->";

/** A reading to merge into a PDF's own text: LandingAI's Markdown and the pages it failed. */
export type OcrFill = { markdown: string; failedPages?: readonly number[] };

/** An estimate, in US dollars, for reading `pages` pages. */
export function estimateOcrCostUsd(pages: number): number {
    return Math.round(Math.max(0, pages) * OCR_USD_PER_PAGE * 100) / 100;
}

/**
 * The Markdown of each page (index 0 is page 1), or null when the page breaks
 * do not match the page count, in which case nothing can be said about which
 * page a passage belongs to.
 */
export function splitOcrPages(markdown: string, pageCount: number): string[] | null {
    if (!Number.isInteger(pageCount) || pageCount < 1) return null;
    const parts = markdown.split(OCR_PAGE_BREAK).map((part) => part.trim());
    if (parts.length === pageCount + 1 && parts[pageCount] === "") parts.pop();
    return parts.length === pageCount ? parts : null;
}
