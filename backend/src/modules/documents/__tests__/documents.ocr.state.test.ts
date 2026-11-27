import { describe, expect, it } from "vitest";
import type { Db } from "../documents.shared";
import { loadReadScan, loadScanRow } from "../documents.ocr.state";
import { ocrPagesOf } from "../../../__tests__/helpers/scanReadingRpc";

// The database function hands out whole pages from an index until 500,000 characters are reached (at least one page).
type Reading = { rev: string; stamp: string; pages: Array<{ page: number; text: string }> | null; state?: (stateCalls: number) => Record<string, unknown> };
function readingDb(current: () => Reading | null, afterCall?: (n: number) => void) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let stateCalls = 0;
  const db = {
    from: () => { throw new Error("the pages are never selected from the table"); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const row = current();
      const answer = (() => {
        if (!row) return null;
        const reading = { source_revision: row.rev, updated_at: row.stamp, pages: row.pages };
        if (name === "document_ocr_state") return { version_id: "v1", source_revision: row.rev, updated_at: row.stamp, status: "ready", failed_pages: [4], credits: 1.5, page_count: 9, error_code: null, model: "m", pages_read: row.pages?.length ?? null, ...row.state?.(stateCalls++) };
        return ocrPagesOf(reading, Number(args.p_from));
      })();
      afterCall?.(calls.length);
      return { data: answer, error: null };
    },
  } as unknown as Db;
  return { db, calls };
}
const pages = (count: number, size: number) => Array.from({ length: count }, (_, i) => ({ page: i + 1, text: String(i).padStart(2, "0") + "x".repeat(size - 2) }));

describe("the pages of a scan reading are read in bounded slices", () => {
  it("puts back, byte for byte, a reading several times the budget, in as many calls as the slices need", async () => {
    const all = pages(15, 120_000);
    const { db, calls } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all }));
    const row = await loadScanRow(db, "v1");
    expect(row?.pages).toEqual(all);
    expect(row).toMatchObject({ source_revision: "r1", status: "ready", failed_pages: [4], credits: 1.5, page_count: 9, model: "m" });
    expect(row).not.toHaveProperty("pages_read");
    expect(calls.filter((c) => c.name === "document_ocr_pages").map((c) => c.args.p_from)).toEqual([0, 5, 10]);
  });
  it("puts back pages with accents and characters outside the BMP unchanged", async () => {
    const all = Array.from({ length: 9 }, (_, i) => ({ page: i + 1, text: "é😀ñ".repeat(60_000) + i }));
    expect((await loadScanRow(readingDb(() => ({ rev: "r1", stamp: "t1", pages: all })).db, "v1"))?.pages).toEqual(all);
  });
  it("brings elements without text, with other kinds of text, and thousands of blank pages back whole, in bounded answers", async () => {
    const odd = [null, "a string", 7, { page: 1 }, { page: 2, text: 5 }, { page: 3, text: null }, { page: 4, text: "x" }] as unknown as Reading["pages"];
    const blank = Array.from({ length: 2500 }, (_, i) => ({ page: i + 1, text: "" }));
    for (const all of [odd, blank]) {
      const { db, calls } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all }));
      expect((await loadScanRow(db, "v1"))?.pages).toEqual(all);
      expect(calls.filter((c) => c.name === "document_ocr_pages").length).toBe(all === blank ? 3 : 1);
    }
  });
  it("brings a single page larger than the budget back, alone", async () => {
    const all = [{ page: 1, text: "x".repeat(900_000) }, { page: 2, text: "y" }];
    const { db, calls } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all }));
    expect((await loadScanRow(db, "v1"))?.pages).toEqual(all);
    expect(calls.filter((c) => c.name === "document_ocr_pages").map((c) => c.args.p_from)).toEqual([0, 1]);
  });
  it.each([[[]], [null]])("gives %j as it is", async (value) => {
    const { db } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: value }));
    expect((await loadScanRow(db, "v1"))?.pages).toEqual(value);
  });
  it("is null when there is no reading", async () => {
    const { db } = readingDb(() => null);
    expect(await loadScanRow(db, "v1")).toBeNull();
    expect(await loadReadScan(db, "v1", "r1")).toBeNull();
  });
  it("never yields a mix of two readings: a reading replaced between two slices starts again", async () => {
    const first = pages(15, 120_000); const second = pages(8, 130_000).map((p) => ({ ...p, text: `new ${p.text}` }));
    let replaced = false;
    const { db } = readingDb(() => (replaced ? { rev: "r1", stamp: "t2", pages: second } : { rev: "r1", stamp: "t1", pages: first }), (n) => { if (n === 2) replaced = true; });
    expect((await loadScanRow(db, "v1"))?.pages).toEqual(second);
  });
  it("reads again when the state is of another reading of the same revision, and fails if it keeps being so", async () => {
    const all = pages(3, 10);
    const { db } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all, state: (k) => (k === 0 ? { updated_at: "t2", failed_pages: [1, 2], model: "B" } : {}) }));
    const row = await loadScanRow(db, "v1");
    expect(row).toMatchObject({ failed_pages: [4], model: "m" });
    expect(row).not.toHaveProperty("updated_at");
    const stuck = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all, state: () => ({ updated_at: "t2" }) }));
    await expect(loadScanRow(stuck.db, "v1")).rejects.toThrow(/changed while it was being read/);
  });
  it("fails, rather than mix, when the reading keeps changing", async () => {
    let n = 0;
    const { db } = readingDb(() => ({ rev: "r1", stamp: `t${n++}`, pages: pages(15, 120_000) }));
    await expect(loadScanRow(db, "v1")).rejects.toThrow(/changed while it was being read/);
  });
  it("loadReadScan returns the pages and failed pages of exactly this revision, or null", async () => {
    const all = pages(3, 10);
    const { db } = readingDb(() => ({ rev: "r1", stamp: "t1", pages: all }));
    expect(await loadReadScan(db, "v1", "r1")).toEqual({ pages: all, failedPages: [4] });
    expect(await loadReadScan(db, "v1", "other")).toBeNull();
    expect(await loadReadScan(readingDb(() => ({ rev: "r1", stamp: "t1", pages: null })).db, "v1", "r1")).toBeNull();
  });
});
