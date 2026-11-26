import { describe, expect, it } from "vitest";
import type { Db } from "../documents.shared";
import { loadReadScan, loadScanRow } from "../documents.ocr.state";

// The database function hands out whole pages from an index until 500,000 characters are reached (at least one page).
const BUDGET = 500_000;
type Reading = { rev: string; stamp: string; pages: Array<{ page: number; text: string }> | null };
function readingDb(current: () => Reading | null, afterCall?: (n: number) => void) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from: () => { throw new Error("the pages are never selected from the table"); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const row = current();
      const answer = (() => {
        if (!row) return null;
        if (name === "document_ocr_state") return { version_id: "v1", source_revision: row.rev, status: "ready", failed_pages: [4], credits: 1.5, page_count: 9, error_code: null, model: "m", pages_read: row.pages?.length ?? null };
        if (row.pages === null) return { source_revision: row.rev, updated_at: row.stamp, pages: null, next: null };
        let i = Number(args.p_from); let chars = 0; const out: unknown[] = [];
        while (i < row.pages.length && chars < BUDGET) { out.push(row.pages[i]); chars += Array.from(row.pages[i].text).length; i += 1; }
        return { source_revision: row.rev, updated_at: row.stamp, pages: out, next: i < row.pages.length ? i : null };
      })();
      afterCall?.(calls.length);
      return { data: answer, error: null };
    },
  } as unknown as Db;
  return { db, calls };
}
const pages = (count: number, size: number) => Array.from({ length: count }, (_, i) => ({ page: i + 1, text: String(i).padStart(2, "0") + (i % 2 ? "é" : "😀").repeat(size - 2) }));

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
