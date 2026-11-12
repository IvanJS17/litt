// LandingAI Agentic Document Extraction, Parse Jobs (REST v2):
//   POST /v2/parse/jobs            multipart: document, model, service_tier
//   GET  /v2/parse/jobs/{job_id}   status, then result.markdown / result.metadata
// https://docs.landing.ai/dpt3/parse-async
//
// The key is the owner's own (never the platform's) and travels only in the
// Authorization header to the one fixed host below. Redirects are refused so
// the header cannot follow one to another origin. Neither the key, the
// document nor LandingAI's response text appears in a message or a log: every
// failure is a static code the interface already knows (OcrError.code).
import { AppError } from "../appError";
import { OCR_MAX_BYTES, readOcrPages, type OcrPage } from "./pages";

/** US region. An EU key (ade.eu-west-1.landing.ai) does not work here. */
export const LANDINGAI_HOST = "https://api.ade.landing.ai";
export const LANDINGAI_MODEL = "dpt-3-pro-latest";
/** Half the credits of the priority tier; nobody is waiting on the reply. */
export const LANDINGAI_SERVICE_TIER = "standard";
export const LANDINGAI_TOTAL_TIMEOUT_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

export type OcrErrorCode =
    | "ocr_key_invalid"
    | "ocr_no_credits"
    | "ocr_unavailable"
    | "ocr_too_large"
    | "ocr_not_supported";

/**
 * A reading that failed in a way the person can be told about. `retryable`
 * is true only for failures a later attempt can fix (LandingAI busy or down);
 * a refused key, an empty account or a file it will not read stay failed.
 */
export class OcrError extends AppError {
    readonly code: OcrErrorCode;
    readonly retryable: boolean;
    constructor(code: OcrErrorCode) {
        super("ocr.landingai_error", `Scan reading failed: ${code}`);
        this.code = code;
        this.retryable = code === "ocr_unavailable";
    }
}

export type OcrResult = {
    /** The text of each page, by real PDF page number. */
    pages: OcrPage[];
    pageCount: number;
    /** 1-indexed pages LandingAI could not read; the rest of the result is good. */
    failedPages: number[];
    credits: number;
    model: string;
};

export type OcrDeps = {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    totalTimeoutMs?: number;
    pollIntervalMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function statusError(status: number): OcrError {
    if (status === 401 || status === 403) return new OcrError("ocr_key_invalid");
    if (status === 402) return new OcrError("ocr_no_credits");
    if (status === 413) return new OcrError("ocr_too_large");
    if (status === 422) return new OcrError("ocr_not_supported");
    return new OcrError("ocr_unavailable");
}

function failedJobError(code: unknown): OcrError {
    if (typeof code === "string") {
        if (/^(encrypted_pdf_|password_|corrupt_pdf|ParseCorrupt|unsupported|validation_error)/.test(code))
            return new OcrError("ocr_not_supported");
        if (/(TooLarge|too_large|too_many_pages)/.test(code)) return new OcrError("ocr_too_large");
        if (code === "invalid_api_key") return new OcrError("ocr_key_invalid");
    }
    return new OcrError("ocr_unavailable");
}

async function request(
    doFetch: typeof fetch,
    url: string,
    init: RequestInit,
    signal: AbortSignal,
): Promise<{ status: number; body: Record<string, unknown> }> {
    let response: Response;
    try {
        response = await doFetch(url, {
            ...init,
            // The key rides in a header, and fetch forwards custom headers
            // across origins on a redirect. LandingAI needs none.
            redirect: "manual",
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
    } catch {
        // Timeout, abort or network failure: nothing about it is the person's to fix.
        throw new OcrError("ocr_unavailable");
    }
    if (response.status !== 200 && response.status !== 202 && response.status !== 206) {
        await response.body?.cancel().catch(() => undefined);
        throw statusError(response.status);
    }
    try {
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    } catch {
        throw new OcrError("ocr_unavailable");
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

/** Read one scanned PDF with LandingAI and return its Markdown. */
export async function parsePdfWithLandingAi(
    apiKey: string,
    pdf: ArrayBuffer | Uint8Array,
    deps: OcrDeps = {},
): Promise<OcrResult> {
    const doFetch = deps.fetch ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const pollMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
    if (!apiKey.trim()) throw new OcrError("ocr_key_invalid");
    if (pdf.byteLength === 0) throw new OcrError("ocr_not_supported");
    if (pdf.byteLength > OCR_MAX_BYTES) throw new OcrError("ocr_too_large");

    const total = AbortSignal.timeout(deps.totalTimeoutMs ?? LANDINGAI_TOTAL_TIMEOUT_MS);
    const signal = deps.signal ? AbortSignal.any([deps.signal, total]) : total;
    const headers = { authorization: `Bearer ${apiKey.trim()}`, accept: "application/json" };

    const form = new FormData();
    form.set("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "document.pdf");
    form.set("model", LANDINGAI_MODEL);
    form.set("service_tier", LANDINGAI_SERVICE_TIER);
    form.set("options", JSON.stringify({ atomic_grounding: false }));

    const created = await request(
        doFetch,
        `${LANDINGAI_HOST}/v2/parse/jobs`,
        { method: "POST", headers, body: form },
        signal,
    );
    const jobId = created.body.job_id;
    // The id goes into a path: only the documented shape is accepted.
    if (typeof jobId !== "string" || !/^parse-[0-9a-z]{26}$/i.test(jobId)) throw new OcrError("ocr_unavailable");

    for (;;) {
        if (signal.aborted) throw new OcrError("ocr_unavailable");
        const polled = await request(
            doFetch,
            `${LANDINGAI_HOST}/v2/parse/jobs/${jobId}`,
            { method: "GET", headers },
            signal,
        );
        const status = polled.body.status;
        if (status === "failed") {
            throw failedJobError(isRecord(polled.body.error) ? polled.body.error.code : undefined);
        }
        if (status === "completed") return readResult(polled.body);
        if (status !== "pending" && status !== "processing") throw new OcrError("ocr_unavailable");
        await sleep(pollMs);
    }
}

function readResult(body: Record<string, unknown>): OcrResult {
    const result = body.result;
    // A result delivered to a URL (output_url) is never requested, so a
    // completed job without an inline result is not one we can use.
    if (!isRecord(result) || typeof result.markdown !== "string") throw new OcrError("ocr_unavailable");
    const metadata = isRecord(result.metadata) ? result.metadata : isRecord(body.metadata) ? body.metadata : {};
    const billing = isRecord(metadata.billing) ? metadata.billing : {};
    const pageCount = Number(metadata.page_count);
    const credits = Number(billing.total_credits);
    const pages = readOcrPages(result.markdown, result.structure, Number.isInteger(pageCount) ? pageCount : 0);
    // Without a reliable page for every passage the reading is not usable: the
    // assistant must be able to cite "page N" as it does with a text PDF.
    if (!pages) throw new OcrError("ocr_unavailable");
    return {
        pages,
        pageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0,
        failedPages: Array.isArray(metadata.failed_pages)
            ? metadata.failed_pages.filter((page): page is number => Number.isInteger(page) && page > 0)
            : [],
        credits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
        model: typeof metadata.model_version === "string" ? metadata.model_version : LANDINGAI_MODEL,
    };
}
