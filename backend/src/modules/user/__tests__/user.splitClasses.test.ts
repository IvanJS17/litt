import { describe, expect, it, vi } from "vitest";
import { getSplitClasses, saveSplitClasses } from "../user.splitClasses";

const one = { name: "Poder", description: "Un poder notarial." };

function db(options: { stored?: unknown; exists?: boolean; error?: unknown } = {}) {
    const updates: unknown[] = [];
    const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        update: (patch: unknown) => {
            updates.push(patch);
            return q;
        },
        maybeSingle: async () => ({ data: { split_classes: options.stored ?? null }, error: options.error ?? null }),
        then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: options.exists === false ? [] : [{ user_id: "u" }], error: options.error ?? null }).then(resolve),
    };
    return { client: { from: vi.fn(() => q) } as never, updates };
}

describe("personal split classes", () => {
    it("reads the built-in list until the person saves one", async () => {
        expect(await getSplitClasses(db().client, "u")).toMatchObject({ ok: true, data: { custom: false, max: 19 } });
        expect(await getSplitClasses(db({ stored: [one] }).client, "u")).toMatchObject({ ok: true, data: { custom: true, classes: [one] } });
    });

    it("saves a checked list and returns it", async () => {
        const { client, updates } = db();
        expect(await saveSplitClasses(client, "u", { classes: [{ ...one, name: " Poder " }] })).toMatchObject({ ok: true, data: { custom: true, classes: [one] } });
        expect(updates).toEqual([{ split_classes: [one] }]);
    });

    it("restores the built-in list with null", async () => {
        const { client, updates } = db({ stored: [one] });
        expect(await saveSplitClasses(client, "u", { classes: null })).toMatchObject({ ok: true, data: { custom: false } });
        expect(updates).toEqual([{ split_classes: null }]);
    });

    it("refuses an invalid body without writing, a missing profile, and a database failure", async () => {
        const bad = db();
        expect(await saveSplitClasses(bad.client, "u", { classes: [] })).toMatchObject({ ok: false, kind: "validation" });
        expect(bad.updates).toEqual([]);
        expect(await saveSplitClasses(db({ exists: false }).client, "u", { classes: [one] })).toMatchObject({ ok: false, kind: "not_found" });
        expect(await saveSplitClasses(db({ error: new Error("x") }).client, "u", { classes: [one] })).toMatchObject({ ok: false, kind: "error" });
        expect(await getSplitClasses(db({ error: new Error("x") }).client, "u")).toMatchObject({ ok: false, kind: "error" });
    });
});
