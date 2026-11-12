#!/usr/bin/env node
// Moves the es-MX messages the codemod left marked (PENDING_TRANSLATION,
// "⟦por traducir⟧ ") out to a translator and back. The script calls no model:
// whoever translates (a subagent or a person) works from the exported file.
//
//   node scripts/i18n/translate.mjs --export <file.json> [--ns <namespace>]
//   node scripts/i18n/translate.mjs --apply  <file.json> [--receipt <path>]
//
// --export writes { generated_at, glossary, rules, examples, pending }:
// `pending` maps each marked key to its en-US text, `examples` are already
// translated en-US -> es-MX pairs of the catalog (style), `glossary` and
// `rules` point to the documents the translator must follow.
//
// --apply reads a flat { "<key>": "<es-MX text>" } and, per key, before
// anything is written: the key must be pending; the text a non-empty string
// without the pending mark; and it must parse as ICU with the same arguments,
// tags, plural and select shape as its en-US source
// (scripts/i18n/icu-compare.mjs, the same check as packages/i18n/src/catalog.test.ts;
// Spanish may add `many`). Only the keys that pass are written. The rejected
// ones are printed with the reason, and so are the pending keys the file did
// not carry. The exit code is 1 while any key is rejected or still pending.
// The optional receipt holds counts only, never message text.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CATALOGS, getLeaf, isTree, leaves, serializeCatalog, setLeaf } from "./catalog-io.mjs";
import { structureProblems } from "./icu-compare.mjs";
import { PENDING_TRANSLATION } from "./literals.mjs";

const DEFAULT_REPO = resolve(fileURLToPath(import.meta.url), "../../..");
export const EXAMPLE_COUNT = 40;
const SHORT_MESSAGE = 60; // characters: what counts as a short interface message
const MARK = PENDING_TRANSLATION.trim(); // "⟦por traducir⟧"
const GLOSSARY = "packages/i18n/GLOSSARY.md";
const RULES = "docs/i18n.md#spanish";

/** The first segment of a key: its root namespace. */
const rootOf = (key) => key.split(".")[0];

/**
 * Style examples: already translated en-US -> es-MX pairs of the real catalog
 * (never pending ones, never keys of the batch). Deterministic: the batch's own
 * root namespaces first, then the others; inside each group the short plain
 * messages first, then the rest, always in key order.
 * @returns {Array<[string, string, string]>} [key, en, es]
 */
export function selectExamples(catalog, entries, count = EXAMPLE_COUNT) {
    const asked = new Set(entries.map(([k]) => k));
    const roots = new Set(entries.map(([k]) => rootOf(k)));
    const pool = [];
    for (const key of leaves(catalog.es)) {
        if (asked.has(key)) continue;
        const es = getLeaf(catalog.es, key);
        const en = getLeaf(catalog.en, key);
        if (typeof es !== "string" || typeof en !== "string") continue;
        if (es.trim() === "" || en.trim() === "" || es.includes(MARK) || en.includes(MARK) || es === en) continue;
        pool.push([key, en, es]);
    }
    const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const plainShort = ([, en, es]) => en.length <= SHORT_MESSAGE && es.length <= SHORT_MESSAGE && !/[{}<]/.test(en);
    const ordered = (group) => [...group.filter(plainShort).sort(byKey), ...group.filter((e) => !plainShort(e)).sort(byKey)];
    const same = pool.filter(([k]) => roots.has(rootOf(k)));
    const other = pool.filter(([k]) => !roots.has(rootOf(k)));
    return [...ordered(same), ...ordered(other)].slice(0, count);
}

// ---------------------------------------------------------------- validation

/** A translator sometimes writes < and > as a literal \\u003c / \\u003e inside the string; those are the characters. */
const unescapeAngles = (v) => (typeof v === "string" ? v.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">") : v);

/**
 * Checks a translation against the entries asked for. Returns the
 * translations that pass and, for every key that does not, why.
 * @returns {{ accepted: Map<string,string>, rejected: Map<string,string[]> }}
 */
export function validateResponse(entries, response, locale = "es-MX") {
    const accepted = new Map();
    const rejected = new Map();
    const sources = new Map(entries);
    const extra = Object.keys(response).filter((k) => !sources.has(k));
    if (extra.length) {
        // A key nobody asked for: the response cannot be trusted to line up, so none of it is used.
        for (const key of sources.keys()) rejected.set(key, [`response has unrequested keys: ${extra.join(", ")}`]);
        return { accepted, rejected };
    }
    for (const [key, en] of sources) {
        const value = unescapeAngles(response[key]);
        const problems = [];
        if (typeof value !== "string") problems.push(value === undefined ? "missing from the response" : "not a string");
        else if (value.trim() === "") problems.push("empty");
        else {
            if (value.includes(MARK)) problems.push("still carries the pending mark");
            if (!problems.length) problems.push(...structureProblems(en, value, locale));
        }
        if (problems.length) rejected.set(key, problems);
        else accepted.set(key, value);
    }
    return { accepted, rejected };
}

/** Pending es-MX keys (inside `namespace`, if given) with their en-US text. */
export function pendingEntries(catalog, namespace) {
    const inScope = (k) => !namespace || k === namespace || k.startsWith(`${namespace}.`);
    const entries = [];
    const sourcePending = [];
    for (const key of leaves(catalog.es).filter(inScope)) {
        const value = getLeaf(catalog.es, key);
        if (typeof value !== "string" || !value.startsWith(PENDING_TRANSLATION)) continue;
        const en = getLeaf(catalog.en, key);
        if (typeof en !== "string" || en.startsWith(PENDING_TRANSLATION) || en.trim() === "") sourcePending.push(key);
        else entries.push([key, en]);
    }
    return { entries, sourcePending };
}

// ---------------------------------------------------------------- run

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const loadCatalog = (repo) => ({ en: readJson(join(repo, CATALOGS.en)), es: readJson(join(repo, CATALOGS.es)) });
const defaultOut = (s) => process.stdout.write(s);

/**
 * --export: writes the pending messages and their context to `file`.
 * Returns { count, exitCode }.
 */
export function exportPending({ repo = DEFAULT_REPO, file, namespace, out = defaultOut, now = () => new Date() } = {}) {
    if (!file) throw new Error("--export needs a file path");
    const catalog = loadCatalog(repo);
    const { entries, sourcePending } = pendingEntries(catalog, namespace);
    const scope = namespace ? ` in ${namespace}` : "";
    for (const key of sourcePending) out(`skipped ${key}: its en-US source is empty or pending too\n`);
    if (!entries.length) {
        out(`nothing to translate${scope}\n`);
        return { count: 0, exitCode: sourcePending.length ? 1 : 0 };
    }
    const payload = {
        generated_at: now().toISOString(),
        glossary: GLOSSARY,
        rules: RULES,
        examples: selectExamples(catalog, entries).map(([, en, es]) => ({ en, es })),
        pending: Object.fromEntries(entries),
    };
    const target = resolve(file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
    out(`exported ${entries.length} pending message(s)${scope} to ${target}\n`);
    return { count: entries.length, exitCode: sourcePending.length ? 1 : 0 };
}

/**
 * --apply: validates the flat { key: es-MX text } in `file` and writes the
 * keys that pass. Returns { accepted, rejected, pending, exitCode }.
 */
export function applyTranslations({ repo = DEFAULT_REPO, file, receipt, out = defaultOut, now = () => new Date() } = {}) {
    if (!file) throw new Error("--apply needs a file path");
    const response = readJson(resolve(file));
    if (!isTree(response)) throw new Error("the translations file must be a flat JSON object: { key: text }");
    const catalog = loadCatalog(repo);
    const { entries, sourcePending } = pendingEntries(catalog);
    const pendingKeys = new Set([...entries.map(([k]) => k), ...sourcePending]);

    const rejected = new Map();
    const given = {};
    for (const [key, value] of Object.entries(response)) {
        if (!pendingKeys.has(key)) rejected.set(key, [getLeaf(catalog.es, key) === undefined ? "unknown key: it was not asked for" : "not pending: it is already translated"]);
        else given[key] = value;
    }
    // Only the keys the file carries are checked; the others stay pending and are listed below.
    const checked = validateResponse(entries.filter(([k]) => k in given), given);
    for (const [key, why] of checked.rejected) rejected.set(key, why);
    for (const key of sourcePending) if (key in given) rejected.set(key, ["its en-US source is empty or pending too"]);

    for (const [key, value] of checked.accepted) setLeaf(catalog.es, key, value);
    if (checked.accepted.size) writeFileSync(join(repo, CATALOGS.es), serializeCatalog(catalog.es));

    const pending = [...pendingKeys].filter((k) => !checked.accepted.has(k) && !rejected.has(k)).sort();
    for (const [key, why] of rejected) out(`rejected ${key}: ${why.join("; ")}\n`);
    for (const key of pending) out(`still pending ${key}\n`);
    out(`done: ${checked.accepted.size} accepted, ${rejected.size} rejected, ${pending.length} still pending\n`);

    if (receipt) {
        const target = resolve(repo, receipt);
        mkdirSync(dirname(target), { recursive: true });
        appendFileSync(target, `# translate.mjs --apply ${now().toISOString()} accepted=${checked.accepted.size} rejected=${rejected.size} pending=${pending.length}\n`);
        out(`receipt: ${target}\n`);
    }
    const stuck = rejected.size + pending.length;
    return { accepted: [...checked.accepted.keys()], rejected: [...rejected.keys()], pending, exitCode: stuck ? 1 : 0 };
}

function main(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            export: { type: "string" },
            apply: { type: "string" },
            ns: { type: "string" },
            receipt: { type: "string" },
        },
    });
    if (Boolean(values.export) === Boolean(values.apply)) throw new Error("give exactly one of --export <file> or --apply <file>");
    if (values.export) {
        if (values.receipt) throw new Error("--receipt belongs to --apply");
        process.exitCode = exportPending({ file: values.export, namespace: values.ns }).exitCode;
    } else {
        if (values.ns) throw new Error("--ns belongs to --export");
        process.exitCode = applyTranslations({ file: values.apply, receipt: values.receipt }).exitCode;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`translate: ${error.message}\n`);
        process.exit(1);
    }
}
