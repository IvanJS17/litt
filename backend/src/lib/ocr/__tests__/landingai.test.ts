import { describe, expect, it, vi } from "vitest";
import { LANDINGAI_HOST, OcrError, parsePdfWithLandingAi } from "../landingai";
import { estimateOcrCostUsd, splitOcrPages, OCR_PAGE_BREAK } from "../pages";

// The real LandingAI API is never called: fetch is a mock.
const SECRET = "synthetic-key-0001";
const JOB = "parse-01k04g2b8xv9q3m5n7r2sd4tfe";
const pdf = new Uint8Array([37, 80, 68, 70, 45]);

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const completed = (extra: Record<string, unknown> = {}) =>
    json(200, {
        job_id: JOB,
        status: "completed",
        result: {
            markdown: "# Hola",
            metadata: {
                page_count: 7,
                model_version: "dpt-3-pro-20260710",
                failed_pages: [],
                billing: { service_tier: "standard", total_credits: 5.5 },
                ...extra,
            },
        },
    });
const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
});
const codeOf = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(OcrError);
        return (error as OcrError).code;
    }
    throw new Error("expected a failure");
};

describe("parsePdfWithLandingAi", () => {
    it("creates a standard-tier job, polls it and reads markdown, pages and credits", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json(202, { job_id: JOB, status: "pending", created_at: "x" }))
            .mockResolvedValueOnce(json(200, { job_id: JOB, status: "processing", progress: 0.4 }))
            .mockResolvedValueOnce(completed());
        const result = await parsePdfWithLandingAi(SECRET, pdf, deps(fetchMock));
        expect(result).toEqual({
            markdown: "# Hola",
            pageCount: 7,
            failedPages: [],
            credits: 5.5,
            model: "dpt-3-pro-20260710",
        });
        const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(createUrl).toBe(`${LANDINGAI_HOST}/v2/parse/jobs`);
        expect(createInit.method).toBe("POST");
        expect(createInit.redirect).toBe("manual");
        const form = createInit.body as FormData;
        expect(form.get("service_tier")).toBe("standard");
        expect(form.get("model")).toBe("dpt-3-pro-latest");
        expect(JSON.parse(String(form.get("options")))).toEqual({ atomic_grounding: false });
        expect((fetchMock.mock.calls[1] as [string])[0]).toBe(`${LANDINGAI_HOST}/v2/parse/jobs/${JOB}`);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps the pages LandingAI failed on a partial (206) result", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json(202, { job_id: JOB, status: "pending" }))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        status: "completed",
                        result: { markdown: "x", metadata: { page_count: 3, failed_pages: [2, "x", 0] } },
                    }),
                    { status: 206 },
                ),
            );
        const result = await parsePdfWithLandingAi(SECRET, pdf, deps(fetchMock));
        expect(result.failedPages).toEqual([2]);
        expect(result.credits).toBe(0);
    });

    it.each([
        [401, "ocr_key_invalid"],
        [403, "ocr_key_invalid"],
        [402, "ocr_no_credits"],
        [413, "ocr_too_large"],
        [422, "ocr_not_supported"],
        [429, "ocr_unavailable"],
        [503, "ocr_unavailable"],
    ])("maps HTTP %i to %s and does not retry it", async (status, code) => {
        const fetchMock = vi.fn().mockResolvedValue(json(status, { code: "x", message: SECRET }));
        expect(await codeOf(parsePdfWithLandingAi(SECRET, pdf, deps(fetchMock)))).toBe(code);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps a failed job by its code", async () => {
        for (const [jobCode, code] of [
            ["encrypted_pdf_password_required", "ocr_not_supported"],
            ["corrupt_pdf", "ocr_not_supported"],
            ["ParseImageTooLarge", "ocr_too_large"],
            ["internal", "ocr_unavailable"],
        ] as const) {
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(json(202, { job_id: JOB, status: "pending" }))
                .mockResolvedValueOnce(json(200, { status: "failed", error: { code: jobCode, message: "m" } }));
            expect(await codeOf(parsePdfWithLandingAi(SECRET, pdf, deps(fetchMock)))).toBe(code);
        }
    });

    it("treats a network failure, a redirect and a malformed answer as unavailable", async () => {
        expect(
            await codeOf(parsePdfWithLandingAi(SECRET, pdf, deps(vi.fn().mockRejectedValue(new TypeError("boom"))))),
        ).toBe("ocr_unavailable");
        expect(
            await codeOf(
                parsePdfWithLandingAi(
                    SECRET,
                    pdf,
                    deps(vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example" } }))),
                ),
            ),
        ).toBe("ocr_unavailable");
        expect(
            await codeOf(parsePdfWithLandingAi(SECRET, pdf, deps(vi.fn().mockResolvedValue(json(202, { job_id: "../x" }))))),
        ).toBe("ocr_unavailable");
        expect(
            await codeOf(
                parsePdfWithLandingAi(
                    SECRET,
                    pdf,
                    deps(
                        vi
                            .fn()
                            .mockResolvedValueOnce(json(202, { job_id: JOB }))
                            .mockResolvedValueOnce(json(200, { status: "completed", output_url: "https://x" })),
                    ),
                ),
            ),
        ).toBe("ocr_unavailable");
    });

    it("gives up when the total time passes", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json(202, { job_id: JOB }))
            .mockImplementation(async () => json(200, { status: "processing" }));
        const code = await codeOf(
            parsePdfWithLandingAi(SECRET, pdf, {
                fetch: fetchMock as unknown as typeof fetch,
                sleep: () => new Promise((resolve) => setTimeout(resolve, 5)),
                totalTimeoutMs: 20,
            }),
        );
        expect(code).toBe("ocr_unavailable");
    });

    it("refuses an empty, an oversize or a keyless request before anything is sent", async () => {
        const fetchMock = vi.fn();
        expect(await codeOf(parsePdfWithLandingAi(SECRET, new Uint8Array(0), deps(fetchMock)))).toBe("ocr_not_supported");
        expect(await codeOf(parsePdfWithLandingAi("  ", pdf, deps(fetchMock)))).toBe("ocr_key_invalid");
        const big = { byteLength: 60 * 1024 * 1024 } as unknown as Uint8Array;
        expect(await codeOf(parsePdfWithLandingAi(SECRET, big, deps(fetchMock)))).toBe("ocr_too_large");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends the key only as a header and never puts it in an error", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json(401, { message: SECRET }));
        let caught: unknown;
        try {
            await parsePdfWithLandingAi(SECRET, pdf, deps(fetchMock));
        } catch (error) {
            caught = error;
        }
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>).authorization).toContain(SECRET);
        expect(String((init.body as FormData).get("options"))).not.toContain(SECRET);
        expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught as object))).not.toContain(SECRET);
    });
});

describe("page helpers", () => {
    it("estimates about one cent per page", () => {
        expect(estimateOcrCostUsd(7)).toBe(0.07);
        expect(estimateOcrCostUsd(0)).toBe(0);
    });

    it("splits the markdown per page, or says it cannot", () => {
        const md = ["uno", "dos", "tres"].join(`\n\n${OCR_PAGE_BREAK}\n\n`) + `\n\n${OCR_PAGE_BREAK}`;
        expect(splitOcrPages(md, 3)).toEqual(["uno", "dos", "tres"]);
        expect(splitOcrPages("solo una", 1)).toEqual(["solo una"]);
        expect(splitOcrPages(md, 2)).toBeNull();
        expect(splitOcrPages(md, 0)).toBeNull();
    });
});
