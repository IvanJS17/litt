// @vitest-environment node
// The export/apply tool (scripts/i18n/translate.mjs). It calls no model; the
// tests use temporary catalogs, never packages/i18n/messages.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOGS, serializeCatalog } from "./catalog-io.mjs";
import { PENDING_TRANSLATION } from "./literals.mjs";
import { applyTranslations, exportPending, selectExamples, validateResponse } from "./translate.mjs";

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
});

describe("translate: style examples", () => {
    const en = { a: { save: "Save", other: "Other" }, b: { z: "Close", y: "Back", pend: "Next", same: "LiTT", long: "x".repeat(80) }, c: { k: "Open" } };
    const es = { a: { save: `${P}Save`, other: "Otra" }, b: { z: "Cerrar", y: "Atrás", pend: `${P}Next`, same: "LiTT", long: "y".repeat(80) }, c: { k: "Abrir" } };
    const catalog = { en, es };
    const batch = [["a.save", "Save"]];


    it("takes only translated pairs: same root first, then short ones in key order, never pending or batch keys", () => {
        const picked = selectExamples(catalog, batch, 40);
        expect(picked.map(([k]) => k)).toEqual(["a.other", "b.y", "b.z", "c.k", "b.long"]);
        expect(selectExamples(catalog, batch, 2).map(([k]) => k)).toEqual(["a.other", "b.y"]);
        expect(selectExamples(catalog, batch, 40)).toEqual(picked); // deterministic
    });
});

describe("translate: --export and --apply", () => {
    const dirs = [];
    afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

    /** A temporary repo with a catalog of the entries above, plus one translated message. */
    function setup() {
        const repo = mkdtempSync(join(tmpdir(), "translate-test-"));
        dirs.push(repo);
        mkdirSync(join(repo, "packages/i18n/messages"), { recursive: true });
        const tree = (f, done) => ({ a: { ...Object.fromEntries(entries.map(([k, v]) => [k.slice(2), f(v)])) }, b: { close: done } });
        writeFileSync(join(repo, CATALOGS.en), serializeCatalog(tree((v) => v, "Close")));
        writeFileSync(join(repo, CATALOGS.es), serializeCatalog(tree((v) => `${P}${v}`, "Cerrar")));
        const read = () => readFileSync(join(repo, CATALOGS.es), "utf8");
        const es = () => JSON.parse(read());
        const exported = () => JSON.parse(readFileSync(join(repo, "out.json"), "utf8"));
        const send = (translations, options = {}) => {
            writeFileSync(join(repo, "in.json"), JSON.stringify(translations));
            const lines = [];
            const result = applyTranslations({ repo, file: join(repo, "in.json"), out: (s) => lines.push(s), ...options });
            handle.text = lines.join("");
            return result;
        };
        const handle = { repo, read, es, exported, send, text: "" };
        return handle;
    }

    it("--export writes only the pending keys, and examples that are already translated", () => {
        const t = setup();
        const result = exportPending({ repo: t.repo, file: join(t.repo, "out.json"), out: () => {}, now: () => new Date("2026-11-11T12:00:00Z") });
        expect(result).toEqual({ count: 4, exitCode: 0 });
        const file = t.exported();
        expect(file).toMatchObject({ generated_at: "2026-11-11T12:00:00.000Z", glossary: "packages/i18n/GLOSSARY.md", rules: "docs/i18n.md#spanish" });
        expect(file.pending).toEqual(Object.fromEntries(entries));
        expect(file.examples).toEqual([{ en: "Close", es: "Cerrar" }]);
        expect(JSON.stringify(file)).not.toContain("por traducir");
    });

    it("--export says so and writes nothing when nothing is pending", () => {
        const t = setup();
        t.send(good);
        const lines = [];
        const result = exportPending({ repo: t.repo, file: join(t.repo, "out.json"), out: (s) => lines.push(s) });
        expect(result).toEqual({ count: 0, exitCode: 0 });
        expect(lines.join("")).toMatch(/nothing to translate/);
        expect(() => readFileSync(join(t.repo, "out.json"))).toThrow();
    });

    it("--apply saves a valid translation, in the catalog's own format, and exits 0", () => {
        const t = setup();
        const before = t.read();
        const result = t.send(good, { receipt: "receipt.log" });
        expect(result).toMatchObject({ rejected: [], pending: [], exitCode: 0 });
        expect(t.es().a).toEqual({ files: good["a.files"], hello: good["a.hello"], save: good["a.save"], terms: good["a.terms"] });
        expect(t.read()).toBe(serializeCatalog(JSON.parse(t.read())));
        expect(t.read().split("\n").length).toBe(before.split("\n").length);
        const receipt = readFileSync(join(t.repo, "receipt.log"), "utf8");
        expect(receipt).toMatch(/accepted=4 rejected=0 pending=0/);
        expect(receipt).not.toContain("Guardar");
    });

    it.each([
        ["a missing argument", "a.hello", "Hola"],
        ["a different plural", "a.files", "{count, plural, other {# archivos}}"],
        ["a lost tag", "a.terms", "Lee los términos"],
        ["the pending mark", "a.save", `${P}Save`],
    ])("--apply rejects %s, saves nothing for it and exits 1", (_, key, value) => {
        const t = setup();
        const before = t.read();
        const result = t.send({ [key]: value });
        expect(result.rejected).toEqual([key]);
        expect(result.exitCode).toBe(1);
        expect(t.read()).toBe(before);
        expect(t.text).toMatch(new RegExp(`rejected ${key.replace(".", "\\.")}:`));
    });

    it("--apply rejects an extra key and a key that was not pending, saves the valid rest, and exits 1", () => {
        const t = setup();
        const result = t.send({ ...good, "a.other": "Otro", "b.close": "Cerrar ya" });
        expect(result.rejected.sort()).toEqual(["a.other", "b.close"]);
        expect(result.exitCode).toBe(1);
        expect(t.es().a.save).toBe("Guardar");
        expect(t.es().a.other).toBeUndefined();
        expect(t.es().b.close).toBe("Cerrar"); // untouched
        expect(t.text).toMatch(/rejected b\.close: not pending/);
    });

    it("--apply lists the pending keys the file did not carry and exits 1", () => {
        const t = setup();
        const result = t.send({ "a.save": "Guardar" });
        expect(result).toMatchObject({ accepted: ["a.save"], rejected: [], pending: ["a.files", "a.hello", "a.terms"], exitCode: 1 });
        expect(t.text).toMatch(/still pending a\.hello/);
        expect(t.es().a.hello).toBe(`${P}Hello, {name}`);
        // A second pass with the rest finishes the job.
        expect(t.send({ "a.hello": good["a.hello"], "a.files": good["a.files"], "a.terms": good["a.terms"] }).exitCode).toBe(0);
    });

    it("--apply refuses a file that is not a flat object", () => {
        const t = setup();
        writeFileSync(join(t.repo, "in.json"), "[1]");
        expect(() => applyTranslations({ repo: t.repo, file: join(t.repo, "in.json"), out: () => {} })).toThrow(/flat JSON object/);
    });
});
