// @vitest-environment node
// The batch translator (scripts/i18n/translate.mjs). The Antigravity CLI is a
// stub executable: no test calls the real one.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOGS, serializeCatalog } from "./catalog-io.mjs";
import { PENDING_TRANSLATION } from "./literals.mjs";
import { DEFAULT_BATCH, MODEL, buildPrompt, buildSchema, run, selectExamples, validateResponse } from "./translate.mjs";

const P = PENDING_TRANSLATION;
const PLURAL = "{count, plural, one {# file} other {# files}}";
const entries = [
    ["a.save", "Save"],
    ["a.hello", "Hello, {name}"],
    ["a.files", PLURAL],
    ["a.terms", "Read <link>the terms</link>"],
];
const good = {
    "a.save": "Guardar",
    "a.hello": "Hola, {name}",
    "a.files": "{count, plural, one {# archivo} many {# de archivos} other {# archivos}}",
    "a.terms": "Lee <link>los términos</link>",
};
const reasons = (response, key) => validateResponse(entries, response).rejected.get(key);

describe("translate: the validator", () => {
    it("accepts a faithful translation, a Spanish `many` included", () => {
        const { accepted, rejected } = validateResponse(entries, good);
        expect([...accepted.keys()]).toEqual(entries.map(([k]) => k));
        expect(rejected.size).toBe(0);
    });

    it("rejects a missing argument", () => {
        expect(reasons({ ...good, "a.hello": "Hola" }, "a.hello")).toBeTruthy();
        expect(reasons({ ...good, "a.hello": "Hola, {nombre}" }, "a.hello")).toBeTruthy();
    });

    it("rejects a different plural shape", () => {
        expect(reasons({ ...good, "a.files": "{count, plural, other {# archivos}}" }, "a.files")).toBeTruthy(); // dropped `one`
        expect(reasons({ ...good, "a.files": "{count, plural, one {# archivo} two {# a} other {# archivos}}" }, "a.files")).toBeTruthy();
        expect(reasons({ ...good, "a.files": "# archivos" }, "a.files")).toBeTruthy();
    });

    it("rejects an extra key, and uses nothing from that response", () => {
        const { accepted, rejected } = validateResponse(entries, { ...good, "a.other": "Otro" });
        expect(accepted.size).toBe(0);
        expect(rejected.get("a.save")[0]).toMatch(/unrequested keys: a\.other/);
    });

    it("reads a literal \\u003c as <", () => {
        const { accepted } = validateResponse(entries, { ...good, "a.terms": "Lee \\u003clink\\u003elos términos\\u003c/link\\u003e" });
        expect(accepted.get("a.terms")).toBe(good["a.terms"]);
    });

    it("rejects a lost tag", () => {
        expect(reasons({ ...good, "a.terms": "Lee los términos" }, "a.terms")).toBeTruthy();
        expect(reasons({ ...good, "a.terms": "Lee <a>los términos</a>" }, "a.terms")).toBeTruthy();
    });

    it("rejects the pending mark, empty and non-string values, a missing key and invalid ICU", () => {
        expect(reasons({ ...good, "a.save": `${P}Save` }, "a.save")).toContain("still carries the pending mark");
        expect(reasons({ ...good, "a.save": "  " }, "a.save")).toEqual(["empty"]);
        expect(reasons({ ...good, "a.save": 3 }, "a.save")).toEqual(["not a string"]);
        const { "a.save": _, ...missing } = good;
        expect(reasons(missing, "a.save")).toEqual(["missing from the response"]);
        expect(reasons({ ...good, "a.hello": "Hola, {name" }, "a.hello")[0]).toMatch(/not valid ICU/);
    });

    it("asks for exactly the keys, closed", () => {
        expect(buildSchema(["a", "b"])).toEqual({
            type: "object",
            properties: { a: { type: "string" }, b: { type: "string" } },
            required: ["a", "b"],
            additionalProperties: false,
        });
    });
});

describe("translate: style examples", () => {
    const en = { a: { save: "Save", other: "Other" }, b: { z: "Close", y: "Back", pend: "Next", same: "LiTT", long: "x".repeat(80) }, c: { k: "Open" } };
    const es = { a: { save: `${P}Save`, other: "Otra" }, b: { z: "Cerrar", y: "Atrás", pend: `${P}Next`, same: "LiTT", long: "y".repeat(80) }, c: { k: "Abrir" } };
    const catalog = { en, es };
    const batch = [["a.save", "Save"]];

    it("defaults to batches of 40", () => expect(DEFAULT_BATCH).toBe(40));

    it("takes only translated pairs: same root first, then short ones in key order, never pending or batch keys", () => {
        const picked = selectExamples(catalog, batch, 40);
        expect(picked.map(([k]) => k)).toEqual(["a.other", "b.y", "b.z", "c.k", "b.long"]);
        expect(selectExamples(catalog, batch, 2).map(([k]) => k)).toEqual(["a.other", "b.y"]);
        expect(selectExamples(catalog, batch, 40)).toEqual(picked); // deterministic
    });

    it("puts the examples in the prompt, apart from the messages to translate", () => {
        const prompt = buildPrompt("# G", batch, selectExamples(catalog, batch, 2));
        expect(prompt).toContain("examples of the style of LiTT");
        expect(prompt).toContain('"es": "Otra"');
        expect(prompt.indexOf("Otra")).toBeLessThan(prompt.indexOf("# Messages to translate"));
        expect(buildPrompt("# G", batch)).not.toContain("examples of the style");
    });

    it("tells the model to answer through the finish tool and use no other", () => {
        const prompt = buildPrompt("# G", batch);
        expect(prompt).toContain("calling the structured-output tool `finish` exactly once");
        expect(prompt).toContain("Use no other tool");
        expect(prompt).not.toContain("Do not use tools");
    });
});

describe("translate: the run, with a stub CLI", () => {
    const dirs = [];
    afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

    /**
     * A repo copy with a catalog of the entries above and a stub `antigravity`
     * that answers from `script` (one reply per call, in order) and records its args.
     */
    function setup(script, { pending = entries } = {}) {
        const repo = mkdtempSync(join(tmpdir(), "translate-test-"));
        dirs.push(repo);
        mkdirSync(join(repo, "packages/i18n/messages"), { recursive: true });
        const tree = (f) => ({ a: Object.fromEntries(pending.map(([k, v]) => [k.slice(2), f(v)])) });
        writeFileSync(join(repo, CATALOGS.en), serializeCatalog(tree((v) => v)));
        writeFileSync(join(repo, CATALOGS.es), serializeCatalog(tree((v) => `${P}${v}`)));
        writeFileSync(join(repo, "packages/i18n/GLOSSARY.md"), "# Glosario\n\n| matter | asunto |\n");
        writeFileSync(join(repo, "script.json"), JSON.stringify(script));
        const bin = join(repo, "antigravity");
        writeFileSync(
            bin,
            `#!/usr/bin/env node
const fs = require("node:fs");
const dir = ${JSON.stringify(repo)};
const script = JSON.parse(fs.readFileSync(dir + "/script.json", "utf8"));
const n = fs.existsSync(dir + "/calls.jsonl") ? fs.readFileSync(dir + "/calls.jsonl", "utf8").trim().split("\\n").length : 0;
fs.appendFileSync(dir + "/calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
const step = script[Math.min(n, script.length - 1)];
if (step === "crash") process.exit(3);
if (step === "garbage") { console.log("not json"); process.exit(0); }
const text = typeof step.response === "string" ? step.response : JSON.stringify(step.response);
console.log(JSON.stringify({ conversation_id: "c", status: step.status ?? "SUCCESS", response: text, usage: { input_tokens: 100, output_tokens: 20 } }));
`,
        );
        chmodSync(bin, 0o755);
        const env = { ...process.env, LITT_I18N_ANTIGRAVITY_BIN: bin };
        for (const name of ["LITT_I18N_MODEL", "LITT_I18N_ANTIGRAVITY_MODEL", "ANTIGRAVITY_MODEL"]) delete env[name];
        const calls = () => {
            try {
                return readFileSync(join(repo, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
            } catch {
                return [];
            }
        };
        const es = () => JSON.parse(readFileSync(join(repo, CATALOGS.es), "utf8")).a;
        const go = (options = {}) =>
            run({ repo, env, out: () => {}, receipt: "receipt.log", now: () => new Date("2026-11-11T12:00:00Z"), ...options });
        return { repo, calls, es, go };
    }

    it("writes a valid batch, in the catalog's own format, with one call and the fixed model", () => {
        const t = setup([{ response: good }]);
        const before = readFileSync(join(t.repo, CATALOGS.es), "utf8");
        const result = t.go();
        expect(result).toMatchObject({ failed: [], exitCode: 0, tokens: { input: 100, output: 20 } });
        expect(t.es().files).toBe(good["a.files"]);
        const after = readFileSync(join(t.repo, CATALOGS.es), "utf8");
        expect(after).toBe(serializeCatalog(JSON.parse(after)));
        expect(after.split("\n").length).toBe(before.split("\n").length); // same shape, no formatting noise
        const [args] = t.calls();
        expect(t.calls()).toHaveLength(1);
        expect(args[args.indexOf("--model") + 1]).toBe(MODEL);
        expect(args).toContain("--sandbox");
        expect(JSON.parse(args[args.indexOf("--json-schema") + 1]).required).toEqual(["a.files", "a.hello", "a.save", "a.terms"]); // catalog (sorted) order
        expect(args[1]).toContain("| matter | asunto |"); // the glossary rides in the prompt
        expect(readFileSync(join(t.repo, "receipt.log"), "utf8")).toMatch(/translated=4 failed=0 tokens_in=100 tokens_out=20/);
    });

    it("sends translated examples in the prompt and only the batch keys in the schema", () => {
        const t = setup([{ response: good }]);
        const en = JSON.parse(readFileSync(join(t.repo, CATALOGS.en), "utf8"));
        const es = JSON.parse(readFileSync(join(t.repo, CATALOGS.es), "utf8"));
        en.b = { close: "Close" };
        es.b = { close: "Cerrar ya" };
        writeFileSync(join(t.repo, CATALOGS.en), serializeCatalog(en));
        writeFileSync(join(t.repo, CATALOGS.es), serializeCatalog(es));
        t.go();
        const [args] = t.calls();
        expect(args[1]).toContain("Cerrar ya"); // already translated: an example
        expect(args[1]).not.toMatch(/"es": ".*por traducir/); // never a pending one
        expect(JSON.parse(args[args.indexOf("--json-schema") + 1]).required).toEqual(["a.files", "a.hello", "a.save", "a.terms"]);
    });

    it("accepts a fenced JSON reply", () => {
        const t = setup([{ response: `\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\n` }]);
        expect(t.go().exitCode).toBe(0);
    });

    it("retries only the failed key, once, and writes it when the retry is valid", () => {
        const t = setup([{ response: { ...good, "a.hello": "Hola" } }, { response: { "a.hello": "Hola, {name}" } }]);
        expect(t.go().exitCode).toBe(0);
        expect(t.calls()).toHaveLength(2);
        const retrySchema = JSON.parse(t.calls()[1][t.calls()[1].indexOf("--json-schema") + 1]);
        expect(retrySchema.required).toEqual(["a.hello"]);
        expect(t.es().hello).toBe("Hola, {name}");
    });

    it("retries once, then leaves the key marked, reports it and exits 1", () => {
        const bad = { ...good, "a.terms": "Lee los términos" };
        const t = setup([{ response: bad }, { response: { "a.terms": "Lee los términos" } }, { response: good }]);
        const result = t.go();
        expect(t.calls()).toHaveLength(2); // no third attempt
        expect(result.failed).toEqual(["a.terms"]);
        expect(result.exitCode).toBe(1);
        expect(t.es().terms).toBe(`${P}Read <link>the terms</link>`);
        expect(t.es().save).toBe("Guardar");
        expect(readFileSync(join(t.repo, "receipt.log"), "utf8")).toMatch(/FAILED a\.terms/);
    });

    it("never writes an invalid translation, even when the whole call fails twice", () => {
        for (const step of ["crash", "garbage", { status: "ERROR", response: "x" }, { response: "[1]" }, { response: "{nope" }]) {
            const t = setup([step]);
            const result = t.go();
            expect(t.calls()).toHaveLength(2);
            expect(result.exitCode).toBe(1);
            expect(Object.values(t.es()).every((v) => v.startsWith(P))).toBe(true);
        }
    });

    it("filters by namespace and splits batches", () => {
        const t = setup([{ response: { "a.files": good["a.files"], "a.hello": good["a.hello"] } }, { response: { "a.save": good["a.save"], "a.terms": good["a.terms"] } }]);
        expect(t.go({ batch: 2 }).exitCode).toBe(0);
        expect(t.calls()).toHaveLength(2);
        const none = t.go({ namespace: "zzz" });
        expect(none.translated).toEqual([]);
        expect(t.calls()).toHaveLength(2);
    });

    it("--dry-run calls nothing and writes nothing", () => {
        const t = setup([{ response: good }]);
        const lines = [];
        const before = readFileSync(join(t.repo, CATALOGS.es), "utf8");
        expect(t.go({ dryRun: true, out: (s) => lines.push(s) }).exitCode).toBe(0);
        expect(t.calls()).toHaveLength(0);
        expect(readFileSync(join(t.repo, CATALOGS.es), "utf8")).toBe(before);
        expect(lines.join("")).toMatch(/Glosario|Glossary/);
    });

    it("refuses another model, by option or by environment", () => {
        const t = setup([{ response: good }]);
        expect(() => t.go({ model: "gemini-other" })).toThrow(/fixed/);
        expect(() => t.go({ env: { LITT_I18N_MODEL: "x" } })).toThrow(/fixed/);
        expect(() => t.go({ model: MODEL })).not.toThrow();
        expect(t.calls().every((c) => c[c.indexOf("--model") + 1] === MODEL)).toBe(true);
    });
});
