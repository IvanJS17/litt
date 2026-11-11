#!/usr/bin/env node
// Translates the es-MX messages the codemod left marked (PENDING_TRANSLATION,
// "⟦por traducir⟧ ") with the Antigravity CLI, in batches, and writes only
// what passes a deterministic check. The model is fixed by the owner's
// decision of 2026-11-11: there is no option to change it, and the script
// refuses to run if one is given.
//
//   node scripts/i18n/translate.mjs [--ns <namespace>] [--dry-run] [--batch 80] [--receipt <path>]
//
// For each pending key the source is the en-US message. Per key, before
// anything is written (no AI involved):
//   - the key is one of those asked for (an unrequested key rejects the response);
//   - the message is a non-empty string without the pending mark;
//   - it parses as ICU and has the same arguments, tags, plural and select
//     shape as the source (scripts/i18n/icu-compare.mjs, the same check as
//     packages/i18n/src/catalog.test.ts; Spanish may add `many`).
// A key that fails is asked again once, alone with the other failures. If it
// fails again it stays marked and is reported; an invalid translation is
// never written. A whole batch that fails (status, JSON, timeout) is retried
// once too. The exit code is 1 when any key is left untranslated.
//
// A receipt (batches, keys, failures, tokens; no message text) goes to
// artifacts/i18n/translate-<date>.log when git ignores it, else to $TMPDIR.
// Tests replace the binary with LITT_I18N_ANTIGRAVITY_BIN; nothing else.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CATALOGS, getLeaf, leaves, serializeCatalog, setLeaf } from "./catalog-io.mjs";
import { structureProblems } from "./icu-compare.mjs";
import { PENDING_TRANSLATION } from "./literals.mjs";

const DEFAULT_REPO = resolve(fileURLToPath(import.meta.url), "../../..");
export const MODEL = "gemini-3.8-flash-high";
export const DEFAULT_BATCH = 80;
const PRINT_TIMEOUT_S = 300;
const MARK = PENDING_TRANSLATION.trim(); // "⟦por traducir⟧"

// Environment variables that would pick another model: refused, not ignored.
const MODEL_ENV = ["LITT_I18N_MODEL", "LITT_I18N_ANTIGRAVITY_MODEL", "ANTIGRAVITY_MODEL"];

export function assertFixedModel({ model, env = process.env } = {}) {
    if (model !== undefined && model !== MODEL)
        throw new Error(`the model is fixed to ${MODEL} (owner's decision, 2026-11-11); refusing "${model}"`);
    const set = MODEL_ENV.filter((name) => env[name]);
    if (set.length) throw new Error(`the model is fixed to ${MODEL}; refusing to run with ${set.join(", ")} set`);
}

// ---------------------------------------------------------------- prompt

const RULES = `You translate the user interface of LiTT, a legal-tech web app and Word add-in, from US English into Mexican Spanish (es-MX).

Rules:
- Address the user as "tú" ("Guarda tus cambios", "Elige tu idioma"), never "usted".
- Follow the glossary below exactly: a term is always translated the same way.
- The messages are ICU MessageFormat. Keep every {argument} with the same name, every plural and select with the same arguments and the same cases (keep "=N" cases and "offset"), and "#" inside plurals. Do not translate argument names, select option names or plural keywords (one, other, ...). Spanish may add a "many" case ("# de archivos"); always keep "other".
- Keep rich-text tags such as <b>…</b> or <link>…</link> exactly as written (same names, same nesting) and translate only the text between them. Write "<" and ">" as the characters themselves, never as \\u003c or \\u003e.
- Write apostrophes and braces so the result is still valid ICU: a literal apostrophe before { or } needs the ICU quoting the source uses.
- Do not translate brand names (LiTT, MikeOSS, Microsoft Word, Google Drive, BYOK), model or provider names, or technical values (ids, codes, Request ID, file extensions).
- Keep punctuation, ellipses, emoji and capitalization style consistent with the source; labels stay short.
- Never add explanations, notes or Markdown.
- Answer directly from the text below. Do not use tools, run commands or read files.

Return only a JSON object with exactly the keys you were given, each mapped to its Spanish message.`;

export function buildPrompt(glossary, entries) {
    return `${RULES}\n\n# Glossary\n\n${glossary.trim()}\n\n# Messages to translate\n\nA JSON object: key -> English message.\n\n${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

/** A JSON schema asking for exactly these keys, all strings. */
export function buildSchema(keys) {
    return {
        type: "object",
        properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
        required: [...keys],
        additionalProperties: false,
    };
}

// ---------------------------------------------------------------- validation

/**
 * Checks a model response against the keys asked for. Returns the
 * translations that pass and, for every key that does not, why.
 * @returns {{ accepted: Map<string,string>, rejected: Map<string,string[]> }}
 */
/** The model sometimes writes < and > as a literal \\u003c / \\u003e inside the string; those are the characters. */
const unescapeAngles = (v) => (typeof v === "string" ? v.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">") : v);

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

// ---------------------------------------------------------------- the CLI

/**
 * One call to the Antigravity CLI. Returns { ok, response, usage, error }.
 * `response` is the parsed JSON object the model returned.
 */
export function callAntigravity({ prompt, schema, env = process.env, bin = env.LITT_I18N_ANTIGRAVITY_BIN || "antigravity" }) {
    const args = [
        "-p", prompt,
        "--model", MODEL,
        "--output-format", "json",
        "--sandbox",
        "--print-timeout", `${PRINT_TIMEOUT_S}s`,
        "--json-schema", JSON.stringify(schema),
    ];
    const result = spawnSync(bin, args, { encoding: "utf8", timeout: (PRINT_TIMEOUT_S + 30) * 1000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) return { ok: false, error: `could not run the CLI: ${result.error.message}` };
    if (result.status !== 0) return { ok: false, error: `CLI exited with ${result.status}` };
    let envelope;
    try {
        envelope = JSON.parse(result.stdout);
    } catch {
        return { ok: false, error: "CLI output is not JSON" };
    }
    const usage = envelope.usage ?? {};
    if (envelope.status !== "SUCCESS") return { ok: false, usage, error: `CLI status ${envelope.status}` };
    // With --json-schema the CLI also returns the parsed object as structured_output; the text is the fallback.
    const structured = envelope.structured_output;
    if (structured !== null && typeof structured === "object" && !Array.isArray(structured))
        return { ok: true, response: structured, usage };
    if (typeof envelope.response !== "string") return { ok: false, usage, error: "CLI response is not text" };
    let text = envelope.response.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
    if (fenced) text = fenced[1];
    try {
        const response = JSON.parse(text);
        if (response === null || typeof response !== "object" || Array.isArray(response))
            return { ok: false, usage, error: "response JSON is not an object" };
        return { ok: true, response, usage };
    } catch {
        return { ok: false, usage, error: "response is not valid JSON" };
    }
}

// ---------------------------------------------------------------- run

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

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

function isGitIgnored(repo, rel) {
    return spawnSync("git", ["check-ignore", "-q", rel], { cwd: repo }).status === 0;
}

/** Where the receipt goes: the given path, artifacts/i18n/ if git ignores it, else $TMPDIR. */
export function receiptPath({ repo, receipt, date, env = process.env }) {
    if (receipt) return { path: resolve(repo, receipt), note: "" };
    const rel = `artifacts/i18n/translate-${date}.log`;
    if (isGitIgnored(repo, rel)) return { path: join(repo, rel), note: "" };
    return {
        path: join(env.TMPDIR || tmpdir(), `litt-i18n-translate-${date}.log`),
        note: `artifacts/ is not ignored by git in this checkout, so the receipt is outside the repo`,
    };
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * Translates the pending messages. Returns { translated, failed, tokens, receipt, exitCode }.
 */
export function run({
    repo = DEFAULT_REPO,
    namespace,
    dryRun = false,
    batch = DEFAULT_BATCH,
    receipt,
    model,
    env = process.env,
    out = (s) => process.stdout.write(s),
    now = () => new Date(),
} = {}) {
    assertFixedModel({ model, env });
    if (!Number.isInteger(batch) || batch < 1) throw new Error("--batch must be a positive integer");
    const catalog = { en: readJson(join(repo, CATALOGS.en)), es: readJson(join(repo, CATALOGS.es)) };
    const glossary = readFileSync(join(repo, "packages/i18n/GLOSSARY.md"), "utf8");
    const { entries, sourcePending } = pendingEntries(catalog, namespace);
    const scope = namespace ? ` in ${namespace}` : "";
    const lines = [];
    const say = (s) => {
        lines.push(s);
        out(`${s}\n`);
    };
    for (const key of sourcePending) say(`skipped ${key}: its en-US source is empty or pending too`);
    if (!entries.length) {
        say(`nothing to translate${scope}`);
        return { translated: [], failed: [], tokens: { input: 0, output: 0 }, exitCode: sourcePending.length ? 1 : 0 };
    }
    const batches = chunks(entries, batch);

    if (dryRun) {
        say(`dry run: ${entries.length} pending message(s)${scope}, ${batches.length} batch(es) of up to ${batch}; model ${MODEL}; no CLI call`);
        batches.forEach((b, i) => {
            say(`\n--- batch ${i + 1}/${batches.length}: ${b.length} key(s)`);
            say(b.map(([k]) => `  ${k}`).join("\n"));
        });
        say(`\n--- prompt of batch 1\n${buildPrompt(glossary, batches[0])}`);
        return { translated: [], failed: [], tokens: { input: 0, output: 0 }, exitCode: 0 };
    }

    const tokens = { input: 0, output: 0 };
    const translated = [];
    const failures = new Map(); // key -> reasons of the last attempt
    const log = [];
    const attempt = (label, work) => {
        const result = callAntigravity({ prompt: buildPrompt(glossary, work), schema: buildSchema(work.map(([k]) => k)), env });
        tokens.input += result.usage?.input_tokens ?? 0;
        tokens.output += result.usage?.output_tokens ?? 0;
        const tok = `tokens in=${result.usage?.input_tokens ?? 0} out=${result.usage?.output_tokens ?? 0}`;
        if (!result.ok) {
            log.push(`${label}: ${work.length} key(s), call failed: ${result.error}; ${tok}`);
            return { accepted: new Map(), rejected: new Map(work.map(([k]) => [k, [result.error]])) };
        }
        const checked = validateResponse(work, result.response);
        log.push(`${label}: ${work.length} key(s), ${checked.accepted.size} accepted, ${checked.rejected.size} rejected; ${tok}`);
        for (const [key, why] of checked.rejected) log.push(`  rejected ${key}: ${why.join("; ")}`);
        return checked;
    };

    batches.forEach((work, i) => {
        const label = `batch ${i + 1}/${batches.length}`;
        let { accepted, rejected } = attempt(label, work);
        if (rejected.size) {
            // The one retry: only the keys that did not pass, together.
            const again = work.filter(([k]) => rejected.has(k));
            const second = attempt(`${label} retry`, again);
            accepted = new Map([...accepted, ...second.accepted]);
            rejected = second.rejected;
        }
        for (const [key, value] of accepted) {
            setLeaf(catalog.es, key, value);
            translated.push(key);
        }
        for (const [key, why] of rejected) failures.set(key, why);
        // Written per batch, so a later failure does not lose this batch.
        if (accepted.size) writeFileSync(join(repo, CATALOGS.es), serializeCatalog(catalog.es));
        say(`${label}: ${accepted.size}/${work.length} translated`);
    });

    const failed = [...failures.keys()];
    for (const [key, why] of failures) say(`left marked ${key}: ${why.join("; ")}`);
    say(`done: ${translated.length} translated, ${failed.length} left marked; tokens in=${tokens.input} out=${tokens.output}; model ${MODEL}`);

    const date = now().toISOString().slice(0, 10);
    const target = receiptPath({ repo, receipt, date, env });
    mkdirSync(dirname(target.path), { recursive: true });
    const body = [
        `# translate.mjs ${now().toISOString()} model=${MODEL}${namespace ? ` ns=${namespace}` : ""} batch=${batch}`,
        ...log,
        ...failed.map((k) => `FAILED ${k}`),
        `total: translated=${translated.length} failed=${failed.length} tokens_in=${tokens.input} tokens_out=${tokens.output}`,
        "",
    ].join("\n");
    appendFileSync(target.path, body);
    if (target.note) say(`note: ${target.note}`);
    say(`receipt: ${target.path}`);
    return { translated, failed, tokens, receipt: target.path, exitCode: failed.length || sourcePending.length ? 1 : 0 };
}

function main(argv) {
    if (argv.some((a) => a === "--model" || a.startsWith("--model=")))
        throw new Error(`the model is fixed to ${MODEL} (owner's decision, 2026-11-11); there is no --model option`);
    const { values } = parseArgs({
        args: argv,
        options: {
            ns: { type: "string" },
            "dry-run": { type: "boolean", default: false },
            batch: { type: "string", default: String(DEFAULT_BATCH) },
            receipt: { type: "string" },
        },
    });
    const { exitCode } = run({
        namespace: values.ns,
        dryRun: values["dry-run"],
        batch: Number(values.batch),
        receipt: values.receipt,
    });
    process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`translate: ${error.message}\n`);
        process.exit(1);
    }
}
