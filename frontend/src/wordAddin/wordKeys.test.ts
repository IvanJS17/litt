/**
 * The add-in's `useTranslations()` is not typed against the catalog (the
 * web app's is), so a mistyped `t("word.…")` would only show up as the key
 * on a screen. This reads every literal key the add-in's source asks for and
 * checks the source catalog has it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_MESSAGES } from "@litt/i18n";

const ADDIN_SRC = path.resolve(__dirname, "../../../word-addin/src");

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return sources(full);
        return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
    });
}

function has(messages: unknown, key: string): boolean {
    let at: unknown = messages;
    for (const part of key.split(".")) {
        if (typeof at !== "object" || at === null || !(part in at)) return false;
        at = (at as Record<string, unknown>)[part];
    }
    return typeof at === "string";
}

describe("the add-in's catalog keys", () => {
    it("all exist in the source catalog", () => {
        const missing: string[] = [];
        for (const file of sources(ADDIN_SRC)) {
            const text = readFileSync(file, "utf8");
            // A translator call whose first argument is a literal key.
            for (const match of text.matchAll(/\bt\(\s*["'`]((?:word|common|errors)\.[A-Za-z0-9_.]+)["'`]/g)) {
                if (!has(SOURCE_MESSAGES, match[1]!)) {
                    missing.push(`${path.relative(ADDIN_SRC, file)}: ${match[1]}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
