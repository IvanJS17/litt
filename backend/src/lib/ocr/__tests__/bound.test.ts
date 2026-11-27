import { describe, expect, it } from "vitest";
import { OCR_PAGE_MAX_BYTES, OCR_READING_MAX_BYTES, OCR_READING_MAX_PAGES, boundOcrReading as bound } from "../pages";

const limits = { pageBytes: 10, readingBytes: 25, readingPages: 20_000 };
// the bounded result of a reading that is not too large
const boundOcrReading = (r: Parameters<typeof bound>[0], l: Parameters<typeof bound>[1]) => bound(r, l)!;
const page = (n: number, bytes: number, char = "a") => ({ page: n, text: char.repeat(bytes) });

describe("what a scan reading may store", () => {
  it("has the decided defaults", () => {
    expect(OCR_PAGE_MAX_BYTES).toBe(200_000);
    expect(OCR_READING_MAX_BYTES).toBe(10_000_000);
    expect(OCR_READING_MAX_PAGES).toBe(20_000);
  });

  it("stores a page of exactly the bound, whole; one byte more is listed as not read and not stored", () => {
    const out = boundOcrReading({ pages: [page(1, 10), page(2, 11), page(3, 3)], failedPages: [] }, limits);
    expect(out.pages).toEqual([page(1, 10), page(3, 3)]);
    expect(out.failedPages).toEqual([2]);
  });

  it("counts bytes, not characters", () => {
    // 5 two-byte characters = 10 bytes (fits), 3 four-byte characters = 12 bytes (does not)
    const out = boundOcrReading({ pages: [{ page: 1, text: "ñ".repeat(5) }, { page: 2, text: "😀".repeat(3) }], failedPages: [] }, limits);
    expect(out.pages.map((p) => p.page)).toEqual([1]);
    expect(out.failedPages).toEqual([2]);
  });

  it("keeps pages in order while the whole fits and lists every later page, even a small one", () => {
    const out = boundOcrReading({ pages: [page(1, 10), page(2, 10), page(3, 10), page(4, 1)], failedPages: [] }, limits);
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.failedPages).toEqual([3, 4]);
  });

  it("does not count a page that is listed for its own size against the whole", () => {
    const out = boundOcrReading({ pages: [page(1, 10), page(2, 99), page(3, 10)], failedPages: [] }, limits);
    expect(out.pages.map((p) => p.page)).toEqual([1, 3]);
    expect(out.failedPages).toEqual([2]);
  });

  it("decides in page order whatever the order the pages arrive in, and returns the kept ones as they came", () => {
    const out = boundOcrReading({ pages: [page(3, 10), page(2, 10), page(1, 10)], failedPages: [] }, limits);
    expect(out.pages.map((p) => p.page)).toEqual([2, 1]);
    expect(out.failedPages).toEqual([3]);
  });

  it("lists a page the service failed on once, and keeps the order and numbers of the rest", () => {
    const out = boundOcrReading({ pages: [page(1, 3), page(2, 50), page(4, 3)], failedPages: [2, 3] }, limits);
    expect(out.failedPages).toEqual([2, 3]);
    expect(out.pages).toEqual([page(1, 3), page(4, 3)]);
  });

  it("removes NUL characters before it counts, and never cuts a text", () => {
    const out = boundOcrReading({ pages: [{ page: 1, text: "a\0".repeat(10) }], failedPages: [] }, limits);
    expect(out.pages).toEqual([{ page: 1, text: "a".repeat(10) }]);
  });

  it("an empty reading is empty", () => {
    expect(boundOcrReading({ pages: [], failedPages: [] }, limits)).toEqual({ pages: [], failedPages: [] });
  });

  it("stores 20,000 pages; one more and the reading is too large, with nothing to store", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ page: i + 1, text: "" }));
    const at = bound({ pages: many(20_000), failedPages: [] }, limits);
    expect(at?.pages).toHaveLength(20_000);
    expect(bound({ pages: many(20_001), failedPages: [] }, limits)).toBeNull();
  });

  it("a list of pages not read longer than the same number is too large too", () => {
    const failed = Array.from({ length: 20_001 }, (_, i) => i + 1);
    expect(bound({ pages: [], failedPages: failed }, limits)).toBeNull();
    expect(bound({ pages: [], failedPages: [...failed.slice(0, 20_000), 3, 3, 4] }, limits)?.failedPages).toHaveLength(20_000);
  });

  it("stores a page number once (the first wins); a page the service lists as failed keeps its text and stays listed once", () => {
    const out = boundOcrReading({ pages: [{ page: 2, text: "first" }, { page: 2, text: "second" }, { page: 1, text: "uno" }, { page: 3, text: "tres" }], failedPages: [3] }, limits);
    expect(out.pages).toEqual([{ page: 2, text: "first" }, { page: 1, text: "uno" }, { page: 3, text: "tres" }]);
    expect(out.failedPages).toEqual([3]);
  });

  it("drops malformed entries without throwing, and lists them when the number is a valid page", () => {
    const entries = [
      { page: 0, text: "x" }, { page: -1, text: "x" }, { page: 1.5, text: "x" }, { page: 2 ** 60, text: "x" }, { page: Number.NaN, text: "x" },
      { page: "4" as unknown as number, text: "x" }, { page: 5, text: 7 as unknown as string }, { page: 6, text: null as unknown as string },
      null as unknown as { page: number; text: string }, { page: 7, text: "ok" },
    ];
    const out = boundOcrReading({ pages: entries, failedPages: [0, -2, 1.5, Number.NaN, 9] }, limits);
    expect(out.pages).toEqual([{ page: 7, text: "ok" }]);
    expect(out.failedPages).toEqual([9, 5, 6]);
  });

  it("is linear: 100,000 dropped pages give the result without a quadratic scan", () => {
    const pages = Array.from({ length: 100_000 }, (_, i) => ({ page: i + 1, text: "x".repeat(11) }));
    const out = bound({ pages, failedPages: [] }, { ...limits, readingPages: 100_000 })!;
    expect(out.pages).toEqual([]);
    expect(out.failedPages).toHaveLength(100_000);
  });
});
