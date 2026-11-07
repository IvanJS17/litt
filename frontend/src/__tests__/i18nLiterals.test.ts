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
// The detection is the heuristic AST walk of the plan's inventory tool.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import baseline from "./i18n-literal-baseline.json";

const REPO = resolve(__dirname, "../../..");

// Text that is the same in every language and stays a literal.
const EXCEPTIONS = new Set([
    "LiTT", // the product name
    "MikeOSS", // the upstream project, credited by name
    "Microsoft Word",
    "Google Drive",
    "BYOK",
]);

const VISIBLE_ATTRS = new Set([
    "placeholder", "title", "aria-label", "alt", "label", "aria-description",
    "description", "subtitle", "heading", "emptyMessage", "emptyTitle",
    "emptyDescription", "confirmLabel", "cancelLabel", "tooltip", "helperText",
    "message", "text", "buttonLabel", "submitLabel", "ariaLabel", "searchPlaceholder",
    "loadingLabel", "actionLabel", "primaryLabel", "secondaryLabel", "hint", "caption",
]);
const VISIBLE_KEYS = new Set([
    "title", "label", "description", "message", "placeholder", "subtitle", "heading",
    "body", "detail", "hint", "tooltip", "ariaLabel", "emptyMessage", "confirmLabel",
    "cancelLabel", "actionLabel", "headline", "summary", "text", "helperText", "caption",
    "retryLabel", "name", "error",
]);
const CALLS =
    /^(toast(\.\w+)?|notify\w*|alert|confirm|setError|setMessage|setStatus|setNotice|showToast|describeError|userError|showError|throwUserError)$/;

const hasWords = (s: string) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(s);
const looksTechnical = (s: string) =>
    /^[a-z0-9_.\-/:#@?=&%]+$/.test(s) || // ids, classes, paths, keys
    /^(https?:|\/|#|\.|@)/.test(s) ||
    /^[A-Z0-9_]+$/.test(s) || // CONSTANTS and codes
    /\b(flex|grid|px-|py-|text-|bg-|rounded|border|w-|h-|gap-|items-|justify-)/.test(s);

/** The user-visible literals of one source file, in order of appearance. */
function visibleLiterals(fileName: string, source: string): string[] {
    const sf = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const found: string[] = [];
    const add = (raw: string, jsxText = false) => {
        const s = raw.replace(/\s+/g, " ").trim();
        if (!s || !hasWords(s) || EXCEPTIONS.has(s)) return;
        if (!jsxText && looksTechnical(s)) return;
        found.push(s);
    };
    const text = (n: ts.Node): string | null =>
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
            ? n.text
            : ts.isTemplateExpression(n)
              ? [n.head.text, ...n.templateSpans.map((span) => span.literal.text)].join("{}")
              : null;
    const inVisibleJsxExpression = (n: ts.Node) => {
        for (let p = n.parent; p; p = p.parent) {
            if (ts.isJsxExpression(p))
                return !ts.isJsxAttribute(p.parent) || VISIBLE_ATTRS.has(p.parent.name.getText(sf));
            if (ts.isCallExpression(p) || ts.isFunctionLike(p) || ts.isBlock(p)) return false;
        }
        return false;
    };
    const visit = (n: ts.Node) => {
        if (ts.isJsxText(n)) add(n.text, true);
        else if (
            ts.isJsxAttribute(n) &&
            n.initializer &&
            ts.isStringLiteral(n.initializer) &&
            VISIBLE_ATTRS.has(n.name.getText(sf))
        )
            add(n.initializer.text);
        else if (ts.isCallExpression(n)) {
            const first = n.arguments[0];
            const value = first && CALLS.test(n.expression.getText(sf)) ? text(first) : null;
            if (value != null) add(value);
        } else if (ts.isPropertyAssignment(n) && VISIBLE_KEYS.has(n.name.getText(sf).replace(/["']/g, ""))) {
            const value = text(n.initializer);
            if (value != null) add(value);
            if (ts.isConditionalExpression(n.initializer))
                for (const branch of [n.initializer.whenTrue, n.initializer.whenFalse]) {
                    const v = text(branch);
                    if (v != null) add(v);
                }
        } else if (
            (ts.isStringLiteral(n) || ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
            !ts.isJsxAttribute(n.parent) &&
            inVisibleJsxExpression(n)
        ) {
            const value = text(n);
            if (value != null && (/\s/.test(value.trim()) || /^[A-Z][a-z]+$/.test(value))) add(value);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

const isSource = (file: string) =>
    /\.(ts|tsx)$/.test(file) && !/\.(test|spec|stories)\.tsx?$/.test(file) && !file.endsWith(".d.ts");

function sourceFiles(path: string): string[] {
    const abs = join(REPO, path);
    if (statSync(abs).isFile()) return isSource(abs) ? [abs] : [];
    return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
        if (["node_modules", "__tests__", "__mocks__"].includes(entry.name)) return [];
        const child = join(path, entry.name);
        return entry.isDirectory() ? sourceFiles(child) : isSource(child) ? [join(REPO, child)] : [];
    });
}

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
