import { describe, expect, it } from "vitest";
import { OCR_PAGE_MAX_BYTES, OCR_READING_MAX_BYTES, boundOcrReading } from "../pages";

const limits = { pageBytes: 10, readingBytes: 25 };
const page = (n: number, bytes: number, char = "a") => ({ page: n, text: char.repeat(bytes) });

describe("what a scan reading may store", () => {
  it("has the decided defaults", () => {
    expect(OCR_PAGE_MAX_BYTES).toBe(200_000);
    expect(OCR_READING_MAX_BYTES).toBe(10_000_000);
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
});
