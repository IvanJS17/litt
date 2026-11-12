// What counts as user-visible text in a source file, shared by the literal
// guard (frontend/src/__tests__/i18nLiterals.test.ts) and the extraction
// codemod (scripts/i18n/extract.mjs), so the codemod moves exactly what the
// guard would flag and counts what is left the same way. See docs/i18n.md.
//
// TypeScript comes from frontend/node_modules: it is the version the guard
// and the web app's typecheck use (the root's devDependency is TypeScript 7,
// whose JavaScript API is not this one).

import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "../../frontend");
const NEEDS_TYPESCRIPT = "scripts/i18n needs TypeScript 5 from frontend/node_modules: run `npm ci --prefix frontend`";

/**
 * The TypeScript 5 compiler API resolved from a frontend directory (a path,
 * not a URL object: under jsdom the global URL is jsdom's). Throws an Error
 * saying what to run when it is missing or of another major version.
 */
export function loadTypeScript(frontendDir = FRONTEND) {
    const req = createRequire(join(frontendDir, "package.json"));
    let version;
    try {
        ({ version } = req("typescript/package.json"));
    } catch {
        throw new Error(`TypeScript not found: ${NEEDS_TYPESCRIPT}`);
    }
    if (String(version).split(".")[0] !== "5")
        throw new Error(`found TypeScript ${version} from ${frontendDir}: ${NEEDS_TYPESCRIPT}`);
    return req("typescript");
}

/** @type {typeof import("typescript")} */
export let ts;
try {
    ts = loadTypeScript();
} catch (error) {
    // Imported by a CLI: a clear line, not a stack trace.
    process.stderr.write(`extract: ${error.message}\n`);
    process.exit(1);
}

/**
 * Prefix of a message the codemod copied from the other catalog and nobody
 * has translated yet (normally in es-MX). packages/i18n/src/catalog.test.ts
 * fails while any message in either catalog has it.
 */
export const PENDING_TRANSLATION = "⟦por traducir⟧ ";

// Text that is the same in every language and stays a literal.
export const EXCEPTIONS = new Set([
    "LiTT", // the product name
    "MikeOSS", // the upstream project, credited by name
    "Microsoft Word",
    "Google Drive",
    "BYOK",
    // Model and search providers are named the same in every language.
    "Anthropic (Claude)",
    "Google (Gemini)",
    "OpenAI",
    "Mistral AI",
    "xAI",
    "Amazon Bedrock",
    "Azure OpenAI",
    "Azure AI Foundry",
    "Google Vertex AI",
    "OpenRouter",
    "Vercel AI Gateway",
    "OpenCode Go",
    "OpenAI-compatible endpoint",
    "Brave Search",
    "Tavily",
    "DeepSeek",
    "Claude",
    "DeepSeek Search",
    "Anthropic Search",
    "OpenAI Search",
]);

export const VISIBLE_ATTRS = new Set([
    "placeholder", "title", "aria-label", "alt", "label", "aria-description",
    "description", "subtitle", "heading", "emptyMessage", "emptyTitle",
    "emptyDescription", "confirmLabel", "cancelLabel", "tooltip", "helperText",
    "message", "text", "buttonLabel", "submitLabel", "ariaLabel", "searchPlaceholder",
    "loadingLabel", "actionLabel", "primaryLabel", "secondaryLabel", "hint", "caption",
]);
export const VISIBLE_KEYS = new Set([
    "title", "label", "description", "message", "placeholder", "subtitle", "heading",
    "body", "detail", "hint", "tooltip", "ariaLabel", "emptyMessage", "confirmLabel",
    "cancelLabel", "actionLabel", "headline", "summary", "text", "helperText", "caption",
    "retryLabel", "name", "error",
]);
const CALLS =
    /^(toast(\.\w+)?|notify\w*|alert|confirm|setError|setMessage|setStatus|setNotice|showToast|describeError|userError|showError|throwUserError)$/;

const hasWords = (s) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(s);
const looksTechnical = (s) =>
    /^[a-z0-9_.\-/:#@?=&%]+$/.test(s) || // ids, classes, paths, keys
    /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+){2,}$/.test(s) || // catalog keys: settings.layout.tab.account
    /^(https?:|\/|#|\.|@)/.test(s) ||
    /^[A-Z0-9_]+$/.test(s) || // CONSTANTS and codes
    /\b(flex|grid|px-|py-|text-|bg-|rounded|border|w-|h-|gap-|items-|justify-)/.test(s);

/** The text of a string or template literal (`${x}` read as `{}`), else null. */
export const literalText = (n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
        ? n.text
        : ts.isTemplateExpression(n)
          ? [n.head.text, ...n.templateSpans.map((span) => span.literal.text)].join("{}")
          : null;

export function parseSource(fileName, source) {
    return ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

/**
 * The user-visible literals of a parsed file, in order of appearance: each
 * with its node (a JsxText, or a string/template literal) and its kind:
 * "jsxText", "attr" (a visible JSX attribute), "jsxExpr" (a string inside a
 * visible JSX expression), "call" (the text given to toast/notify-style
 * calls) or "key" (the value of a visible-looking object key).
 */
export function findVisibleLiterals(sf) {
    const found = [];
    const add = (node, kind, raw) => {
        const text = raw.replace(/\s+/g, " ").trim();
        if (!text || !hasWords(text) || EXCEPTIONS.has(text)) return;
        if (kind !== "jsxText" && looksTechnical(text)) return;
        found.push({ node, kind, text });
    };
    const inVisibleJsxExpression = (n) => {
        for (let p = n.parent; p; p = p.parent) {
            if (ts.isJsxExpression(p))
                return !ts.isJsxAttribute(p.parent) || VISIBLE_ATTRS.has(p.parent.name.getText(sf));
            if (ts.isCallExpression(p) || ts.isFunctionLike(p) || ts.isBlock(p)) return false;
        }
        return false;
    };
    const visit = (n) => {
        if (ts.isJsxText(n)) add(n, "jsxText", n.text);
        else if (
            ts.isJsxAttribute(n) &&
            n.initializer &&
            ts.isStringLiteral(n.initializer) &&
            VISIBLE_ATTRS.has(n.name.getText(sf))
        )
            add(n.initializer, "attr", n.initializer.text);
        else if (ts.isCallExpression(n)) {
            const first = n.arguments[0];
            const value = first && CALLS.test(n.expression.getText(sf)) ? literalText(first) : null;
            if (value != null) add(first, "call", value);
        } else if (ts.isPropertyAssignment(n) && VISIBLE_KEYS.has(n.name.getText(sf).replace(/["']/g, ""))) {
            const value = literalText(n.initializer);
            if (value != null) add(n.initializer, "key", value);
            if (ts.isConditionalExpression(n.initializer))
                for (const branch of [n.initializer.whenTrue, n.initializer.whenFalse]) {
                    const v = literalText(branch);
                    if (v != null) add(branch, "key", v);
                }
        } else if (
            (ts.isStringLiteral(n) || ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
            !ts.isJsxAttribute(n.parent) &&
            inVisibleJsxExpression(n)
        ) {
            const value = literalText(n);
            // "Saving..." and "Saving…" are one word of text: test them without the trailing ellipsis.
            const word = value?.trim().replace(/(\.{3}|…)$/, "");
            if (value != null && (/\s/.test(word) || /^[A-Z][a-z]+$/.test(word))) add(n, "jsxExpr", value);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

/** The user-visible literals of one source file, as the guard counts them. */
export function visibleLiterals(fileName, source) {
    return findVisibleLiterals(parseSource(fileName, source)).map((l) => l.text);
}

export const isSource = (file) =>
    /\.(ts|tsx)$/.test(file) && !/\.(test|spec|stories)\.tsx?$/.test(file) && !file.endsWith(".d.ts");

/** The source files at an absolute path: the file itself, or those under it. */
export function sourceFiles(abs) {
    if (statSync(abs).isFile()) return isSource(abs) ? [abs] : [];
    return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
        if (["node_modules", "__tests__", "__mocks__"].includes(entry.name)) return [];
        const child = join(abs, entry.name);
        return entry.isDirectory() ? sourceFiles(child) : isSource(child) ? [child] : [];
    });
}
