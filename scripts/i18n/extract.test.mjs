// @vitest-environment node
// The extraction codemod (scripts/i18n/extract.mjs). Runs in the frontend's
// Vitest, beside the literal guard it shares its detection with.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE, CATALOGS, dynamicUses, extractSource, run } from "./extract.mjs";
import { PENDING_TRANSLATION, parseSource, visibleLiterals } from "./literals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(HERE, "__fixtures__", name), "utf8");
const FILE = "frontend/src/app/components/demo/Demo.tsx";

const extract = (source, { catalog = { en: {}, es: {} }, fileName = FILE, namespace = "demo.files" } = {}) => ({
    catalog,
    ...extractSource({ fileName, source, namespace, catalog }),
});

describe("extract: one file", () => {
    it("moves JSX text, visible attributes, calls, keys, interpolation and plurals to t()", () => {
        const { source, catalog, skipped } = extract(fixture("Demo.tsx"));
        expect(source).toBe(fixture("Demo.expected.tsx"));
        expect(catalog.en).toEqual({
            demo: {
                files: {
                    countMattersSelected: "{count, plural, one {# matter selected} other {# matters selected}}",
                    dontLoseYourWork: "Don't lose your work",
                    files: "Files",
                    filesSharedInThisMatter: "Files shared in this matter",
                    matterFiles: "Matter files",
                    nothingHereYet: "Nothing here yet",
                    readyToGo: "Ready to go",
                    renameName: "Rename {name}",
                    save: "Save",
                    savedYourChanges: "Saved your changes",
                    searchFiles: "Search files…",
                    welcomeBackNameYouHaveCount:
                        "{count, plural, one {Welcome back, {name}. You have # file.} other {Welcome back, {name}. You have # files.}}",
                },
            },
        });
        // es-MX gets every key, marked so the catalog test fails until translated.
        for (const [key, en] of Object.entries(catalog.en.demo.files))
            expect(catalog.es.demo.files[key]).toBe(PENDING_TRANSLATION + en);
        // What it could not move is what the guard still counts.
        expect(skipped).toEqual([{ line: 7, text: "All files", reason: "outside a component or hook" }]);
        expect(visibleLiterals(FILE, source)).toEqual(["All files"]);
    });

    it("is idempotent: a second run changes nothing", () => {
        const first = extract(fixture("Demo.tsx"));
        const catalogBefore = structuredClone(first.catalog);
        const second = extract(first.source, { catalog: first.catalog });
        expect(second.source).toBe(first.source);
        expect(second.added).toEqual([]);
        expect(second.catalog).toEqual(catalogBefore);
    });

    it("reuses the key of the same English text and names a different text apart", () => {
        const catalog = { en: { demo: { save: "Save", saveNow: "Save" } }, es: { demo: { save: "Guardar", saveNow: "Guardar" } } };
        const { source, added } = extract(
            `export function A() { return <div><b>Save</b><i>Save now</i></div>; }`,
            { catalog, namespace: "demo" },
        );
        expect(source).toContain(`<b>{t("demo.save")}</b>`);
        expect(source).toContain(`<i>{t("demo.saveNow2")}</i>`);
        expect(added).toEqual([{ key: "demo.saveNow2", message: "Save now" }]);
        expect(catalog.es.demo.save).toBe("Guardar"); // a translation is never overwritten
    });

    it("--from es-MX keeps Spanish source text in es-MX and marks en-US", () => {
        const catalog = { en: {}, es: {} };
        const { source } = extractSource({
            fileName: FILE,
            source: `export function A() { return <h2>Mi formación</h2>; }`,
            namespace: "training",
            catalog,
            from: "es-MX",
        });
        expect(source).toContain(`<h2>{t("training.miFormacion")}</h2>`);
        expect(catalog).toEqual({
            en: { training: { miFormacion: `${PENDING_TRANSLATION}Mi formación` } },
            es: { training: { miFormacion: "Mi formación" } },
        });
    });

    it("declares t once per component, reusing a bare translator and the existing import", () => {
        const source = [
            `import { useLocale, useTranslations } from "next-intl";`,
            `export function A() {`,
            `    const t = useTranslations();`,
            `    return <p>Already here</p>;`,
            `}`,
        ].join("\n");
        const out = extract(source).source;
        expect(out.match(/useTranslations\(\)/g)).toHaveLength(1);
        expect(out).toContain(`import { useLocale, useTranslations } from "next-intl";`);

        const added = extract(`import { useLocale } from "next-intl";\nexport function B() { return <p>New text</p>; }`).source;
        expect(added).toContain(`import { useLocale, useTranslations } from "next-intl";`);
    });

    it("uses getTranslations in an async server component and use-intl outside the web app", () => {
        const server = extract(`export default async function Page() {\n    return <h1>Matters</h1>;\n}`).source;
        expect(server).toContain(`import { getTranslations } from "next-intl/server";`);
        expect(server).toContain(`const t = await getTranslations();`);

        const word = extract(`export function Pane() {\n    return <h1>Matters</h1>;\n}`, {
            fileName: "word-addin/src/taskpane/Pane.tsx",
        }).source;
        expect(word).toContain(`import { useTranslations } from "use-intl";`);
    });

    it("leaves, and lists, what it cannot move safely", () => {
        const source = [
            `export function A({ t }: { t: (k: string) => string }) { return <p>Bound already</p>; }`,
            `export function B() { const t = useTranslations("other"); return <p>Namespaced already</p>; }`,
            `export function C() { return <ul>{[1].map((t) => <li key={t}>Shadowed text</li>)}</ul>; }`,
            `export function D() { return <p>Unknown &bogus; entity</p>; }`,
            `export function E({ a, b }: { a: number; b: number }) { return <p>{a} {a === 1 ? "x" : "y"} and {b} {b === 1 ? "z" : "w"} in total</p>; }`,
            `export function F() { return <p title={"Uses {braces} here"} />; }`,
            `export function G({ when }: { when: Date }) { return <p>{\`Updated \${when.toISOString()} ago\`}</p>; }`,
            `class H { render() { return <p>Class component</p>; } }`,
        ].join("\n");
        const { source: out, skipped } = extract(source);
        expect(out).toBe(source);
        expect(skipped.map((s) => s.reason)).toEqual([
            "`t` already means something else here",
            "`t` already means something else here",
            "a function in between rebinds `t`",
            "unknown HTML entity &bogus;",
            "more than one plural in one message",
            "text with {, } or <",
            "cannot name ${when.toISOString()}",
            "outside a component or hook",
        ]);
    });
});

describe("extract: dynamic uses", () => {
    it("lists t, t.rich, t.markup and useTranslations calls whose argument is not a literal, with what is known of the key", () => {
        const uses = dynamicUses(parseSource(FILE, fixture("Dynamic.tsx")));
        expect(uses.map(({ line, callee, arg, prefix }) => ({ line, callee, arg, prefix }))).toEqual([
            { line: 5, callee: "useTranslations", arg: "ns", prefix: "" },
            { line: 9, callee: "t", arg: "`status.${status}`", prefix: "status." },
            { line: 10, callee: "t", arg: "KEY", prefix: "" },
            { line: 11, callee: "t.rich", arg: '"rich." + status', prefix: "rich." },
            { line: 12, callee: "t.markup", arg: "status", prefix: "" },
        ]);
    });

    it("does not list literal arguments, no-argument calls or getTranslations options", () => {
        const source = [
            `export async function A() {`,
            `    const t = await getTranslations();`,
            `    const u = await getTranslations({ locale: "en-US", namespace: "a" });`,
            `    const v = useTranslations("a.b");`,
            "    return [t(\"a.b\"), t(`a.c`), v(\"c\")];",
            `}`,
        ].join("\n");
        expect(dynamicUses(parseSource(FILE, source))).toEqual([]);
    });
});

describe("extract: run over the repository", () => {
    let repo;
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    const setUp = () => {
        repo = mkdtempSync(join(tmpdir(), "i18n-extract-test-"));
        for (const file of [CATALOGS.en, CATALOGS.es, BASELINE]) mkdirSync(dirname(join(repo, file)), { recursive: true });
        writeFileSync(join(repo, CATALOGS.en), `{ "common": { "save": "Save" } }\n`);
        writeFileSync(join(repo, CATALOGS.es), `{ "common": { "save": "Guardar" } }\n`);
        writeFileSync(join(repo, BASELINE), `${JSON.stringify({ migrated: ["frontend/src/i18n"], allowed: {} }, null, 2)}\n`);
        mkdirSync(join(repo, "frontend/src/i18n"), { recursive: true });
        mkdirSync(dirname(join(repo, FILE)), { recursive: true });
        cpSync(join(HERE, "__fixtures__", "Demo.tsx"), join(repo, FILE));
    };
    const snapshot = () =>
        Object.fromEntries([FILE, CATALOGS.en, CATALOGS.es, BASELINE].map((f) => [f, readFileSync(join(repo, f), "utf8")]));
    const quiet = { out: () => {} };

    it("a dry run prints the diff and writes nothing", () => {
        setUp();
        const before = snapshot();
        const report = run({ repo, namespace: "demo.files", paths: [FILE], ...quiet });
        expect(snapshot()).toEqual(before);
        expect(report).toContain(`+++ b/${FILE}`);
        expect(report).toContain(`+            <h2 title={t("demo.files.filesSharedInThisMatter")}>{t("demo.files.files")}</h2>`);
        expect(report).toContain(`+ demo.files.save: "Save"`);
        expect(report).toContain(`left ${FILE}:7 "All files": outside a component or hook`);
        expect(report).toContain("(dry run: nothing written; add --write)");
    });

    it("--write updates the file, both catalogs and the baseline; a second run changes nothing", () => {
        setUp();
        run({ repo, namespace: "demo.files", paths: [FILE], write: true, ...quiet });
        const after = snapshot();
        expect(after[FILE]).toBe(fixture("Demo.expected.tsx"));
        const en = JSON.parse(after[CATALOGS.en]);
        const es = JSON.parse(after[CATALOGS.es]);
        expect(Object.keys(en)).toEqual(["common", "demo"]); // sorted
        expect(en.common.save).toBe("Save");
        expect(es.common.save).toBe("Guardar");
        expect(es.demo.files.save).toBe(`${PENDING_TRANSLATION}Save`);
        expect(JSON.parse(after[BASELINE])).toEqual({
            migrated: [FILE, "frontend/src/i18n"],
            allowed: { [FILE]: 1 },
        });

        const report = run({ repo, namespace: "demo.files", paths: [FILE], write: true, ...quiet });
        expect(snapshot()).toEqual(after);
        expect(report).not.toContain("+++");
    });

    it("--prune drops the namespace's keys no source names, and keeps namespaced uses", () => {
        setUp();
        run({ repo, namespace: "demo.files", paths: [FILE], write: true, ...quiet });
        // Upstream rewrites a heading that was already extracted; the
        // recipe takes upstream's line and runs the codemod again.
        const file = join(repo, FILE);
        writeFileSync(
            file,
            readFileSync(file, "utf8")
                .replace(`{t("demo.files.files")}`, "Shared files")
                .replace(`{open ? t("demo.files.readyToGo") : null}`, "{open ? null : null}"),
        );
        writeFileSync(
            join(repo, "frontend/src/i18n/Other.tsx"),
            `export function O() { const t = useTranslations("demo.files"); return <p>{t("readyToGo")}</p>; }\n`,
        );
        const report = run({ repo, namespace: "demo.files", paths: [FILE], write: true, prune: true, ...quiet });
        expect(report).toContain(`+ demo.files.sharedFiles: "Shared files"`);
        expect(report).toContain("- demo.files.files (no source uses it)");
        const en = JSON.parse(readFileSync(join(repo, CATALOGS.en), "utf8"));
        const es = JSON.parse(readFileSync(join(repo, CATALOGS.es), "utf8"));
        expect(en.demo.files.files).toBeUndefined();
        expect(es.demo.files.files).toBeUndefined();
        expect(en.demo.files.sharedFiles).toBe("Shared files");
        expect(es.demo.files.sharedFiles).toBe(`${PENDING_TRANSLATION}Shared files`);
        // Only Other.tsx uses it now, as t("readyToGo") under useTranslations("demo.files").
        expect(en.demo.files.readyToGo).toBe("Ready to go");
    });

    describe("--prune and dynamic keys", () => {
        const dynamicSetUp = () => {
            setUp();
            run({ repo, namespace: "demo.files", paths: [FILE], write: true, ...quiet });
            // A key nobody names, and a component that builds keys at run time.
            const en = JSON.parse(readFileSync(join(repo, CATALOGS.en), "utf8"));
            en.demo.files.orphan = "Orphan";
            en.demo.files.status = { open: "Open", closed: "Closed" };
            en.demo.other = { x: "X" };
            writeFileSync(join(repo, CATALOGS.en), JSON.stringify(en));
            const es = JSON.parse(readFileSync(join(repo, CATALOGS.es), "utf8"));
            es.demo.files.orphan = "Huérfano";
            es.demo.files.status = { open: "Abierto", closed: "Cerrado" };
            es.demo.other = { x: "X" };
            writeFileSync(join(repo, CATALOGS.es), JSON.stringify(es));
            writeFileSync(
                join(repo, "frontend/src/i18n/Dyn.tsx"),
                "export function D({ s }: { s: string }) { const t = useTranslations(); return <p>{t(`demo.files.status.${s}`)}</p>; }\n",
            );
        };
        const keysOf = () => JSON.parse(readFileSync(join(repo, CATALOGS.en), "utf8")).demo;

        it("warns with file:line for each dynamic call while extracting", () => {
            setUp();
            const dyn = join(repo, "frontend/src/i18n/Dyn.tsx");
            writeFileSync(dyn, "export function D({ k }: { k: string }) {\n    const t = useTranslations();\n    return <p>{t(k)}</p>;\n}\n");
            const warnings = [];
            run({ repo, namespace: "demo", paths: ["frontend/src/i18n/Dyn.tsx"], ...quiet, warn: (w) => warnings.push(w) });
            expect(warnings).toEqual([
                "warning: frontend/src/i18n/Dyn.tsx:3 t(k) is not a literal: --prune cannot see which keys it uses\n",
            ]);
        });

        it("refuses to prune, changes nothing and says why, even in a dry run", () => {
            dynamicSetUp();
            const before = snapshot();
            const warnings = [];
            const prune = (extra = {}) => run({ repo, namespace: "demo.files", prune: true, ...quiet, warn: (w) => warnings.push(w), ...extra });
            expect(() => prune()).toThrow(/--prune refused: 1 call\(s\).*--allow-dynamic/);
            expect(() => prune({ write: true })).toThrow(/--prune refused/);
            expect(warnings.join("")).toContain("frontend/src/i18n/Dyn.tsx:1 t(`demo.files.status.${s}`) is not a literal");
            expect(snapshot()).toEqual({ ...before });
            expect(keysOf().files.orphan).toBe("Orphan");
        });

        it("--allow-dynamic prunes, but keeps every key a dynamic use may reach", () => {
            dynamicSetUp();
            const report = run({ repo, namespace: "demo.files", prune: true, allowDynamic: true, write: true, ...quiet, warn: () => {} });
            expect(report).toContain("- demo.files.orphan (no source uses it)");
            expect(keysOf().files.orphan).toBeUndefined();
            expect(keysOf().files.status).toEqual({ open: "Open", closed: "Closed" }); // reachable: kept
            expect(keysOf().other).toEqual({ x: "X" }); // another namespace: not pruned
            const es = JSON.parse(readFileSync(join(repo, CATALOGS.es), "utf8"));
            expect(es.demo.files.orphan).toBeUndefined();
            expect(es.demo.files.status.open).toBe("Abierto");
        });

        it("keeps the whole namespace when a dynamic use gives no prefix", () => {
            dynamicSetUp();
            writeFileSync(
                join(repo, "frontend/src/i18n/Dyn.tsx"),
                "export function D({ k }: { k: string }) { const t = useTranslations(); return <p>{t(k)}</p>; }\n",
            );
            const report = run({ repo, namespace: "demo.files", prune: true, allowDynamic: true, write: true, ...quiet, warn: () => {} });
            expect(report).not.toContain("- demo.files");
            expect(keysOf().files.orphan).toBe("Orphan");
        });

        it("a namespaced translator with a variable namespace also blocks pruning", () => {
            dynamicSetUp();
            writeFileSync(
                join(repo, "frontend/src/i18n/Dyn.tsx"),
                "export function D({ ns }: { ns: string }) { const t = useTranslations(ns); return <p>{t(\"x\")}</p>; }\n",
            );
            expect(() => run({ repo, namespace: "demo.files", prune: true, ...quiet, warn: () => {} })).toThrow(/--prune refused/);
        });
    });

    it("rejects a missing or malformed namespace, and an unknown source locale", () => {
        setUp();
        expect(() => run({ repo, namespace: "", paths: [FILE], ...quiet })).toThrow(/--ns/);
        expect(() => run({ repo, namespace: "Demo-Files", paths: [FILE], ...quiet })).toThrow(/--ns/);
        expect(() => run({ repo, namespace: "demo", from: "fr-FR", paths: [FILE], ...quiet })).toThrow(/--from/);
    });
});
