import { describe, expect, it, vi } from "vitest";
import { LANDINGAI_HOST, OcrError } from "../landingai";
import { SPLIT_UNCATEGORIZED, readSplitResponse, splitWithLandingAi } from "../landingaiSplit";
import { OCR_PAGE_BREAK, buildSplitMarkdown, estimateSplitCost } from "../pages";

// The real LandingAI API is never called: fetch is a mock.
const SECRET = "synthetic-key-0001";
const classes = [
    { name: "Poder", description: "Un poder notarial." },
    { name: "Constancia", description: "Constancia fiscal.", identifier: "RFC" },
];
const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (splits: unknown[], credit_usage: unknown = 1.5) => json(200, { splits, metadata: { credit_usage } });
const codeOf = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(OcrError);
        expect(JSON.stringify(error)).not.toContain(SECRET);
        expect((error as OcrError).message).not.toContain(SECRET);
        return (error as OcrError).code;
    }
    throw new Error("expected a failure");
};
const call = (fetchImpl: ReturnType<typeof vi.fn>, markdown = buildSplitMarkdown(["uno", "dos", "tres"]), pages = 3) =>
    splitWithLandingAi(SECRET, markdown, pages, classes, { fetch: fetchImpl as unknown as typeof fetch });

describe("the markdown Split reads", () => {
    it("joins the pages with LandingAI's marker, in order, and removes a marker the page itself held", () => {
        expect(buildSplitMarkdown(["uno", ` dos ${OCR_PAGE_BREAK} `, ""])).toBe(
            `uno\n\n${OCR_PAGE_BREAK}\n\ndos\n\n${OCR_PAGE_BREAK}\n\n`,
        );
    });

    it("estimates 1 credit per 5,000 characters and 0.01 US dollars per credit", () => {
        expect(estimateSplitCost(0)).toEqual({ credits: 0, usd: 0 });
        expect(estimateSplitCost(5000)).toEqual({ credits: 1, usd: 0.01 });
        expect(estimateSplitCost(79500)).toEqual({ credits: 15.9, usd: 0.16 });
        expect(estimateSplitCost(-5)).toEqual({ credits: 0, usd: 0 });
    });
});

describe("splitWithLandingAi", () => {
    it("posts the markdown file and the types as a JSON string, with the key only in the header", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
            answer([
                { classification: "Poder", identifier: null, pages: [0, 1], markdowns: ["x"] },
                { classification: "Constancia", identifier: "GACM701119BH5", pages: [2], markdowns: ["y"] },
            ]),
        );
        const result = await call(fetchMock);
        expect(result).toEqual({
            groups: [
                { type: "Poder", identifier: null, pages: [1, 2] },
                { type: "Constancia", identifier: "GACM701119BH5", pages: [3] },
            ],
            credits: 1.5,
        });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${LANDINGAI_HOST}/v1/split`);
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
        const form = init.body as FormData;
        expect(JSON.parse(form.get("split_class") as string)).toEqual([
            { name: "Poder", description: "Un poder notarial." },
            { name: "Constancia", description: "Constancia fiscal.", identifier: "RFC" },
        ]);
        expect((form.get("markdown") as File).name).toBe("documento.md");
        expect(await (form.get("markdown") as File).text()).toBe(buildSplitMarkdown(["uno", "dos", "tres"]));
        expect(JSON.stringify([...form.keys()])).not.toContain(SECRET);
        expect(String(url)).not.toContain(SECRET);
    });

    it("turns uncategorized pages into a group without a type", async () => {
        const result = await call(
            vi.fn().mockResolvedValueOnce(answer([{ classification: SPLIT_UNCATEGORIZED, identifier: null, pages: [0, 1, 2] }])),
        );
        expect(result.groups).toEqual([{ type: null, identifier: null, pages: [1, 2, 3] }]);
    });

    it.each([
        [401, "ocr_key_invalid"],
        [403, "ocr_key_invalid"],
        [402, "ocr_no_credits"],
        [413, "split_too_large"],
        [422, "ocr_not_supported"],
        [429, "ocr_unavailable"],
        [500, "ocr_unavailable"],
    ])("maps HTTP %i to %s without retrying", async (status, code) => {
        const fetchMock = vi.fn().mockResolvedValue(json(status, { error: `leaked ${SECRET}` }));
        expect(await codeOf(call(fetchMock))).toBe(code);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps a network failure and a malformed answer to ocr_unavailable", async () => {
        expect(await codeOf(call(vi.fn().mockRejectedValue(new Error(`boom ${SECRET}`))))).toBe("ocr_unavailable");
        expect(await codeOf(call(vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))))).toBe("ocr_unavailable");
        expect(await codeOf(call(vi.fn().mockResolvedValue(json(200, { nothing: true }))))).toBe("ocr_unavailable");
    });

    it("refuses before sending: no key, nothing to read, too many pages, too many types, too much text", async () => {
        const fetchMock = vi.fn();
        const deps = { fetch: fetchMock as unknown as typeof fetch };
        expect(await codeOf(splitWithLandingAi(" ", "a", 1, classes, deps))).toBe("ocr_key_invalid");
        expect(await codeOf(splitWithLandingAi(SECRET, "  ", 1, classes, deps))).toBe("ocr_not_supported");
        expect(await codeOf(splitWithLandingAi(SECRET, "a", 1, [], deps))).toBe("ocr_not_supported");
        expect(await codeOf(splitWithLandingAi(SECRET, "a", 401, classes, deps))).toBe("split_too_large");
        const many = Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, description: "d" }));
        expect(await codeOf(splitWithLandingAi(SECRET, "a", 1, many, deps))).toBe("split_too_large");
        expect(await codeOf(splitWithLandingAi(SECRET, "a".repeat(4 * 1024 * 1024 + 1), 1, classes, deps))).toBe("split_too_large");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stops when the caller aborts", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.reject(init.signal?.reason ?? new Error("aborted")));
        expect(
            await codeOf(
                splitWithLandingAi(SECRET, "a", 1, classes, { fetch: fetchMock as unknown as typeof fetch, signal: controller.signal }),
            ),
        ).toBe("ocr_unavailable");
    });
});

describe("readSplitResponse", () => {
    const read = (splits: unknown, pageCount = 4, metadata: unknown = { credit_usage: 2 }) =>
        readSplitResponse({ splits, metadata } as Record<string, unknown>, pageCount, classes);

    it("rebuilds a partition: a page named twice stays with the first group, a page left out gets its own group", () => {
        const result = read([
            { classification: "Poder", pages: [2, 0] },
            { classification: "Constancia", pages: [0, 1] },
        ]);
        expect(result.groups).toEqual([
            { type: "Poder", identifier: null, pages: [1, 3] },
            { type: "Constancia", identifier: null, pages: [2] },
            { type: null, identifier: null, pages: [4] },
        ]);
    });

    it("drops pages outside the file and groups with none, and does not trust an unknown type", () => {
        const result = read([
            { classification: "Invented", pages: [0, 99, -1, 1.5, "2"] },
            { classification: "Poder", pages: [] },
            "junk",
        ]);
        expect(result.groups).toEqual([
            { type: null, identifier: null, pages: [1] },
            { type: null, identifier: null, pages: [2, 3, 4] },
        ]);
    });

    it("keeps a short identifier and ignores credits that are not a number", () => {
        const result = read([{ classification: "Constancia", identifier: "  GACM701119BH5 ", pages: [0, 1, 2, 3] }], 4, { credit_usage: "x" });
        expect(result).toEqual({ groups: [{ type: "Constancia", identifier: "GACM701119BH5", pages: [1, 2, 3, 4] }], credits: 0 });
        expect(read([{ classification: "Poder", identifier: "x".repeat(201), pages: [0, 1, 2, 3] }]).groups[0].identifier).toBeNull();
    });
});
