import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isStructurallySame, parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import enUS from "../messages/en-US.json";
import esMX from "../messages/es-MX.json";
import { detailMismatches } from "../../../scripts/i18n/icu-compare.mjs";
import { PENDING_TRANSLATION } from "../../../scripts/i18n/literals.mjs";
import { LOCALES } from "./index";

type Tree = { [key: string]: string | Tree };

// "common.save" -> "Save", for every leaf of the nested catalog.
function flatten(tree: Tree, prefix = ""): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === "object") {
            for (const [k, v] of flatten(value, path)) out.set(k, v);
        } else {
            out.set(path, value);
        }
    }
    return out;
}

// Every nested object of the catalog, empty ones included: flatten() walks
// only to the leaves, so a namespace with no message yet (the
// training.criterion.* skeleton) is invisible to it and could be dropped or
// renamed in one catalog without a failing test.
function namespaces(tree: Tree, prefix = ""): string[] {
    return Object.entries(tree).flatMap(([key, value]) => {
        if (value === null || typeof value !== "object") return [];
        const path = prefix ? `${prefix}.${key}` : key;
        return [path, ...namespaces(value, path)];
    });
}

const source = flatten(enUS);
const target = flatten(esMX);

describe("@litt/i18n catalog", () => {
    it("has one catalog file per supported locale, and no others", () => {
        const dir = resolve(__dirname, "../messages");
        const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
        expect(files).toEqual(LOCALES.map((l) => `${l}.json`).sort());
    });

    it("es-MX has exactly the keys of en-US", () => {
        const missing = [...source.keys()].filter((k) => !target.has(k));
        const extra = [...target.keys()].filter((k) => !source.has(k));
        expect({ missing, extra }, "es-MX must match en-US key for key").toEqual({ missing: [], extra: [] });
    });

    it("es-MX has exactly the namespaces of en-US, empty ones included", () => {
        const en = new Set(namespaces(enUS));
        const es = new Set(namespaces(esMX));
        const missing = [...en].filter((k) => !es.has(k));
        const extra = [...es].filter((k) => !en.has(k));
        expect({ missing, extra }, "es-MX must match en-US namespace for namespace").toEqual({
            missing: [],
            extra: [],
        });
        // The skeleton the layer-3 cards fill in is there to be checked.
        expect(en.has("training.criterion.turn")).toBe(true);
    });

    it("the namespace check sees an empty namespace the key check cannot", () => {
        const withEmpty: Tree = { training: { criterion: { turn: {}, map: {} } } };
        const withoutEmpty: Tree = { training: { criterion: { turn: {} } } };
        expect([...flatten(withEmpty).keys()]).toEqual([...flatten(withoutEmpty).keys()]);
        expect(namespaces(withEmpty)).not.toEqual(namespaces(withoutEmpty));
    });

    it("no message is still waiting for its translation", () => {
        // scripts/i18n/extract.mjs writes the other catalog's copy of a new
        // key with this mark: es-MX normally, en-US for Spanish source text.
        const isPending = (v: unknown) => typeof v === "string" && v.startsWith(PENDING_TRANSLATION);
        expect(isPending(`${PENDING_TRANSLATION}Save`)).toBe(true);
        const pending = [
            ...[...source].filter(([, v]) => isPending(v)).map(([k]) => `en-US ${k}`),
            ...[...target].filter(([, v]) => isPending(v)).map(([k]) => `es-MX ${k}`),
        ];
        expect(pending, "Translate these messages (packages/i18n/GLOSSARY.md)").toEqual([]);
    });

    it("every message is a non-empty string", () => {
        const bad = [...source, ...target]
            .filter(([, v]) => typeof v !== "string" || v.trim() === "")
            .map(([k]) => k);
        expect(bad).toEqual([]);
    });

    it("every es-MX message takes the same ICU arguments as its en-US source", () => {
        const mismatched: string[] = [];
        for (const [key, en] of source) {
            const es = target.get(key);
            if (typeof en !== "string" || typeof es !== "string") continue;
            try {
                const result = isStructurallySame(parse(en), parse(es));
                if (!result.success) mismatched.push(`${key}: ${result.error?.message}`);
                for (const problem of detailMismatches(en, es, "es-MX")) mismatched.push(`${key}: ${problem}`);
            } catch (error) {
                mismatched.push(`${key}: ${(error as Error).message}`);
            }
        }
        expect(mismatched).toEqual([]);
    });

    it("the argument check rejects a renamed or dropped placeholder", () => {
        expect(isStructurallySame(parse("Hi, {name}"), parse("Hola, {nombre}")).success).toBe(false);
        expect(isStructurallySame(parse("{count, plural, other {#}}"), parse("{count}")).success).toBe(false);
        expect(isStructurallySame(parse("Hi, {name}"), parse("Hola, {name}")).success).toBe(true);
    });

    it("the detail check rejects what isStructurallySame lets through", () => {
        const fails = (en: string, es: string) => {
            // Each case passes the argument check; only the detail check sees it.
            expect(isStructurallySame(parse(en), parse(es)).success).toBe(true);
            expect(detailMismatches(en, es, "es-MX")).not.toEqual([]);
        };
        const plural = "{n, plural, one {# file} other {# files}}";
        fails(plural, "{n, plural, other {# archivos}}"); // dropped `one`
        fails(plural, "{n, plural, one {# archivo} two {# archivos} other {# archivos}}"); // not a Spanish category
        fails("{n, plural, =0 {none} other {#}}", "{n, plural, other {#}}"); // dropped =0
        fails("{n, plural, offset:1 other {#}}", "{n, plural, other {#}}"); // offset
        fails("{role, select, owner {Owner} other {Member}}", "{role, select, other {Miembro}}");
        fails("{total, number, ::currency/MXN}", "{total, number, ::currency/USD}");
        fails("{when, date, short}", "{when, date, long}");
        // A renamed rich-text tag is already an argument mismatch.
        expect(isStructurallySame(parse("Read <link>the terms</link>"), parse("Lee <a>los términos</a>")).success).toBe(false);
    });

    it("the detail check accepts a Spanish plural category the source lacks", () => {
        const en = "{n, plural, one {# file} other {# files}}";
        const es = "{n, plural, one {# archivo} many {# de archivos} other {# archivos}}";
        expect(detailMismatches(en, es, "es-MX")).toEqual([]);
        expect(detailMismatches(en, "{n, plural, one {# archivo} other {# archivos}}", "es-MX")).toEqual([]);
    });

    it("a counted noun in the training screens never follows a bare argument (it uses a plural)", () => {
        // «coincidió {n} de {m} veces» must be `{m, plural, one {# vez} other {# veces}}`.
        const bare = /\{\w+\}\s+(times?|veces|vez|marked turns?|turnos? marcados?)\b/i;
        const found: string[] = [];
        for (const [name, tree] of [["en-US", enUS], ["es-MX", esMX]] as const) {
            for (const [key, value] of flatten((tree as Tree).training as Tree, "training"))
                if (typeof value === "string" && bare.test(value)) found.push(`${name} ${key}: ${value}`);
        }
        expect(found).toEqual([]);
    });
});
