import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isStructurallySame, parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import enUS from "../messages/en-US.json";
import esMX from "../messages/es-MX.json";
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
            let result;
            try {
                result = isStructurallySame(parse(en), parse(es));
            } catch (error) {
                mismatched.push(`${key}: ${(error as Error).message}`);
                continue;
            }
            if (!result.success) mismatched.push(`${key}: ${result.error?.message}`);
        }
        expect(mismatched).toEqual([]);
    });

    it("the argument check rejects a renamed or dropped placeholder", () => {
        expect(isStructurallySame(parse("Hi, {name}"), parse("Hola, {nombre}")).success).toBe(false);
        expect(isStructurallySame(parse("{count, plural, other {#}}"), parse("{count}")).success).toBe(false);
        expect(isStructurallySame(parse("Hi, {name}"), parse("Hola, {name}")).success).toBe(true);
    });
});
