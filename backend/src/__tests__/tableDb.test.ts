import { describe, expect, it } from "vitest";
import { tableDb } from "./helpers/tableDb";

// The in-memory table double must answer the way the real client does, or a
// test built on it passes on behaviour production does not have.
describe("tableDb", () => {
  const seed = () => ({
    items: [
      { id: "a", slug: "one", n: 1 },
      { id: "b", slug: "two", n: 2 },
    ],
  });

  it("returns no rows for a delete that did not ask for them", async () => {
    const { db, tables } = tableDb(seed());
    const plain = await db.from("items").delete().eq("id", "a");
    expect(plain).toEqual({ data: null, error: null });
    expect(tables.items.map((row) => row.id)).toEqual(["b"]);
    const single = await db.from("items").delete().eq("id", "b").maybeSingle();
    expect(single.data).toBeNull();
    expect(tables.items).toEqual([]);
  });

  it("returns the deleted rows when the delete asks for them", async () => {
    const { db } = tableDb(seed());
    const many = await db.from("items").delete().neq("id", "none").select();
    expect(many.data).toEqual([
      { id: "a", slug: "one", n: 1 },
      { id: "b", slug: "two", n: 2 },
    ]);
    const { db: other } = tableDb(seed());
    const one = await other.from("items").delete().eq("id", "b").select().single();
    expect(one.data).toEqual({ id: "b", slug: "two", n: 2 });
  });

  it("upserts on the conflict columns it is given, keeping the existing row's id", async () => {
    const { db, tables } = tableDb(seed());
    await db.from("items").upsert({ slug: "two", n: 20 }, { onConflict: "slug" });
    expect(tables.items).toEqual([
      { id: "a", slug: "one", n: 1 },
      { id: "b", slug: "two", n: 20 },
    ]);
    await db.from("items").upsert({ slug: "three", n: 3 }, { onConflict: "slug" });
    expect(tables.items.map((row) => row.slug)).toEqual(["one", "two", "three"]);
  });

  it("leaves a conflicting row as it is when duplicates are ignored", async () => {
    const { db, tables } = tableDb(seed());
    await db.from("items").upsert({ slug: "one", n: 99 }, { onConflict: "slug", ignoreDuplicates: true });
    expect(tables.items).toHaveLength(2);
    expect(tables.items[0]).toEqual({ id: "a", slug: "one", n: 1 });
  });

  it("matches on several conflict columns together", async () => {
    const { db, tables } = tableDb({ pairs: [{ id: "p", a: 1, b: 1, v: "old" }] });
    await db.from("pairs").upsert([{ a: 1, b: 2, v: "new-pair" }, { a: 1, b: 1, v: "same-pair" }], { onConflict: "a,b" });
    expect(tables.pairs.map((row) => [row.a, row.b, row.v])).toEqual([
      [1, 1, "same-pair"],
      [1, 2, "new-pair"],
    ]);
  });

  it("answers an upsert with the rows now stored, not with rows it generated", async () => {
    const { db, tables } = tableDb(seed());
    const merged = await db.from("items").upsert({ slug: "two", n: 20 }, { onConflict: "slug" }).select();
    expect(merged.data).toEqual([{ id: "b", slug: "two", n: 20 }]);
    const added = await db.from("items").upsert({ slug: "three", n: 3 }, { onConflict: "slug" }).select();
    expect(added.data).toHaveLength(1);
    expect(tables.items.find((row) => row.slug === "three")).toEqual(added.data![0]);
    expect(tables.items).toContainEqual(added.data![0]);
  });

  it("leaves a skipped duplicate out of the answer when duplicates are ignored", async () => {
    const { db, tables } = tableDb(seed());
    const answer = await db
      .from("items")
      .upsert([{ slug: "one", n: 99 }, { slug: "four", n: 4 }], { onConflict: "slug", ignoreDuplicates: true })
      .select();
    expect(answer.data).toHaveLength(1);
    expect(answer.data![0]).toMatchObject({ slug: "four", n: 4 });
    expect(tables.items).toContainEqual(answer.data![0]);
    const none = await db.from("items").upsert({ slug: "one", n: 5 }, { onConflict: "slug", ignoreDuplicates: true }).select();
    expect(none.data).toEqual([]);
  });

  it("answers one object when an insert or an upsert asks for a single row", async () => {
    const { db, tables } = tableDb(seed());
    const inserted = await db.from("items").insert({ slug: "five", n: 5 }).select().single();
    expect(inserted.data).toEqual(tables.items.find((row) => row.slug === "five"));
    const upserted = await db.from("items").upsert({ slug: "one", n: 11 }, { onConflict: "slug" }).select().single();
    expect(upserted.data).toEqual({ id: "a", slug: "one", n: 11 });
    const maybe = await db.from("items").insert({ slug: "six", n: 6 }).select().maybeSingle();
    expect(Array.isArray(maybe.data)).toBe(false);
    expect(maybe.data).toMatchObject({ slug: "six" });
  });
});
