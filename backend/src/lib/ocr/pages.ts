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

/** An estimate, in US dollars, for reading `pages` pages (only the scanned ones are sent and billed). */
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
 * When only some pages were requested (`only`, 1-indexed, ascending), the
 * markers separate just those pages, in that order.
 */
export function readOcrPages(markdown: string, structure: unknown, pageCount: number, only?: readonly number[]): OcrPage[] | null {
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
    const split = splitOcrPages(markdown, only ? only.length : pageCount);
    return split ? split.map((text, index) => ({ page: only ? only[index] : index + 1, text })) : null;
}

/** What one reading may store: the text of one page and of the whole reading, in bytes (UTF-8), and its number of pages. */
export const OCR_PAGE_MAX_BYTES = 200_000;
export const OCR_READING_MAX_BYTES = 10_000_000;
export const OCR_READING_MAX_PAGES = 20_000;
export type OcrStoreLimits = { pageBytes: number; readingBytes: number; readingPages: number };

const isPageNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/**
 * The pages of a reading as they are stored, or null when the reading has more page entries
 * (or more pages listed as not read) than `readingPages`: such a reading is not stored at all.
 * A stored page is always the whole text the service returned for it (NUL characters
 * removed), once per page number (the first wins). A page the service listed as failed and
 * returned with text is stored like any other page and stays in the list, once. A page over
 * `pageBytes` or one without a string text is not stored and is listed (when the number is a
 * valid page number); a page the bound drops is never stored. Pages are taken in page
 * order while the reading stays within `readingBytes`; the first page that does not fit and
 * every later one are listed. Malformed entries are dropped. Linear in the number of entries.
 */
export function boundOcrReading(
    reading: { pages: readonly OcrPage[]; failedPages: readonly number[] },
    limits: OcrStoreLimits,
): { pages: OcrPage[]; failedPages: number[] } | null {
    if (reading.pages.length > limits.readingPages) return null;
    const failedPages = [...new Set(reading.failedPages.filter(isPageNumber))];
    if (failedPages.length > limits.readingPages) return null;
    const listed = new Set(failedPages);
    const seen = new Set<number>();
    const candidates: OcrPage[] = [];
    const notRead: number[] = [];
    for (const entry of reading.pages) {
        const number = (entry as { page?: unknown } | null)?.page;
        if (!isPageNumber(number) || seen.has(number)) continue;
        seen.add(number);
        const text = (entry as { text?: unknown }).text;
        if (typeof text !== "string") {
            notRead.push(number);
        } else {
            candidates.push({ page: number, text: text.replaceAll("\0", "") });
        }
    }
    const kept = new Set<OcrPage>();
    let total = 0;
    let outOfRoom = false;
    for (const entry of [...candidates].sort((a, b) => a.page - b.page)) {
        const size = Buffer.byteLength(entry.text, "utf8");
        const tooBig = size > limits.pageBytes;
        if (!tooBig && !outOfRoom && total + size <= limits.readingBytes) {
            total += size;
            kept.add(entry);
            continue;
        }
        if (!tooBig) outOfRoom = true; // this page and every later one are listed
        notRead.push(entry.page);
    }
    for (const number of notRead.sort((a, b) => a - b)) if (!listed.has(number)) { listed.add(number); failedPages.push(number); }
    if (failedPages.length > limits.readingPages) return null;
    return { pages: candidates.filter((entry) => kept.has(entry)), failedPages };
}

// --- Split (layer 7, docs/document-split.md) ---------------------------------

/** LandingAI Split takes at most this much Markdown, this many pages and this many types per call. */
export const SPLIT_MAX_MARKDOWN_BYTES = 4 * 1024 * 1024;
export const SPLIT_MAX_PAGES = 400;

/** Split charges 1 credit per 5,000 characters of Markdown; 1 credit = 0.01 USD. */
export const SPLIT_CHARS_PER_CREDIT = 5000;
export const SPLIT_USD_PER_CREDIT = 0.01;

/** The Markdown Split reads: one entry per real PDF page, in order, joined by LandingAI's own page marker. */
export function buildSplitMarkdown(pageTexts: readonly string[]): string {
    return pageTexts.map((text) => text.replaceAll(OCR_PAGE_BREAK, "").trim()).join(`\n\n${OCR_PAGE_BREAK}\n\n`);
}

/** An estimate of what Split will charge for `chars` characters of Markdown, in credits (to a tenth) and US dollars (to a hundredth of a cent, so a small text does not read as free). */
export function estimateSplitCost(chars: number): { credits: number; usd: number } {
    const credits = Math.ceil((Math.max(0, chars) / SPLIT_CHARS_PER_CREDIT) * 10) / 10;
    return { credits, usd: Math.round(credits * SPLIT_USD_PER_CREDIT * 10000) / 10000 };
}
