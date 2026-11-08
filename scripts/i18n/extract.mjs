#!/usr/bin/env node
// Moves the visible text of a file or folder to the catalog: each literal
// the guard flags (scripts/i18n/literals.mjs) becomes t("<namespace>.<key>"),
// the key goes to packages/i18n/messages/en-US.json with the English text
// exactly as written, and es-MX.json gets the same key marked as pending
// (PENDING_TRANSLATION), which packages/i18n/src/catalog.test.ts rejects
// until someone translates it. A LiTT file written in Spanish goes the other
// way with --from es-MX: the text lands in es-MX and en-US is marked. It edits only the literal's own range, the
// `t` declaration and the import: the rest of the file keeps its formatting.
//
// Idempotent: a second run finds nothing to move and changes nothing. What
// it cannot move (text outside a component or hook, an expression it cannot
// name, a `t` that means something else) stays a literal, is listed, and is
// counted in frontend/src/__tests__/i18n-literal-baseline.json.
//
//   node scripts/i18n/extract.mjs --ns <namespace> <path>...        # dry run: prints the diff
//   node scripts/i18n/extract.mjs --ns <namespace> --write <path>...
//   node scripts/i18n/extract.mjs --ns <namespace> --from es-MX --write <path>...  # Spanish source text
//   node scripts/i18n/extract.mjs --ns <namespace> --prune [--write]  # drops unused keys of <namespace>
//   ... --prune --allow-dynamic   # when t(`ns.${x}`)-style calls exist: keeps the keys they may reach
//
// Paths are relative to the repository root. See docs/i18n.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    PENDING_TRANSLATION,
    findVisibleLiterals,
    parseSource,
    sourceFiles,
    ts,
    visibleLiterals,
} from "./literals.mjs";

const DEFAULT_REPO = resolve(fileURLToPath(import.meta.url), "../../..");
export const CATALOGS = { en: "packages/i18n/messages/en-US.json", es: "packages/i18n/messages/es-MX.json" };
export const BASELINE = "frontend/src/__tests__/i18n-literal-baseline.json";
// Where catalog keys are looked up by --prune.
const KEY_USERS = ["frontend/src", "word-addin/src", "packages", "backend/src"];

class Skip extends Error {}

// ---------------------------------------------------------------- catalog

const isTree = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The object at a dotted namespace, created when `create` is set. */
function subtree(tree, namespace, create) {
    let node = tree;
    for (const part of namespace.split(".")) {
        if (!(part in node)) {
            if (!create) return null;
            node[part] = {};
        }
        if (!isTree(node[part])) throw new Error(`catalog: "${namespace}" crosses the message "${part}"`);
        node = node[part];
    }
    return node;
}

function slug(text) {
    const words = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/['’]/g, "") // "Don't" -> dont
        .match(/[A-Za-z0-9]+/g);
    if (!words) return "text";
    const name = words
        .slice(0, 6)
        .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
        .join("");
    return /^\d/.test(name) ? `n${name}` : name;
}

/**
 * The key for a message under the namespace: an existing key with the same
 * source text, or a new one named after the text, added to both catalogs
 * (the other locale marked as pending).
 */
function keyFor(catalog, namespace, message, slugSource, from) {
    const en = subtree(catalog.en, namespace, true);
    const es = subtree(catalog.es, namespace, true);
    const [source, other] = from === "es-MX" ? [es, en] : [en, es];
    let name = Object.keys(source).find((k) => source[k] === message);
    const isNew = !name;
    if (!name) {
        const base = slug(slugSource);
        name = base;
        for (let i = 2; name in en || name in es; i++) name = `${base}${i}`;
        source[name] = message;
    }
    if (!(name in other)) other[name] = PENDING_TRANSLATION + message;
    return { key: `${namespace}.${name}`, isNew };
}

function sortTree(tree) {
    return Object.fromEntries(
        Object.keys(tree)
            .sort()
            .map((k) => [k, isTree(tree[k]) ? sortTree(tree[k]) : tree[k]]),
    );
}
export const serializeCatalog = (tree) => `${JSON.stringify(sortTree(tree), null, 2)}\n`;

function leaves(tree, prefix = "") {
    return Object.entries(tree).flatMap(([k, v]) =>
        isTree(v) ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
}

function removeKey(tree, key) {
    const parts = key.split(".");
    const last = parts.pop();
    const parent = parts.length ? subtree(tree, parts.join("."), false) : tree;
    if (parent) delete parent[last];
}

// ---------------------------------------------------------------- messages

// The named character references upstream's JSX uses; anything else is skipped.
const ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", hellip: "…", mdash: "—", ndash: "–", middot: "·", copy: "©", times: "×",
};
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref) => {
        if (ref[0] === "#")
            return String.fromCodePoint(ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
        if (ref in ENTITIES) return ENTITIES[ref];
        throw new Skip(`unknown HTML entity ${match}`);
    });
}

// JSX text as React renders it (Babel's cleanJSXElementLiteralChild): lines
// trimmed where they meet a line break, blank lines dropped, joined by a space.
function cleanJsxText(raw) {
    const lines = raw.split(/\r\n|\n|\r/);
    let lastNonEmpty = 0;
    lines.forEach((line, i) => {
        if (/[^ \t]/.test(line)) lastNonEmpty = i;
    });
    let out = "";
    lines.forEach((line, i) => {
        let trimmed = line.replace(/\t/g, " ");
        if (i !== 0) trimmed = trimmed.replace(/^[ ]+/, "");
        if (i !== lines.length - 1) trimmed = trimmed.replace(/[ ]+$/, "");
        if (trimmed) out += i === lastNonEmpty ? trimmed : `${trimmed} `;
    });
    return decodeEntities(out);
}

const isNameable = (e) =>
    ts.isIdentifier(e) ||
    (ts.isPropertyAccessExpression(e) && (isNameable(e.expression) || e.expression.kind === ts.SyntaxKind.ThisKeyword));
const argName = (e) => (ts.isIdentifier(e) ? e.text : e.name.text);
// Values that are usually elements, which t() cannot take.
const LOOKS_LIKE_NODE = /(icon|node|element|children|content|slot|badge|avatar)$/i;
const isStringLiteral = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e);

/** `n === 1 ? "file" : "files"` (or `!==`), as a plural on n. */
function pluralOf(e) {
    if (!ts.isConditionalExpression(e) || !ts.isBinaryExpression(e.condition)) return null;
    const { left, right, operatorToken } = e.condition;
    const op = operatorToken.kind;
    const K = ts.SyntaxKind;
    if (![K.EqualsEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.ExclamationEqualsToken].includes(op))
        return null;
    const isOne = (n) => ts.isNumericLiteral(n) && n.text === "1";
    const subject = isOne(right) ? left : isOne(left) ? right : null;
    if (!subject || !isNameable(subject) || !isStringLiteral(e.whenTrue) || !isStringLiteral(e.whenFalse)) return null;
    const equal = op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken;
    const [one, other] = equal ? [e.whenTrue.text, e.whenFalse.text] : [e.whenFalse.text, e.whenTrue.text];
    return { type: "plural", expr: subject, one, other };
}

/** A part of a message from an expression inside `${}` or `{}`. */
function partOf(e) {
    if (isStringLiteral(e)) return { type: "text", value: e.text };
    const plural = pluralOf(e);
    if (plural) return plural;
    if (isNameable(e)) return { type: "arg", expr: e };
    return null;
}

/**
 * The ICU message, its arguments and the text its key is named after.
 * Parts: { type: "text", value } | { type: "arg", expr } | { type: "plural", expr, one, other }.
 */
function buildMessage(parts, sf) {
    const args = [];
    const nameOf = (expr) => {
        const text = expr.getText(sf);
        let arg = args.find((a) => a.text === text);
        if (!arg) {
            const base = argName(expr);
            let name = base;
            for (let i = 2; args.some((a) => a.name === name); i++) name = `${base}${i}`;
            arg = { name, text };
            args.push(arg);
        }
        return arg.name;
    };
    const plurals = new Set(parts.filter((p) => p.type === "plural").map((p) => nameOf(p.expr)));
    if (plurals.size > 1) throw new Skip("more than one plural in one message");
    const [plural] = plurals;
    const escape = (s) => {
        if (/[{}<]/.test(s)) throw new Skip("text with {, } or <");
        if (plural && s.includes("#")) throw new Skip("plural text with #");
        return s;
    };
    const body = (variant, forSlug) =>
        parts
            .map((p) => {
                if (p.type === "text") return forSlug ? p.value : escape(p.value);
                const name = nameOf(p.expr);
                if (p.type === "plural") return forSlug ? p.other : escape(variant === "one" ? p.one : p.other);
                return name === plural && !forSlug ? "#" : forSlug ? name : `{${name}}`;
            })
            .join("");
    const message = plural
        ? `{${plural}, plural, one {${body("one")}} other {${body("other")}}}`
        : body("other");
    return { message, args, slugSource: body("other", true) };
}

function call(key, args) {
    if (!args.length) return `t(${JSON.stringify(key)})`;
    const values = args.map((a) => (a.name === a.text ? a.name : `${a.name}: ${a.text}`)).join(", ");
    return `t(${JSON.stringify(key)}, { ${values} })`;
}

// ---------------------------------------------------------------- dynamic uses

/**
 * The one place that says what counts as a translator call. Add a new
 * factory or hook here (and to docs/i18n.md) and --prune sees its calls.
 */
export const TRANSLATORS = {
    /** Bare names of a translator function. */
    names: ["t"],
    /** `t.<member>(...)` variants. */
    members: ["rich", "markup"],
    /** Hooks / getters taking a namespace and returning a translator: `useTranslations(ns)`. */
    hooks: ["useTranslations", "getTranslations"],
    /** Factories whose call returns a translator: `clientTranslator()(key)`. */
    factories: ["clientTranslator", "createTranslator"],
    /** Any other callee named like this is a factory too (fail-safe: `getFooTranslator()(key)`). */
    factoryPattern: /Translator$/,
};
const NAMESPACE_TAKERS = [...TRANSLATORS.hooks, "createTranslator"];
const TRANSLATE_HINT = new RegExp(
    `\\b(${[...TRANSLATORS.names, ...TRANSLATORS.hooks, ...TRANSLATORS.factories].join("|")})\\b|Translator\\b`,
);

const unwrap = (e) => {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
    return e;
};

/** Local names bound to a known hook or factory by an import (`import { useTranslations as ut }`) or an alias. */
function translatorBindings(sf) {
    const hooks = new Set(TRANSLATORS.hooks);
    const factories = new Set(TRANSLATORS.factories);
    const translators = new Set(TRANSLATORS.names);
    const isFactoryName = (n) => factories.has(n) || TRANSLATORS.factoryPattern.test(n);
    const nameOf = (e) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "");
    const imports = [];
    const decls = [];
    const collect = (n) => {
        if (ts.isImportSpecifier(n) && n.propertyName) imports.push([n.name.text, n.propertyName.text]);
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.push(n);
        ts.forEachChild(n, collect);
    };
    collect(sf);
    for (const [local, original] of imports) {
        if (hooks.has(original)) hooks.add(local);
        if (factories.has(original)) factories.add(local);
        if (translators.has(original)) translators.add(local);
    }
    // const tr = useTranslations("ns"); const tr = await getTranslations(); const tr = clientTranslator();
    // Repeated until stable so that an alias of an alias is found.
    for (let grew = true; grew; ) {
        grew = false;
        for (const d of decls) {
            const init = unwrap(d.initializer);
            let kind = null;
            if (ts.isCallExpression(init)) {
                const name = nameOf(unwrap(init.expression));
                if (hooks.has(name) || isFactoryName(name)) kind = translators;
            } else if (ts.isIdentifier(init)) {
                if (translators.has(init.text)) kind = translators;
                else if (hooks.has(init.text)) kind = hooks;
                else if (factories.has(init.text)) kind = factories;
            }
            if (kind && !kind.has(d.name.text)) {
                kind.add(d.name.text);
                grew = true;
            }
        }
    }
    return { hooks, factories, translators, nameOf, isFactoryName };
}

/**
 * Calls to a translator (t, t.rich, t.markup, an alias of useTranslations()
 * or clientTranslator(), `clientTranslator()(...)`, `createTranslator(...)(...)`)
 * whose first argument is not a string literal, and to a hook
 * (useTranslations, getTranslations, createTranslator) whose namespace
 * (first argument, or the `namespace` option) is not a string literal: the
 * key cannot be read from the source, so --prune cannot see it. Each one has
 * its line and the literal `prefix` the key is known to start with (""
 * when nothing is known: a variable, an imported constant, a call).
 * A callee that looks like a translator but cannot be resolved counts as
 * dynamic: failing towards keeping keys.
 */
export function dynamicUses(sf) {
    const b = translatorBindings(sf);
    const found = [];
    const isTranslatorCallee = (raw) => {
        const callee = unwrap(raw);
        if (ts.isIdentifier(callee)) return b.translators.has(callee.text);
        if (ts.isPropertyAccessExpression(callee)) {
            const base = unwrap(callee.expression);
            return TRANSLATORS.members.includes(callee.name.text) && isTranslatorCallee(base);
        }
        if (ts.isCallExpression(callee)) {
            const name = b.nameOf(unwrap(callee.expression));
            return b.factories.has(name) || b.isFactoryName(name);
        }
        return false;
    };
    const hookName = (raw) => {
        const callee = unwrap(raw);
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        return b.hooks.has(name) || b.factories.has(name) ? name : "";
    };
    const prefixOf = (arg) =>
        ts.isTemplateExpression(arg)
            ? arg.head.text
            : ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken && isStringLiteral(arg.left)
              ? arg.left.text
              : "";
    const add = (n, callee, arg) =>
        found.push({
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            callee,
            arg: arg.getText(sf).replace(/\s+/g, " "),
            prefix: prefixOf(arg),
        });
    const visit = (n) => {
        if (ts.isCallExpression(n) && n.arguments.length) {
            const arg = n.arguments[0];
            const hook = hookName(n.expression);
            if (hook) {
                if (ts.isObjectLiteralExpression(arg)) {
                    // Options form, getTranslations({ locale, namespace }): only the namespace matters.
                    if (b.hooks.has(hook) || NAMESPACE_TAKERS.includes(hook)) {
                        for (const prop of arg.properties) {
                            if (ts.isSpreadAssignment(prop)) add(n, n.expression.getText(sf), prop);
                            else if (prop.name && prop.name.getText(sf).replace(/["'`]/g, "") === "namespace") {
                                const value = ts.isShorthandPropertyAssignment(prop) ? prop.name : ts.isPropertyAssignment(prop) ? prop.initializer : prop;
                                if (!isStringLiteral(value)) add(n, n.expression.getText(sf), value);
                            }
                        }
                    }
                } else if (b.hooks.has(hook) && !isStringLiteral(arg)) add(n, n.expression.getText(sf), arg);
            } else if (isTranslatorCallee(n.expression) && !isStringLiteral(arg)) add(n, n.expression.getText(sf), arg);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

const dynamicWarning = (file, use) =>
    `warning: ${file}:${use.line} ${use.callee}(${use.arg}) is not a literal: --prune cannot see which keys it uses\n`;

/** Whether a dynamic use may reach a key, as a full key or under a namespaced translator. */
function mayReach(use, key) {
    const parts = key.split(".");
    return parts.some((_, i) => parts.slice(i).join(".").startsWith(use.prefix));
}

// ---------------------------------------------------------------- scopes

const componentName = (fn) => {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    let p = fn.parent;
    if (p && ts.isCallExpression(p)) p = p.parent; // memo(...), forwardRef(...)
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isFunctionDeclaration(fn) && fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
        return "Default";
    return "";
};
const isComponentOrHook = (fn) => /^([A-Z]|use[A-Z])/.test(componentName(fn));
const isFunction = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
const isAsync = (fn) => fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

/** The outermost component or hook around a node, where `t` is declared. */
function scopeOf(node) {
    let scope = null;
    for (let p = node.parent; p; p = p.parent) if (isFunction(p) && isComponentOrHook(p)) scope = p;
    return scope;
}

// The names a parameter or declaration binds, through destructuring.
const boundNames = (name) =>
    ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));
const bindsT = (fn) => fn.parameters.some((param) => boundNames(param.name).includes("t"));

/** How the scope already has `t`: "ours" (a bare translator), "other", or null. */
function existingT(fn) {
    if (bindsT(fn)) return "other";
    let found = null;
    const visit = (n) => {
        if (found) return;
        if (ts.isVariableDeclaration(n) && !ts.isIdentifier(n.name) && boundNames(n.name).includes("t")) found = "other";
        else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "t") {
            let init = n.initializer;
            if (init && ts.isAwaitExpression(init)) init = init.expression;
            const bare =
                init &&
                ts.isCallExpression(init) &&
                ts.isIdentifier(init.expression) &&
                ["useTranslations", "getTranslations"].includes(init.expression.text) &&
                init.arguments.length === 0;
            found = bare ? "ours" : "other";
        } else ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn.body, visit);
    return found;
}

/** A function between the node and its scope that rebinds `t` hides ours. */
function shadowed(node, scope) {
    for (let p = node.parent; p && p !== scope; p = p.parent) if (isFunction(p) && bindsT(p)) return true;
    return false;
}

// ---------------------------------------------------------------- JSX runs

/**
 * Each run of JSX children made only of text, string literals, nameable
 * values and plurals becomes one message, so "Hello {name}" is one key.
 */
function jsxRuns(sf, flagged) {
    const runs = [];
    const member = (child) => {
        if (ts.isJsxText(child)) return { child, part: null };
        if (ts.isJsxExpression(child) && child.expression) {
            const part = partOf(child.expression);
            if (part && !(part.type === "arg" && LOOKS_LIKE_NODE.test(argName(part.expr)))) return { child, part };
        }
        return null;
    };
    const blank = (m) =>
        ts.isJsxText(m.child) ? !m.child.text.trim() : m.part.type === "text" && !m.part.value.trim();
    const flush = (run) => {
        while (run.length && blank(run[0])) run.shift();
        while (run.length && blank(run[run.length - 1])) run.pop();
        const literalNodes = (m) => {
            const nodes = [];
            const visit = (n) => {
                if (flagged.has(n)) nodes.push(n);
                ts.forEachChild(n, visit);
            };
            if (ts.isJsxText(m.child)) nodes.push(m.child);
            else visit(m.child);
            return nodes;
        };
        const nodes = run.flatMap(literalNodes);
        if (nodes.some((n) => flagged.has(n))) runs.push({ members: run.slice(), nodes });
    };
    const visit = (n) => {
        if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
            let run = [];
            for (const child of n.children) {
                const m = member(child);
                if (m) run.push(m);
                else {
                    flush(run);
                    run = [];
                }
            }
            flush(run);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return runs;
}

function runUnit(run, sf) {
    const text = sf.text;
    const { members } = run;
    const first = members[0].child;
    const last = members[members.length - 1].child;
    let start = first.getStart(sf);
    let end = last.end;
    if (ts.isJsxText(first)) start = first.pos + (first.text.length - first.text.trimStart().length);
    if (ts.isJsxText(last)) end = last.end - (last.text.length - last.text.trimEnd().length);
    const parts = members.map(({ child, part }) => {
        if (!ts.isJsxText(child)) return part;
        const from = Math.max(child.pos, start);
        const to = Math.min(child.end, end);
        return { type: "text", value: cleanJsxText(text.slice(from, to)) };
    });
    return { start, end, parts, node: first, wrap: (c) => `{${c}}` };
}

function literalUnit({ node, kind }, sf) {
    const parts = ts.isTemplateExpression(node)
        ? [
              { type: "text", value: node.head.text },
              ...node.templateSpans.flatMap((span) => {
                  const part = partOf(span.expression);
                  if (!part) throw new Skip(`cannot name \${${span.expression.getText(sf)}}`);
                  return [part, { type: "text", value: span.literal.text }];
              }),
          ]
        : [{ type: "text", value: kind === "attr" ? decodeEntities(node.text) : node.text }];
    return {
        start: node.getStart(sf),
        end: node.end,
        parts: parts.filter((p) => p.type !== "text" || p.value),
        node,
        wrap: kind === "attr" ? (c) => `{${c}}` : (c) => c,
    };
}

// ---------------------------------------------------------------- edits

const lineStartOf = (text, pos) => text.lastIndexOf("\n", pos - 1) + 1;
const indentAt = (text, pos) => /^[ \t]*/.exec(text.slice(lineStartOf(text, pos)))[0];

function declareT(fn, sf, async, edits) {
    const text = sf.text;
    const decl = async ? "const t = await getTranslations();" : "const t = useTranslations();";
    const body = fn.body;
    if (ts.isBlock(body)) {
        const firstStatement = body.statements[0];
        const indent = firstStatement
            ? indentAt(text, firstStatement.getStart(sf))
            : `${indentAt(text, body.getStart(sf))}    `;
        edits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: `\n${indent}${decl}` });
    } else {
        const indent = indentAt(text, fn.getStart(sf));
        edits.push({ start: body.getStart(sf), end: body.getStart(sf), text: `{\n${indent}    ${decl}\n${indent}    return ` });
        edits.push({ start: body.end, end: body.end, text: `;\n${indent}}` });
    }
}

function importName(sf, name, module, edits) {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    for (const decl of imports) {
        if (decl.moduleSpecifier.text !== module || decl.importClause?.isTypeOnly) continue;
        const named = decl.importClause?.namedBindings;
        if (!named || !ts.isNamedImports(named)) continue;
        if (named.elements.some((el) => el.name.text === name && !el.isTypeOnly)) return;
        const lastElement = named.elements[named.elements.length - 1];
        const at = lastElement ? lastElement.end : named.getStart(sf) + 1;
        edits.push({ start: at, end: at, text: lastElement ? `, ${name}` : ` ${name} ` });
        return;
    }
    const line = `import { ${name} } from ${JSON.stringify(module)};`;
    const directives = sf.statements.filter(
        (s, i) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && sf.statements.slice(0, i).every((x) => ts.isExpressionStatement(x)),
    );
    const after = imports[imports.length - 1] ?? directives[directives.length - 1];
    if (after) edits.push({ start: after.end, end: after.end, text: `\n${line}` });
    else edits.push({ start: 0, end: 0, text: `${line}\n` });
}

/** The module that provides useTranslations for a repository path. */
export const translatorModule = (file) =>
    file.startsWith("word-addin/") || file.startsWith("packages/") ? "use-intl" : "next-intl";

/**
 * Moves one file's visible literals to the catalog (mutated in place).
 * Returns the new source, the keys it added and the literals it left.
 */
export function extractSource({ fileName, source, namespace, catalog, from = "en-US", module = translatorModule(fileName) }) {
    const sf = parseSource(fileName, source);
    const literals = findVisibleLiterals(sf);
    const flagged = new Set(literals.map((l) => l.node));
    const consumed = new Set();
    const units = [];
    const skipped = [];
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const skip = (node, text, reason) => skipped.push({ line: lineOf(node), text, reason });

    for (const run of jsxRuns(sf, flagged)) {
        run.nodes.forEach((n) => consumed.add(n));
        const label = run.members.map((m) => m.child.getText(sf)).join("").replace(/\s+/g, " ").trim();
        try {
            units.push({ ...runUnit(run, sf), label });
        } catch (error) {
            if (!(error instanceof Skip)) throw error;
            skip(run.members[0].child, label, error.message);
        }
    }
    for (const literal of literals) {
        if (consumed.has(literal.node)) continue;
        try {
            units.push({ ...literalUnit(literal, sf), label: literal.text });
        } catch (error) {
            if (!(error instanceof Skip)) throw error;
            skip(literal.node, literal.text, error.message);
        }
    }

    const edits = [];
    const added = [];
    const scopes = new Map();
    for (const unit of units.sort((a, b) => a.start - b.start)) {
        const scope = scopeOf(unit.node);
        const bodyStart = scope?.body.getStart(sf);
        if (!scope || unit.start < bodyStart) {
            skip(unit.node, unit.label, "outside a component or hook");
            continue;
        }
        if (!scopes.has(scope)) scopes.set(scope, existingT(scope));
        if (scopes.get(scope) === "other") {
            skip(unit.node, unit.label, "`t` already means something else here");
            continue;
        }
        if (shadowed(unit.node, scope)) {
            skip(unit.node, unit.label, "a function in between rebinds `t`");
            continue;
        }
        let built;
        try {
            built = buildMessage(unit.parts, sf);
        } catch (error) {
            if (!(error instanceof Skip)) throw error;
            skip(unit.node, unit.label, error.message);
            continue;
        }
        const { key, isNew } = keyFor(catalog, namespace, built.message, built.slugSource, from);
        if (isNew) added.push({ key, message: built.message });
        edits.push({ start: unit.start, end: unit.end, text: unit.wrap(call(key, built.args)) });
        if (scopes.get(scope) === null) scopes.set(scope, "needed");
    }

    const needed = [...scopes].filter(([, state]) => state === "needed").map(([fn]) => fn);
    if (needed.some((fn) => !isAsync(fn))) importName(sf, "useTranslations", module, edits);
    if (needed.some(isAsync)) importName(sf, "getTranslations", "next-intl/server", edits);
    for (const fn of needed) declareT(fn, sf, isAsync(fn), edits);

    let out = source;
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    return { source: out, added, skipped: skipped.sort((a, b) => a.line - b.line) };
}

// ---------------------------------------------------------------- CLI

const toRepo = (repo, abs) => relative(repo, abs).split(sep).join("/");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function unifiedDiff(label, before, after) {
    const dir = mkdtempSync(join(tmpdir(), "i18n-extract-"));
    try {
        writeFileSync(join(dir, "a"), before);
        writeFileSync(join(dir, "b"), after);
        const result = spawnSync("diff", ["-u", "--label", `a/${label}`, "--label", `b/${label}`, join(dir, "a"), join(dir, "b")], {
            encoding: "utf8",
        });
        return result.stdout;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** The source files --prune looks keys up in, with `pending` (not yet written) contents. */
function keyUserFiles(repo, pending) {
    return KEY_USERS.filter((p) => existsSync(join(repo, p)))
        .flatMap((p) => sourceFiles(join(repo, p)))
        .map((abs) => {
            const original = readFileSync(abs, "utf8");
            return { name: toRepo(repo, abs), text: pending.get(abs) ?? original, original };
        });
}

/** Keys of the namespace that no source file names any more, less those a dynamic use may reach. */
function unusedKeys(files, catalog, namespace, dynamic) {
    const root = subtree(catalog.en, namespace, false);
    if (!root) return [];
    const sources = files.map((f) => f.text);
    const quoted = (s) => new RegExp(`["'\`]${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
    return leaves(root, `${namespace}.`).filter((key) => {
        const parts = key.split(".");
        // Used in full, or through a namespaced translator: t = useTranslations("a.b"); t("c").
        const named = sources.some(
            (src) =>
                quoted(key).test(src) ||
                parts.slice(1).some((_, i) => quoted(parts.slice(0, i + 1).join(".")).test(src) && quoted(parts.slice(i + 1).join(".")).test(src)),
        );
        return !named && !dynamic.some((use) => mayReach(use, key));
    });
}

/**
 * Runs the codemod over repository paths. Without `write` it changes
 * nothing and prints what it would do. Returns the report it printed.
 */
export function run({
    repo = DEFAULT_REPO,
    namespace,
    paths = [],
    from = "en-US",
    write = false,
    prune = false,
    allowDynamic = false,
    out = (s) => process.stdout.write(s),
    warn = (s) => process.stderr.write(s),
}) {
    if (!namespace || !/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/.test(namespace))
        throw new Error("--ns <namespace> is required, as dotted camelCase: settings.appearance");
    if (!["en-US", "es-MX"].includes(from)) throw new Error("--from is en-US (the default) or es-MX");
    const catalog = { en: readJson(join(repo, CATALOGS.en)), es: readJson(join(repo, CATALOGS.es)) };
    const baseline = readJson(join(repo, BASELINE));
    let report = "";
    const say = (s) => {
        report += s;
        out(s);
    };
    const changed = [];
    let catalogChanged = false;
    let baselineChanged = false;
    const warned = new Set();
    const warnDynamic = (file, source) => {
        if (!TRANSLATE_HINT.test(source)) return [];
        const uses = dynamicUses(parseSource(file, source));
        for (const use of uses) {
            const message = dynamicWarning(file, use);
            if (!warned.has(message)) {
                warned.add(message);
                warn(message);
            }
        }
        return uses;
    };

    for (const path of paths) {
        const abs = resolve(repo, path);
        if (!existsSync(abs)) throw new Error(`no such path: ${path}`);
        const rel = toRepo(repo, abs);
        if (!baseline.migrated.some((p) => rel === p || rel.startsWith(`${p.replace(/\/$/, "")}/`))) {
            baseline.migrated = [...baseline.migrated, rel].sort();
            baselineChanged = true;
        }
        for (const file of sourceFiles(abs)) {
            const name = toRepo(repo, file);
            const source = readFileSync(file, "utf8");
            const result = extractSource({ fileName: name, source, namespace, catalog, from });
            if (result.added.length) catalogChanged = true;
            if (result.source !== source) {
                changed.push({ file, source: result.source });
                say(unifiedDiff(name, source, result.source));
            }
            for (const { key, message } of result.added) say(`+ ${key}: ${JSON.stringify(message)}\n`);
            for (const s of result.skipped) say(`left ${name}:${s.line} ${JSON.stringify(s.text)}: ${s.reason}\n`);
            warnDynamic(name, source);
            const left = visibleLiterals(name, result.source).length;
            const before = baseline.allowed[name] ?? 0;
            if (left !== before) {
                if (left > before) say(`baseline ${name}: ${before} -> ${left} (raised: lower it in a follow-up)\n`);
                if (left) baseline.allowed[name] = left;
                else delete baseline.allowed[name];
                baselineChanged = true;
            }
        }
    }
    if (prune) {
        const pending = new Map(changed.map(({ file, source }) => [file, source]));
        const files = keyUserFiles(repo, pending);
        const dynamic = files.flatMap(({ name, original }) => warnDynamic(name, original));
        if (dynamic.length && !allowDynamic)
            throw new Error(
                `--prune refused: ${dynamic.length} call(s) of t(), t.rich(), t.markup(), a translator from useTranslations(), getTranslations() or a factory such as clientTranslator(), or those hooks themselves, take a key or namespace that is not a literal (listed above), so unused keys cannot be told apart. Nothing was changed. Make them literals, or add --allow-dynamic to prune without the keys they may reach.`,
            );
        if (dynamic.length) say(`(--allow-dynamic: keeping the keys ${dynamic.length} dynamic call(s) may reach)\n`);
        for (const key of unusedKeys(files, catalog, namespace, dynamic)) {
            removeKey(catalog.en, key);
            removeKey(catalog.es, key);
            catalogChanged = true;
            say(`- ${key} (no source uses it)\n`);
        }
    }
    baseline.allowed = sortTree(baseline.allowed);

    if (!write) {
        if (changed.length || catalogChanged || baselineChanged) say("(dry run: nothing written; add --write)\n");
        else say("nothing to change\n");
        return report;
    }
    for (const { file, source } of changed) writeFileSync(file, source);
    if (catalogChanged) {
        writeFileSync(join(repo, CATALOGS.en), serializeCatalog(catalog.en));
        writeFileSync(join(repo, CATALOGS.es), serializeCatalog(catalog.es));
    }
    if (baselineChanged) writeFileSync(join(repo, BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
    return report;
}

function main(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            ns: { type: "string" },
            from: { type: "string", default: "en-US" },
            write: { type: "boolean", default: false },
            prune: { type: "boolean", default: false },
            "allow-dynamic": { type: "boolean", default: false },
        },
    });
    if (!positionals.length && !values.prune) throw new Error("give at least one path, or --prune");
    run({
        namespace: values.ns,
        paths: positionals,
        from: values.from,
        write: values.write,
        prune: values.prune,
        allowDynamic: values["allow-dynamic"],
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`extract: ${error.message}\n`);
        process.exit(1);
    }
}
