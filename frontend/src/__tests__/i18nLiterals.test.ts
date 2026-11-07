// No visible text outside the catalog, in the areas already moved to it.
//
// Each i18n card that moves an area to next-intl adds its paths to
// `migrated` in i18n-literal-baseline.json. In those paths, a user-visible
// string literal (JSX text, a visible attribute such as aria-label, a string
// inside a JSX expression, the text passed to a toast/notify-style call, or a
// visible-looking object key such as `label:`) must come from the catalog.
// A literal the card could not move yet is counted in `allowed`; the count
// may only go down (a lower count fails until the baseline is lowered too).
//
// Paths are relative to the repository root, so the same check covers the
// web app, the Word add-in and packages/ui. It is a test and not the ESLint
// rule react/jsx-no-literals because the add-in has no ESLint (plan i18n §6).
//
// The detection is the heuristic AST walk of the plan's inventory tool. It
// lives in scripts/i18n/literals.mjs, shared with the extraction codemod
// (scripts/i18n/extract.mjs), so the codemod moves exactly what this flags.

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles as sourcesAt, visibleLiterals } from "../../../scripts/i18n/literals.mjs";
import baseline from "./i18n-literal-baseline.json";

const REPO = resolve(__dirname, "../../..");
const sourceFiles = (path: string): string[] => sourcesAt(join(REPO, path));

const toRepo = (abs: string) => relative(REPO, abs).split(sep).join("/");
const allowed: Record<string, number> = baseline.allowed;

describe("i18n: no visible literals in migrated areas", () => {
    it("lists only paths that exist, and counts only files under them", () => {
        expect(baseline.migrated.filter((p) => !existsSync(join(REPO, p)))).toEqual([]);
        const outside = Object.keys(allowed).filter(
            (file) => !baseline.migrated.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`)),
        );
        expect(outside).toEqual([]);
    });

    it("migrated files show only catalog text, within the baseline", () => {
        const over: Record<string, string[]> = {};
        const stale: Record<string, string> = {};
        const files = new Set(baseline.migrated.flatMap(sourceFiles));
        for (const abs of files) {
            const file = toRepo(abs);
            const literals = visibleLiterals(abs, readFileSync(abs, "utf8"));
            const limit = allowed[file] ?? 0;
            if (literals.length > limit) over[file] = literals;
            else if (literals.length < limit) stale[file] = `baseline ${limit}, found ${literals.length}: lower it`;
        }
        for (const file of Object.keys(allowed))
            if (![...files].some((abs) => toRepo(abs) === file)) stale[file] = "no longer a migrated source file";
        expect(over, "Move these strings to packages/i18n/messages (both catalogs) and use t()").toEqual({});
        expect(stale, "The literal count went down: lower i18n-literal-baseline.json").toEqual({});
    });

    it("the scan finds each kind of visible literal, and skips catalog and technical text", () => {
        const source = `
            export function Demo({ ok }: { ok: boolean }) {
                const t = useTranslations("common");
                notify("Saved your changes");
                const item = { label: "Rename matter", id: "rename-matter", name: ok ? "Open" : "Closed" };
                return (
                    <div className="flex gap-2" aria-label="Matter actions">
                        Delete this matter
                        {ok ? "Ready to go" : t("save")}
                        <span title={t("cancel")} data-testid="x">LiTT</span>
                        <img alt="Firm logo" src="/logo.png" />
                    </div>
                );
            }`;
        expect(visibleLiterals("demo.tsx", source).sort()).toEqual(
            [
                "Closed",
                "Delete this matter",
                "Firm logo",
                "Matter actions",
                "Open",
                "Ready to go",
                "Rename matter",
                "Saved your changes",
            ].sort(),
        );
    });
});
