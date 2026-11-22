import { describe, expect, it } from "vitest";
import { keepReadableDerived } from "../access";

type Row = Record<string, unknown>;

// Personal documents only: a document is readable by the reader who owns it.
function documentsDb(docs: Row[], failure: string | null = null) {
    const lookups: string[][] = [];
    const db = {
        from: (table: string) => {
            const builder: any = {
                select: () => builder,
                in: (_column: string, ids: string[]) => {
                    lookups.push(ids);
                    builder.rows = docs.filter((doc) => ids.includes(doc.id as string));
                    return builder;
                },
                then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve(
                        failure
                            ? { data: null, error: { message: failure } }
                            : { data: table === "documents" ? builder.rows : [], error: null },
                    ).then(resolve),
            };
            return builder;
        },
    } as any;
    return { db, lookups };
}

const reader = { userId: "reader", userEmail: "reader@example.test" };
const mine = (id: string): Row => ({ id, user_id: "reader", project_id: null, org_id: null });
const theirs = (id: string): Row => ({ id, user_id: "other", project_id: null, org_id: null });
type Item = { id: string; sources: string[] | null };
const sourcesOf = (item: Item) => item.sources;

describe("keepReadableDerived", () => {
    it("keeps every item whose sources the reader can open", async () => {
        const { db } = documentsDb([mine("d1"), mine("d2")]);
        const items: Item[] = [
            { id: "a", sources: ["d1"] },
            { id: "b", sources: ["d1", "d2"] },
        ];
        expect(await keepReadableDerived(db, reader, items, sourcesOf)).toEqual(items);
    });

    it("withholds an item with one source the reader cannot open, and one whose source is gone", async () => {
        const { db } = documentsDb([mine("d1"), theirs("d2")]);
        const items: Item[] = [
            { id: "ok", sources: ["d1"] },
            { id: "walled", sources: ["d1", "d2"] },
            { id: "deleted", sources: ["d-gone"] },
        ];
        expect((await keepReadableDerived(db, reader, items, sourcesOf)).map((i) => i.id)).toEqual(["ok"]);
    });

    it("withholds an item of unknown provenance, keeps one with no sources", async () => {
        const { db, lookups } = documentsDb([mine("d1")]);
        const items: Item[] = [
            { id: "unknown", sources: null },
            { id: "none", sources: [] },
        ];
        expect((await keepReadableDerived(db, reader, items, sourcesOf)).map((i) => i.id)).toEqual(["none"]);
        expect(lookups).toEqual([]);
    });

    it("asks once for the union of all sources", async () => {
        const { db, lookups } = documentsDb([mine("d1"), mine("d2"), mine("d3")]);
        const items: Item[] = [
            { id: "a", sources: ["d1", "d2"] },
            { id: "b", sources: ["d2", "d3"] },
            { id: "c", sources: ["d1"] },
        ];
        await keepReadableDerived(db, reader, items, sourcesOf);
        expect(lookups).toHaveLength(1);
        expect([...lookups[0]].sort()).toEqual(["d1", "d2", "d3"]);
    });

    it("throws when the lookup fails, so the caller fails closed", async () => {
        const { db } = documentsDb([mine("d1")], "boom");
        await expect(
            keepReadableDerived(db, reader, [{ id: "a", sources: ["d1"] }], sourcesOf),
        ).rejects.toThrow();
    });

    it("returns an empty list for no items", async () => {
        const { db } = documentsDb([]);
        expect(await keepReadableDerived(db, reader, [], sourcesOf)).toEqual([]);
    });
});
