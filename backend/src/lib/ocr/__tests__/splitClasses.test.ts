import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SPLIT_CLASSES,
    SPLIT_CLASSES_MAX_BYTES,
    SPLIT_CLASSES_TOO_LARGE_CODE,
    SPLIT_MAX_CLASSES,
    splitClassesBytes,
    normalizeSplitClasses,
    parseSplitClassesBody,
    readStoredSplitClasses,
    splitClassesSettings,
} from "../splitClasses";
import { readOrgSplitClasses, readUserSplitClasses, resolveSplitClasses, saveOrgSplitClasses, saveUserSplitClasses } from "../splitClassStore";

const one = { name: "Poder", description: "Un poder notarial." };

describe("the built-in list", () => {
    it("has the twelve Mexican types, within Split's limit, and passes its own validation", () => {
        expect(DEFAULT_SPLIT_CLASSES).toHaveLength(12);
        expect(DEFAULT_SPLIT_CLASSES.length).toBeLessThanOrEqual(SPLIT_MAX_CLASSES);
        expect(DEFAULT_SPLIT_CLASSES.map((c) => c.name)).toContain("Constancia de situación fiscal");
        expect(DEFAULT_SPLIT_CLASSES.filter((c) => c.identifier).map((c) => c.identifier)).toEqual([
            "RFC del contribuyente",
            "Nombre del titular",
            "Nombre del titular",
        ]);
        expect(normalizeSplitClasses(DEFAULT_SPLIT_CLASSES)).toEqual({ ok: true, classes: DEFAULT_SPLIT_CLASSES });
    });
});

describe("the size the database allows", () => {
    const big = (letter: string) =>
        Array.from({ length: SPLIT_MAX_CLASSES }, (_, i) => ({
            name: `${String(i).padStart(2, "0")}${letter.repeat(78)}`,
            description: letter.repeat(800),
            identifier: letter.repeat(80),
        }));

    it("takes the largest list of plain letters and the built-in list, both under the limit", () => {
        const widest = normalizeSplitClasses(big("a"));
        expect(widest.ok).toBe(true);
        expect(splitClassesBytes(big("a"))).toBeLessThanOrEqual(SPLIT_CLASSES_MAX_BYTES);
        expect(splitClassesBytes(DEFAULT_SPLIT_CLASSES)).toBeLessThanOrEqual(SPLIT_CLASSES_MAX_BYTES);
    });

    it("refuses, with its own code, a list whose accents push it over, before the database check could", () => {
        const refused = normalizeSplitClasses(big("á"));
        expect(refused).toMatchObject({ ok: false, code: SPLIT_CLASSES_TOO_LARGE_CODE });
        expect(parseSplitClassesBody({ classes: big("á") })).toMatchObject({ ok: false, code: SPLIT_CLASSES_TOO_LARGE_CODE });
    });
});

describe("normalizeSplitClasses", () => {
    it("trims and collapses whitespace, and drops an empty identifier", () => {
        expect(normalizeSplitClasses([{ name: "  Acta  ", description: " a\n b ", identifier: "  " }])).toEqual({
            ok: true,
            classes: [{ name: "Acta", description: "a b" }],
        });
        expect(normalizeSplitClasses([{ ...one, identifier: " RFC " }])).toEqual({ ok: true, classes: [{ ...one, identifier: "RFC" }] });
    });

    it.each([
        ["not an array", "x"],
        ["empty", []],
        ["an item that is not an object", ["x"]],
        ["no name", [{ description: "d" }]],
        ["no description", [{ name: "n" }]],
        ["a name too long", [{ name: "n".repeat(81), description: "d" }]],
        ["a description too long", [{ name: "n", description: "d".repeat(801) }]],
        ["an identifier too long", [{ ...one, identifier: "i".repeat(81) }]],
        ["a duplicate name, in any case", [one, { ...one, name: "PODER" }]],
        ["the reserved name", [{ name: "Uncategorized", description: "d" }]],
        ["more than 19 types", Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, description: "d" }))],
    ])("refuses %s as a whole", (_label, input) => {
        expect(normalizeSplitClasses(input)).toMatchObject({ ok: false });
    });

    it("accepts exactly 19 types", () => {
        const list = Array.from({ length: 19 }, (_, i) => ({ name: `t${i}`, description: "d" }));
        expect(normalizeSplitClasses(list)).toMatchObject({ ok: true });
    });
});

describe("stored values, settings and bodies", () => {
    it("ignores a stored value that is no longer valid", () => {
        expect(readStoredSplitClasses(null)).toBeNull();
        expect(readStoredSplitClasses([{ name: "" }])).toBeNull();
        expect(readStoredSplitClasses([one])).toEqual([one]);
    });

    it("shows the built-in list until a scope saves its own, and always offers the defaults", () => {
        expect(splitClassesSettings(null)).toMatchObject({ custom: false, max: 19, classes: DEFAULT_SPLIT_CLASSES });
        const own = splitClassesSettings([one]);
        expect(own).toMatchObject({ custom: true, classes: [one] });
        expect(own.defaults).toEqual(DEFAULT_SPLIT_CLASSES);
        // A copy: editing what the screen got never edits the built-in list.
        splitClassesSettings(null).classes[0].name = "changed";
        expect(DEFAULT_SPLIT_CLASSES[0].name).toBe("Carátula del instrumento");
    });

    it("reads a PUT body: a list saves, null restores, anything else is refused", () => {
        expect(parseSplitClassesBody({ classes: [one] })).toEqual({ ok: true, classes: [one] });
        expect(parseSplitClassesBody({ classes: null })).toEqual({ ok: true, classes: null });
        expect(parseSplitClassesBody({})).toMatchObject({ ok: false });
        expect(parseSplitClassesBody(null)).toMatchObject({ ok: false });
        expect(parseSplitClassesBody({ classes: [] })).toMatchObject({ ok: false });
    });
});

/** A client over two tables, each holding the split_classes value of one row. */
function fakeDb(rows: { user_profiles?: unknown; organizations?: unknown }, error: unknown = null) {
    const updates: { table: string; patch: Record<string, unknown> }[] = [];
    const db = {
        from: (table: "user_profiles" | "organizations") => {
            let patch: Record<string, unknown> | null = null;
            const q: Record<string, unknown> = {
                select: () => q,
                eq: () => q,
                update: (value: Record<string, unknown>) => {
                    patch = value;
                    return q;
                },
                maybeSingle: async () => ({ data: rows[table] === undefined ? null : { split_classes: rows[table] }, error }),
                then: (resolve: (v: unknown) => unknown) => {
                    if (patch) updates.push({ table, patch });
                    return Promise.resolve({ data: rows[table] === undefined && table === "organizations" ? [] : [{}], error }).then(resolve);
                },
            };
            return q;
        },
    };
    return { db: db as never, updates };
}

describe("the store", () => {
    const own = [{ name: "Mía", description: "Mi tipo." }];
    const firm = [{ name: "Despacho", description: "Tipo del despacho." }];

    it("uses the firm's list in a firm's workspace, even when the person has their own", async () => {
        expect(await resolveSplitClasses(fakeDb({ user_profiles: own, organizations: firm }).db, "u", "o")).toEqual({ classes: firm, source: "org" });
        expect(await resolveSplitClasses(fakeDb({ user_profiles: null, organizations: firm }).db, "u", "o")).toEqual({ classes: firm, source: "org" });
    });

    it("falls back to the built-in list, not the personal one, when the firm has none", async () => {
        expect(await resolveSplitClasses(fakeDb({ user_profiles: own, organizations: null }).db, "u", "o")).toMatchObject({ source: "default" });
        expect(await resolveSplitClasses(fakeDb({ user_profiles: null, organizations: null }).db, "u", "o")).toMatchObject({ source: "default" });
    });

    it("uses the person's list in the personal workspace, and never reads a firm's there", async () => {
        expect(await resolveSplitClasses(fakeDb({ user_profiles: own, organizations: firm }).db, "u", null)).toEqual({ classes: own, source: "user" });
        expect(await resolveSplitClasses(fakeDb({ user_profiles: null, organizations: firm }).db, "u", null)).toMatchObject({ source: "default" });
    });

    it("hands out a copy of the built-in list", async () => {
        const first = await resolveSplitClasses(fakeDb({}).db, "u", null);
        first.classes[0].name = "changed";
        expect((await resolveSplitClasses(fakeDb({}).db, "u", null)).classes[0].name).toBe("Carátula del instrumento");
    });

    it("saves a list or null, and says whether the row existed", async () => {
        const user = fakeDb({ user_profiles: null });
        expect(await saveUserSplitClasses(user.db, "u", own)).toBe(true);
        expect(user.updates).toEqual([{ table: "user_profiles", patch: { split_classes: own } }]);
        const org = fakeDb({ organizations: null });
        expect(await saveOrgSplitClasses(org.db, "o", null)).toBe(true);
        expect(org.updates[0]).toMatchObject({ table: "organizations", patch: { split_classes: null } });
        expect(await saveOrgSplitClasses(fakeDb({}).db, "o", own)).toBe(false);
    });

    it("throws when the database fails", async () => {
        const failing = fakeDb({}, new Error("db down")).db;
        await expect(readUserSplitClasses(failing, "u")).rejects.toThrow("db down");
        await expect(readOrgSplitClasses(failing, "o")).rejects.toThrow("db down");
        await expect(saveUserSplitClasses(failing, "u", own)).rejects.toThrow("db down");
        await expect(saveOrgSplitClasses(failing, "o", own)).rejects.toThrow("db down");
        vi.restoreAllMocks();
    });
});
