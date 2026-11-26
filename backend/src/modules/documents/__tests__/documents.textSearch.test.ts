import { expect, it } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import { findDocumentText, readStoredDocumentText, storedDocumentTextCurrent } from "../documents.textSearch";
const id = "00000000-0000-4000-8000-000000000001";
it("passes only the authenticated actor and explicit workspace to the permission-scoped query", async () => {
  const fake = scriptedDb([{ rpc: "find_document_text", data: { matches: [], next_offset: null, coverage: {} } }]);
  expect((await findDocumentText(fake.db, { userId: id, userEmail: "actor@example.test", scope: "library", query: "100% consent" })).ok).toBe(true);
  expect(fake.calls[0].args).toEqual({ p_user_id: id, p_user_email: "actor@example.test", p_workspace: "personal", p_scope: "library", p_query: "100% consent", p_project_id: null, p_document_id: null, p_version_id: null, p_limit: 10, p_offset: 0 });
  fake.done();
});
it.each([
  { scope: "all", query: "clause" }, { scope: "library", query: "a" },
  { scope: "library", query: "x".repeat(501) }, { scope: "project", query: "clause" },
  { scope: "document", query: "clause", documentId: "not-a-uuid" },
  { scope: "library", query: "clause", limit: 1000 }, { scope: "library", query: "clause", offset: -1 },
  { scope: "library", query: "clause", versionId: id },
])("rejects unbounded or inconsistent input without querying: %j", async (args) => {
  const fake = scriptedDb([]);
  expect(await findDocumentText(fake.db, { userId: id, ...args })).toMatchObject({ ok: false, kind: "validation" }); fake.done();
});
it("reads an exact version through the same actor authorization", async () => {
  const fake = scriptedDb([{ rpc: "read_document_text", data: null }]);
  expect(await readStoredDocumentText(fake.db, { userId: "actor", documentId: "document", versionId: "historical" })).toBeNull();
  expect(fake.calls[0].args).toMatchObject({ p_user_id: "actor", p_document_id: "document", p_version_id: "historical" }); fake.done();
});
it("treats held text as current only while the actor may read it at the same live revision", async () => {
  const args = { userId: "actor", documentId: "document", versionId: "historical", revision: "r1" };
  for (const [access, version, expected] of [[true, { text_revision: "r1" }, true], [false, { text_revision: "r1" }, false], [true, { text_revision: "r2" }, false], [true, null, false]] as const) {
    const fake = scriptedDb([{ rpc: "document_text_access", data: access }, { table: "document_versions", data: version }]);
    expect(await storedDocumentTextCurrent(fake.db, args)).toBe(expected);
    expect(fake.calls[0].args).toEqual({ p_document_id: "document", p_user_id: "actor", p_user_email: null });
    expect(fake.calls[1].filters).toEqual([["eq", "id", "historical"], ["eq", "document_id", "document"], ["is", "deleted_at", null]]);
    fake.done();
  }
});

// --- stored text is read in bounded slices; searches are bounded and capped ---
import type { Db } from "../../../lib/supabase";
const SLICE = 500_000; // the most characters one database response may carry
type Call = { name: string; args: Record<string, unknown> };
/** A database whose read_document_text honours p_offset/p_length like the SQL function does. */
function sliceDb(text: string | null, opts: { status?: string; revisions?: string[] } = {}) {
  const calls: Call[] = [];
  const points = text === null ? null : Array.from(text);
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const offset = Number(args.p_offset ?? 0);
      const length = Math.min(Number(args.p_length ?? points?.length ?? 0), SLICE);
      return { error: null, data: {
        revision: opts.revisions?.[calls.length - 1] ?? "r1", status: opts.status ?? "ready",
        text: points === null ? null : points.slice(offset, offset + length).join(""),
        text_length: points === null ? null : points.length, textless_page_count: 0,
      } };
    },
  } as unknown as Db;
  return { db, calls };
}
const who = { userId: "actor", documentId: "document", versionId: "version" };

it("never asks the database for more than one bounded slice at a time, and assembles the whole text from slices", async () => {
  const text = "x".repeat(SLICE) + "y".repeat(SLICE) + "tail";
  const { db, calls } = sliceDb(text);
  const stored = await readStoredDocumentText(db, who);
  expect(stored?.text).toBe(text);
  expect(calls.length).toBe(3);
  for (const call of calls) expect(Number(call.args.p_length)).toBeLessThanOrEqual(SLICE);
  expect(calls.map((c) => c.args.p_offset)).toEqual([0, SLICE, 2 * SLICE]);
});
it("keeps characters outside the BMP whole across a slice boundary", async () => {
  const text = "😀".repeat(SLICE) + "é" + "😀";
  const { db } = sliceDb(text);
  expect((await readStoredDocumentText(db, who))?.text).toBe(text);
});
it.each([["empty", ""], ["exactly one slice", "z".repeat(SLICE)], ["one past a slice", "z".repeat(SLICE + 1)]])("reads %s text back unchanged", async (_label, text) => {
  const { db, calls } = sliceDb(text);
  expect((await readStoredDocumentText(db, who))?.text).toBe(text);
  expect(calls.length).toBe(Math.max(1, Math.ceil(text.length / SLICE)));
});
it("asks only for the window a caller needs", async () => {
  const text = "0123456789".repeat(100_000);
  const { db, calls } = sliceDb(text);
  const stored = await readStoredDocumentText(db, { ...who, offset: 70, maxChars: 30_000 });
  expect(calls.length).toBe(1);
  expect(calls[0].args).toMatchObject({ p_offset: 70, p_length: 30_000 });
  expect(stored?.text).toBe(text.slice(70, 30_070));
  expect(stored?.text_length).toBe(text.length);
});
it("keeps the not-ready answers of the stored text", async () => {
  const { db } = sliceDb(null, { status: "pending" });
  expect(await readStoredDocumentText(db, who)).toMatchObject({ status: "pending", text: null });
});
it("refuses to splice slices of two different revisions", async () => {
  const { db } = sliceDb("a".repeat(SLICE + 5), { revisions: ["r1", "r2"] });
  await expect(readStoredDocumentText(db, who)).rejects.toThrow(/changed while it was being read/);
});

function pendingSearchDb() {
  const waiting: Array<() => void> = [];
  const db = { rpc: () => new Promise((resolve) => waiting.push(() => resolve({ data: { matches: [], next_offset: null, coverage: {} }, error: null }))) } as unknown as Db;
  return { db, release: () => waiting.splice(0).forEach((f) => f()), started: () => waiting.length };
}
const search = (db: Db, userId: string) => findDocumentText(db, { userId, scope: "library", query: "clause" });
/** The answer if it comes at once, "running" when the search was let through to wait on the database. */
const answerNow = (promise: ReturnType<typeof search>) => Promise.race([promise, new Promise<string>((r) => setTimeout(() => r("running"), 20))]);
it("lets one person run only a couple of searches at once and frees the place when they end", async () => {
  const { db, release, started } = pendingSearchDb();
  const running = [search(db, id), search(db, id)];
  await Promise.resolve();
  expect(await answerNow(search(db, id))).toMatchObject({ ok: false, kind: "unavailable" });
  expect(started()).toBeLessThanOrEqual(2);
  release();
  expect((await Promise.all(running)).every((r) => r.ok)).toBe(true);
  const again = search(db, id); await Promise.resolve(); release();
  expect((await again).ok).toBe(true);
});
it("caps the searches running at once for everybody, whoever asks", async () => {
  const { db, release, started } = pendingSearchDb();
  const running = Array.from({ length: 6 }, (_, i) => search(db, `00000000-0000-4000-8000-0000000001${i}0`));
  await Promise.resolve();
  expect(started()).toBe(6);
  expect(await answerNow(search(db, "00000000-0000-4000-8000-000000000999"))).toMatchObject({ ok: false, kind: "unavailable" });
  release(); await Promise.all(running);
});
it("frees the place when the database fails", async () => {
  const db = { rpc: async () => ({ data: null, error: { code: "57014", message: "canceled" } }) } as unknown as Db;
  for (let i = 0; i < 5; i += 1) expect(await search(db, id)).toMatchObject({ ok: false, kind: "error" });
});
it("tells the caller when a search stopped on its time budget", async () => {
  const db = { rpc: async () => ({ data: { matches: [], next_offset: null, coverage: { total_versions: 3, search_incomplete: true } }, error: null }) } as unknown as Db;
  const result = await search(db, id);
  expect(result.ok && result.data.coverage).toMatchObject({ search_incomplete: true });
  expect(result.ok && JSON.stringify(result.data.coverage)).toMatch(/not conclusive/);
});
