// LandingAI Agentic Document Extraction, Split (REST v1):
//   POST /v1/split   multipart: markdown (file), split_class (a JSON STRING), model (optional)
// https://docs.landing.ai/ade/ade-split
//
// Synchronous: the answer comes back on the same request (9 s for 34 pages in
// a real test), so there is no job. Same rules as the scan reading (landingai.ts):
// the key is the owner's own, travels only in the Authorization header to the one
// fixed host, redirects are refused, and neither the key, the text nor
// LandingAI's answer text appears in a message or a log: every failure is a
// static OcrError code. No retries: a 401/402/403/422 will not change, and a
// retry after a timeout could bill the same text twice.
import { LANDINGAI_HOST, OcrError, isRecord, landingAiRequest } from "./landingai";
import { SPLIT_MAX_MARKDOWN_BYTES, SPLIT_MAX_PAGES } from "./pages";
import { SPLIT_MAX_CLASSES, type SplitClass } from "./splitClasses";

/** A reasonable wait for a 400-page text; the real call took 9 s for 34 pages. */
export const SPLIT_TIMEOUT_MS = 120_000;

/** What Split calls a page that fits none of the types. */
export const SPLIT_UNCATEGORIZED = "uncategorized";

/** One proposed document. `type` is a name from the list that was sent, or null (no type fits). Pages are 1-indexed, ascending. */
export type SplitGroup = { type: string | null; identifier: string | null; pages: number[] };

export type SplitResult = { groups: SplitGroup[]; credits: number };

export type SplitDeps = { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number };

/**
 * Ask Split to group the pages of `markdown` (`pageCount` pages joined by the
 * page marker) into the given types. The answer is rebuilt as a partition of
 * the pages: a page Split left out, or named twice, never gets lost or doubled.
 */
export async function splitWithLandingAi(
    apiKey: string,
    markdown: string,
    pageCount: number,
    classes: readonly SplitClass[],
    deps: SplitDeps = {},
): Promise<SplitResult> {
    if (!apiKey.trim()) throw new OcrError("ocr_key_invalid");
    if (classes.length === 0 || markdown.trim() === "" || pageCount < 1) throw new OcrError("ocr_not_supported");
    if (classes.length > SPLIT_MAX_CLASSES || pageCount > SPLIT_MAX_PAGES || Buffer.byteLength(markdown) > SPLIT_MAX_MARKDOWN_BYTES)
        throw new OcrError("split_too_large");

    const timeoutMs = deps.timeoutMs ?? SPLIT_TIMEOUT_MS;
    const total = AbortSignal.timeout(timeoutMs);
    const signal = deps.signal ? AbortSignal.any([deps.signal, total]) : total;
    const form = new FormData();
    form.set("markdown", new Blob([markdown], { type: "text/markdown" }), "documento.md");
    // A JSON string, not a list: a list answers 422 "split_class field is required".
    form.set(
        "split_class",
        JSON.stringify(classes.map((c) => ({ name: c.name, description: c.description, ...(c.identifier ? { identifier: c.identifier } : {}) }))),
    );

    let response: { status: number; body: Record<string, unknown> };
    try {
        response = await landingAiRequest(
            deps.fetch ?? fetch,
            `${LANDINGAI_HOST}/v1/split`,
            { method: "POST", headers: { authorization: `Bearer ${apiKey.trim()}`, accept: "application/json" }, body: form },
            signal,
            timeoutMs,
        );
    } catch (error) {
        // 413: more than Split takes, which is the same thing the local caps say.
        throw error instanceof OcrError && error.code === "ocr_too_large" ? new OcrError("split_too_large") : error;
    }
    return readSplitResponse(response.body, pageCount, classes);
}

const asPages = (value: unknown, pageCount: number): number[] =>
    Array.isArray(value)
        ? value.filter((page): page is number => Number.isInteger(page) && page >= 0 && page < pageCount).map((page) => page + 1)
        : [];

/** Split's `splits[]` as a partition of pages 1..pageCount, in order of each group's first page. */
export function readSplitResponse(body: Record<string, unknown>, pageCount: number, classes: readonly SplitClass[]): SplitResult {
    if (!Array.isArray(body.splits)) throw new OcrError("ocr_unavailable");
    const known = new Set(classes.map((c) => c.name));
    const taken = new Set<number>();
    const groups: SplitGroup[] = [];
    for (const split of body.splits) {
        if (!isRecord(split)) continue;
        // A page belongs to the first group that names it; an empty group is dropped.
        const pages = [...new Set(asPages(split.pages, pageCount))].filter((page) => !taken.has(page)).sort((a, b) => a - b);
        if (pages.length === 0) continue;
        pages.forEach((page) => taken.add(page));
        const classification = typeof split.classification === "string" ? split.classification : "";
        const identifier = typeof split.identifier === "string" ? split.identifier.trim() : "";
        groups.push({
            // A name that is not in the list that was sent is not trusted as a type.
            type: classification !== SPLIT_UNCATEGORIZED && known.has(classification) ? classification : null,
            identifier: identifier && identifier.length <= 200 ? identifier : null,
            pages,
        });
    }
    // Pages Split left out still belong somewhere: one group without a type.
    const missing = Array.from({ length: pageCount }, (_, index) => index + 1).filter((page) => !taken.has(page));
    if (missing.length > 0) groups.push({ type: null, identifier: null, pages: missing });
    groups.sort((a, b) => a.pages[0] - b.pages[0]);

    const metadata = isRecord(body.metadata) ? body.metadata : {};
    const credits = Number(metadata.credit_usage);
    return { groups, credits: Number.isFinite(credits) && credits >= 0 ? credits : 0 };
}
