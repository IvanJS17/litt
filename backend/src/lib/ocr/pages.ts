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
export type OcrPage = { page: number; text: string };
export type OcrFill = { pages: readonly OcrPage[]; failedPages?: readonly number[] };

/** The text of a page number in a reading, or null when the reading has no such page. */
export function ocrPageText(fill: OcrFill, page: number): string | null {
    return fill.pages.find((entry) => entry.page === page)?.text ?? null;
}

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

/**
 * LandingAI's Markdown by real PDF page number. Uses the page nodes of
 * `structure` (their `grounding.page` and `grounding.range`, in Unicode code
 * points over the Markdown) and, when those are absent, the page-break marker.
 * Null when neither lines up, so a passage is never put on a guessed page.
 */
export function readOcrPages(markdown: string, structure: unknown, pageCount: number): OcrPage[] | null {
    const clean = (text: string) => text.replaceAll(OCR_PAGE_BREAK, "").trim();
    const children = (structure as { children?: unknown } | null)?.children;
    if (Array.isArray(children)) {
        const points = Array.from(markdown);
        const pages: OcrPage[] = [];
        for (const node of children) {
            const n = node as { type?: unknown; grounding?: { page?: unknown; range?: { start?: unknown; end?: unknown } } };
            const page = n?.grounding?.page;
            const start = n?.grounding?.range?.start;
            const end = n?.grounding?.range?.end;
            if (n?.type !== "page" || !Number.isInteger(page) || !Number.isInteger(start) || !Number.isInteger(end)) continue;
            if ((start as number) < 0 || (end as number) < (start as number) || (end as number) > points.length) continue;
            pages.push({ page: page as number, text: clean(points.slice(start as number, end as number).join("")) });
        }
        if (pages.length > 0) return pages;
    }
    const split = splitOcrPages(markdown, pageCount);
    return split ? split.map((text, index) => ({ page: index + 1, text })) : null;
}
