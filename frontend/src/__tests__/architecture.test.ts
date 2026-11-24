// Architecture fitness test — the frontend's build-boundary rules, executable.
//
// The production image is built from a Docker context that holds the frontend
// plus an explicit allowlist of sibling directories (see `frontend/Dockerfile`).
// A file that `next build` type-checks and that reaches outside that allowlist
// compiles on a developer machine and in the host-side CI build, where every
// sibling directory exists, and fails only inside `docker compose up --build`
// on a fresh install. That happened three times (24dc0f97 for backend/src,
// #457 for word-addin/src, #501 for packages/pdf-text-order) before this test
// existed, because nothing tied the Dockerfile's allowlist to the import graph.
//
// The rules:
//
//   1. Every relative import in the production build program
//      (`tsconfig.build.json`, the config `next build` uses) resolves to a
//      file that is in the image: inside `frontend/`, or inside the same
//      Dockerfile-copied directory as the importing file (the shared
//      packages under `packages/` import their own files relatively).
//   2. Production code reaches outside `frontend/` only through a `paths`
//      alias, and every alias target outside `frontend/` must be copied by
//      the Dockerfile to exactly the path the alias resolves to in the image.
//   3. The build program excludes test-only files and nothing else. Every
//      other file tsconfig.json sees must still be in the build, so an
//      exclude pattern cannot quietly drop production code from type-checking.
//   4. No `paths` alias targets a declaration file unless every import of it
//      is type-only. Turbopack resolves runtime imports through these aliases
//      too, and a `.d.ts` has no runtime exports: a `react/jsx-runtime` alias
//      to @types once compiled every JSX call to `(void 0)(...)`, and the
//      built app rendered only its error page with no build error.
//   5. The shared packages keep the boundary their READMEs state: a package's
//      relative imports stay inside it; `@mike/client` is framework-free and
//      never imports `@mike/ui` or an application; `@mike/ui` imports only
//      `@mike/client` and its declared peer dependencies; `@litt/i18n`
//      imports only its declared peers (none today); and application
//      code reaches a package only through its bare name, never a file path,
//      so a file `index.ts` does not re-export stays internal.
//
//   6. Markdown from a model or another person never loads an image from another
//      site on its own. The renderer's `components` table always passes through
//      `withSafeMarkdownImages` (from `@mike/ui`), which applies the image rule
//      last, so a table cannot replace it: every `react-markdown` element in
//      production code (frontend, add-in, shared packages) must pass one.
//
// Test files may import shared fixtures and add-in sources from outside
// `frontend/`; rule 3 is what keeps them out of the image. No CI workflow
// builds the images: the faithful check is building the real image from the
// repository root (`docker build -f frontend/Dockerfile .`) at the deployment
// gate. This test is the fast check that runs on every change and names the
// offending import.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { RULE_PROBES } from "./support/markdownRuleProbes";

const FRONTEND = resolve(__dirname, "../..");
const REPO = resolve(FRONTEND, "..");

const toPosix = (p: string) => p.split(sep).join("/");
const relToFrontend = (file: string) => toPosix(relative(FRONTEND, file));

function isInside(dir: string, file: string): boolean {
    const rel = relative(dir, file);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function loadProgram(configName: string): ts.ParsedCommandLine {
    const configPath = join(FRONTEND, configName);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error, `${configName} must parse`).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, FRONTEND);
    expect(parsed.fileNames.length, `${configName} must include files`).toBeGreaterThan(0);
    return parsed;
}

const IMPORT_RE =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importSpecifiers(file: string): string[] {
    const source = readFileSync(file, "utf8");
    const out: string[] = [];
    for (const match of source.matchAll(IMPORT_RE)) {
        out.push(match[1] ?? match[2]);
    }
    return out;
}

const isTestOnly = (rel: string) =>
    /\.(test|spec)\.tsx?$/.test(rel) ||
    /(^|\/)__tests__\//.test(rel) ||
    rel === "vitest.config.mts" ||
    rel === "vitest.setup.ts";

// The Dockerfile, reduced to what matters here: where the frontend lands in
// the image and which repository paths are copied where.
function readDockerfile() {
    const lines = readFileSync(join(FRONTEND, "Dockerfile"), "utf8").split("\n");
    let workdir = "/";
    const copies: { src: string; dst: string }[] = [];
    for (const raw of lines) {
        const line = raw.trim();
        const wd = /^WORKDIR\s+(\S+)/.exec(line);
        if (wd) {
            workdir = posix.resolve(workdir, wd[1]);
            continue;
        }
        const cp = /^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/.exec(line);
        if (cp) {
            copies.push({
                src: posix.normalize(cp[1]).replace(/\/$/, ""),
                dst: posix.resolve(workdir, cp[2]),
            });
        }
    }
    const app = copies.find((c) => c.src === "frontend");
    expect(app, "Dockerfile must COPY frontend/ into the image").toBeDefined();
    return { app: app!.dst, copies: copies.filter((c) => !c.src.includes("*")) };
}

describe("frontend build boundaries", () => {
    const build = loadProgram("tsconfig.build.json");
    const full = loadProgram("tsconfig.json");

    it("rule 1: every relative import in the production build program stays inside the image", () => {
        // A directory the Dockerfile copies whole keeps its internal layout, so
        // a relative import between two files under the same copied directory
        // resolves in the image too.
        const copiedDirs = readDockerfile()
            .copies.map((c) => resolve(REPO, c.src))
            .filter((dir) => !isInside(FRONTEND, dir));
        const sameCopiedDir = (file: string, target: string) =>
            copiedDirs.some((dir) => isInside(dir, file) && isInside(dir, target));
        const violations: string[] = [];
        for (const file of build.fileNames) {
            for (const spec of importSpecifiers(file)) {
                if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
                const target = resolve(dirname(file), spec);
                if (!isInside(FRONTEND, target) && !sameCopiedDir(file, target)) {
                    violations.push(`${relToFrontend(file)} -> ${spec}`);
                }
            }
        }
        expect(
            violations,
            "A file `next build` type-checks reaches outside frontend/ and outside " +
                "the directory the Dockerfile copies it from. The Docker image is " +
                "built from an allowlisted context and will not contain the target. " +
                "Import it through a tsconfig `paths` alias whose target the " +
                "Dockerfile copies, or, if it is a test, name it so " +
                "tsconfig.build.json excludes it.",
        ).toEqual([]);
    });

    it("rule 2: every tsconfig alias that leaves frontend/ is copied to the same path in the image", () => {
        const { app, copies } = readDockerfile();
        const paths = build.options.paths ?? {};
        const base = build.options.baseUrl ?? FRONTEND;
        const missing: string[] = [];
        for (const [alias, targets] of Object.entries(paths)) {
            for (const target of targets) {
                const abs = resolve(base, target);
                if (isInside(FRONTEND, abs)) continue;
                const repoRel = toPosix(relative(REPO, abs));
                const imagePath = posix.join(app, toPosix(relative(FRONTEND, abs)));
                const covered = copies.some(
                    (c) =>
                        (repoRel === c.src || repoRel.startsWith(`${c.src}/`)) &&
                        posix.join(c.dst, repoRel.slice(c.src.length)) === imagePath,
                );
                if (!covered) missing.push(`${alias} -> ${target} (expected ${imagePath} in the image)`);
            }
        }
        expect(
            missing,
            "A tsconfig `paths` alias points outside frontend/ but frontend/Dockerfile " +
                "does not COPY its target to the path the alias resolves to under the " +
                "image's WORKDIR.",
        ).toEqual([]);
    });

    it("rule 3: the build program excludes test-only files and nothing else", () => {
        const inBuild = new Set(build.fileNames);
        const dropped = full.fileNames
            .filter((f) => !inBuild.has(f))
            .map(relToFrontend)
            .filter((rel) => !isTestOnly(rel));
        expect(
            dropped,
            "tsconfig.build.json excludes a file that is not test-only, so `next build` " +
                "no longer type-checks it.",
        ).toEqual([]);

        const testsInBuild = build.fileNames.map(relToFrontend).filter(isTestOnly);
        expect(testsInBuild, "tsconfig.build.json must exclude every test-only file").toEqual([]);
    });

    it("rule 4: no tsconfig alias a runtime import can reach targets a declaration file", () => {
        // @mike/contracts is declarations only and is imported with `import type`
        // (AGENTS.md), which the bundler erases before resolving anything.
        const TYPE_ONLY_ALIASES = new Set(["@mike/contracts"]);
        const paths = build.options.paths ?? {};
        const declarationTargets = Object.entries(paths)
            .filter(([alias]) => !TYPE_ONLY_ALIASES.has(alias))
            .flatMap(([alias, targets]) =>
                targets.filter((t) => /\.d\.[cm]?ts$/.test(t)).map((t) => `${alias} -> ${t}`),
            );
        expect(
            declarationTargets,
            "A tsconfig `paths` alias maps a module to a declaration file. Turbopack " +
                "applies these aliases to runtime imports, so the bundle gets a module " +
                "with no exports. Point it at the runtime package (types come from " +
                "`typeRoots`), or drop it.",
        ).toEqual([]);
    });

    it("rule 5: the shared packages keep their stated import boundary", () => {
        const PACKAGES = resolve(REPO, "packages");
        const WORD_ADDIN = resolve(REPO, "word-addin");
        const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { peerDependencies?: Record<string, string> };
        // What each package may import by bare name: its declared peers (the
        // consuming app supplies them) plus Node built-ins; `@mike/client` may
        // reach React for types only.
        const allowed: Record<string, Set<string>> = {
            client: new Set(Object.keys(readJson(join(PACKAGES, "client/package.json")).peerDependencies ?? {})),
            ui: new Set(Object.keys(readJson(join(PACKAGES, "ui/package.json")).peerDependencies ?? {})),
            i18n: new Set(Object.keys(readJson(join(PACKAGES, "i18n/package.json")).peerDependencies ?? {})),
        };
        const NAMES: Record<string, string> = { client: "@mike/client", ui: "@mike/ui", i18n: "@litt/i18n" };
        allowed.client.add("react");
        const bareName = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
        const violations: string[] = [];
        for (const file of full.fileNames) {
            const rel = toPosix(relative(REPO, file));
            if (isTestOnly(relToFrontend(file)) || /\.stories\.tsx?$/.test(rel)) continue;
            const pkg = /^packages\/(ui|client|i18n)\//.exec(rel)?.[1];
            const source = readFileSync(file, "utf8");
            for (const spec of importSpecifiers(file)) {
                if (pkg) {
                    if (spec.startsWith(".")) {
                        if (!isInside(join(PACKAGES, pkg), resolve(dirname(file), spec)))
                            violations.push(`${rel} -> ${spec} (leaves packages/${pkg})`);
                        continue;
                    }
                    if (spec.startsWith("node:")) continue;
                    const name = bareName(spec);
                    if (name === NAMES[pkg])
                        violations.push(`${rel} -> ${spec} (a package does not import its own barrel)`);
                    else if (name === "@mike/ui" && pkg === "client")
                        violations.push(`${rel} -> ${spec} (@mike/client never imports @mike/ui)`);
                    else if (!allowed[pkg].has(name))
                        violations.push(`${rel} -> ${spec} (not a declared peer dependency of ${NAMES[pkg]})`);
                    else if (pkg === "client" && name === "react" && !new RegExp(`import\\s+type\\s[^;]*from\\s+["']${spec}["']`).test(source))
                        violations.push(`${rel} -> ${spec} (@mike/client is framework-free: React for types only)`);
                } else {
                    // Application code: packages by bare name only.
                    const target = spec.startsWith(".") ? resolve(dirname(file), spec) : null;
                    if (/^(@mike\/(ui|client)|@litt\/i18n)\//.test(spec) || (target && isInside(PACKAGES, target) && !isInside(WORD_ADDIN, target)))
                        violations.push(`${rel} -> ${spec} (import @mike/ui, @mike/client or @litt/i18n by name, not a file inside it)`);
                }
            }
        }
        expect(
            violations,
            "packages/ui/README.md, packages/client/README.md and packages/i18n/README.md state these rules; " +
                "an import crossed the boundary they describe.",
        ).toEqual([]);
    });
});

// Rule 6: Markdown from a model or another person never loads an image from
// another site on its own.
//
// What it guarantees. `unsafeMarkdownUses` reads the syntax tree of each
// production file (frontend/src, word-addin/src and packages/, any script
// extension) and fails when:
//   - a `react-markdown` element does not pass `components` through
//     `withSafeMarkdownImages` imported from `@mike/ui`, has more than one
//     `components` attribute, has a spread attribute, or the function name is
//     declared again in the file;
//   - a plugin, option or URL transform is set that is not listed below: a
//     plugin must be an inline array of names that the file imports from the
//     expected package (or file), and the whole list must match this file's
//     entry exactly;
//   - a file imports another library that turns Markdown or HTML text into
//     elements and the test has not listed that file, that library and a
//     reason. The set of such libraries is every installed package whose name
//     is in a Markdown/HTML family (see MARKDOWN_FAMILY) plus a fixed seed.
// A change that adds a renderer without the shared rule, a plugin or option
// nobody listed, or a rendering library nobody listed, fails here.
//
// What it does NOT stop: code written to get around it (a computed module name,
// a renamed `require`), `dangerouslySetInnerHTML`, a caller's own renderer for
// an element other than `img` that draws an image, and files outside the
// scanned folders. The body of a listed plugin is not read. The review of a
// change is what covers those.
const MARKDOWN_TYPE_ONLY = new Set(["Components", "Options", "ExtraProps", "UrlTransform", "AllowElement"]);

// Package-name families that turn Markdown or HTML text into elements, HTML or
// trees. Every installed package of the three applications matching one is
// forbidden in production code unless listed in ALLOWED_MARKDOWN_LIBRARIES.
const MARKDOWN_FAMILY =
    /^(react-markdown|remark(-.+)?|rehype(-.+)?|mdast(-.+)?|hast(-.+)?|hastscript|micromark(-.+)?|unified|marked|markdown-.+|prosemirror-markdown|parse5(-.+)?|htmlparser2|html-.+|jsdom|linkedom|cheerio|dompurify|isomorphic-dompurify|sanitize-html|katex|tiptap-markdown|showdown|snarkdown|turndown(-.+)?|mammoth|@tiptap\/html|@xmldom\/xmldom)$/;
// Named so the set can never be smaller than this, even where a package is not installed.
const MARKDOWN_SEED = [
    "marked", "markdown-it", "micromark", "unified", "remark-parse", "remark-rehype", "rehype-raw",
    "rehype-react", "hast-util-to-jsx-runtime", "markdown-to-jsx", "html-react-parser",
    "tiptap-markdown", "dompurify", "isomorphic-dompurify", "sanitize-html", "showdown", "snarkdown",
    "mdast-util-from-markdown", "mdast-util-to-hast", "hast-util-raw", "hast-util-from-html", "parse5", "katex",
];
function installedMarkdownLibraries(): Set<string> {
    const names = new Set(MARKDOWN_SEED);
    for (const app of ["frontend", "word-addin", "backend"]) {
        const dir = join(REPO, app, "node_modules");
        let entries: string[] = [];
        try {
            entries = readdirSync(dir);
        } catch {
            continue; // not installed here (the add-in's is absent on CI)
        }
        for (const entry of entries) {
            if (entry.startsWith("@")) {
                for (const inner of readdirSync(join(dir, entry))) if (MARKDOWN_FAMILY.test(`${entry}/${inner}`)) names.add(`${entry}/${inner}`);
            } else if (MARKDOWN_FAMILY.test(entry)) names.add(entry);
        }
    }
    names.delete("react-markdown"); // judged by the element rules, not by this list
    return names;
}
const MARKDOWN_LIBRARIES = installedMarkdownLibraries();

// The plugins production uses: the package (or repository file, without
// extension) each name must be imported from, and how.
const KNOWN_PLUGINS: Record<string, { from: string; exportName: string }> = {
    remarkGfm: { from: "remark-gfm", exportName: "default" },
    remarkMath: { from: "remark-math", exportName: "default" },
    rehypeKatex: { from: "rehype-katex", exportName: "default" },
    rehypeLegalAnchors: { from: "frontend/src/app/components/legal/legalAnchors", exportName: "rehypeLegalAnchors" },
};
const APP = "frontend/src/app/components";
// [file, prop, the list's entries as written]. `remarkPlugins={[remarkGfm]}` is
// allowed in every file; any other plugin list, option or transform needs an
// entry here, and no other prop can be listed.
const ALLOWED_MARKDOWN_PROPS: [string, "remarkPlugins" | "rehypePlugins", string[]][] = [
    [`${APP}/assistant/message/MarkdownContent.tsx`, "remarkPlugins", ["[remarkMath, { singleDollarTextMath: false }]", "remarkGfm"]],
    [`${APP}/assistant/message/MarkdownContent.tsx`, "rehypePlugins", ["rehypeKatex"]],
    [`${APP}/legal/LegalDocument.tsx`, "rehypePlugins", ["rehypeLegalAnchors"]],
];
const GFM_ONLY = ["remarkGfm"];
// Production files that render with react-markdown and the one plugin list they use.
const MARKDOWN_PLUGIN_FILES = [
    `${APP}/assistant/message/EventBlocks.tsx`,
    `${APP}/legal/LegalDocument.tsx`,
    `${APP}/legal/SignupLegal.tsx`,
    `${APP}/tabular/TRChatPanel.tsx`,
    `${APP}/tabular/TRSidePanel.tsx`,
    `${APP}/tabular/TabularCell.tsx`,
    `${APP}/workflows/WFColumnViewModal.tsx`,
    `${APP}/workflows/WorkflowAddonPreviewModal.tsx`,
    `${APP}/workflows/WorkflowPickerContent.tsx`,
    "word-addin/src/shared/chat/Markdown.tsx",
];
// [file, library, why this use cannot put a model's or another person's image on the page]
const ALLOWED_MARKDOWN_LIBRARIES: [string, string, string][] = [
    ["frontend/src/app/components/ui/markdown-editor.tsx", "marked", "parses two strings to compare them; the result is never inserted"],
    ["frontend/src/app/components/ui/markdown-editor.tsx", "tiptap-markdown", "editor configured with html:false, and the editor has no image node"],
    ["word-addin/src/taskpane/components/workflows/WorkflowPromptEditor.tsx", "tiptap-markdown", "editor configured with html:false, and the editor has no image node"],
    ["frontend/src/app/components/assistant/CaseView.tsx", "dompurify", "case-law HTML (not model text) sanitized with an allowlist that has no img, style or srcset"],
    [`${APP}/assistant/message/MarkdownContent.tsx`, "katex", "imports KaTeX's stylesheet only"],
    ...MARKDOWN_PLUGIN_FILES.map((file): [string, string, string] => [file, "remark-gfm", "listed plugin; its import is checked against ALLOWED_MARKDOWN_PROPS"]),
    [`${APP}/assistant/message/MarkdownContent.tsx`, "remark-gfm", "listed plugin; its import is checked against ALLOWED_MARKDOWN_PROPS"],
    [`${APP}/assistant/message/MarkdownContent.tsx`, "remark-math", "listed plugin (single-dollar math off); its import is checked against ALLOWED_MARKDOWN_PROPS"],
    [`${APP}/assistant/message/MarkdownContent.tsx`, "rehype-katex", "listed plugin; its import is checked against ALLOWED_MARKDOWN_PROPS"],
];
// Props that change what a Markdown element parses, passes through or draws.
const MARKDOWN_CONTROL_PROPS = new Set([
    "rehypePlugins", "remarkPlugins", "remarkRehypeOptions", "urlTransform", "allowElement",
    "allowedElements", "disallowedElements", "unwrapDisallowed", "skipHtml",
]);

const PRODUCTION_SOURCE = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
function productionSources(rels: string[]): string[] {
    return rels.filter(
        (rel) =>
            PRODUCTION_SOURCE.test(rel) &&
            !/\.(test|spec)\.[a-z]+$/.test(rel) &&
            !/(^|\/)__tests__\//.test(rel) &&
            !/\.stories\.[a-z]+$/.test(rel),
    );
}

/** The package a module specifier names, also when it is written as a path into node_modules. */
function packageOf(spec: string | undefined): string | undefined {
    if (spec === undefined) return undefined;
    const marker = spec.lastIndexOf("node_modules/");
    const rest = marker >= 0 ? spec.slice(marker + "node_modules/".length) : spec;
    if (marker < 0 && (rest.startsWith(".") || rest.startsWith("/") || rest.startsWith("@/") || rest.startsWith("node:"))) return undefined;
    const parts = rest.split("/");
    return rest.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** A specifier as the repository file it names (no extension) or the bare package. */
function resolvedSpecifier(fileName: string, spec: string): string {
    const noExt = (p: string) => p.replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/, "");
    if (spec.startsWith(".")) return noExt(posix.normalize(posix.join(posix.dirname(fileName), spec)));
    if (spec.startsWith("@/")) return noExt(`frontend/src/${spec.slice(2)}`);
    return spec;
}

/** Every name a file declares (variables, parameters, functions, classes, imports), with where. */
function declaredNames(sf: ts.SourceFile): Map<string, ts.Node[]> {
    const out = new Map<string, ts.Node[]>();
    const add = (name: ts.Node | undefined) => {
        if (!name) return;
        if (ts.isIdentifier(name)) out.set(name.text, [...(out.get(name.text) ?? []), name]);
        else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
            for (const el of name.elements) if (ts.isBindingElement(el)) add(el.name);
    };
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) || ts.isParameter(node)) add(node.name);
        else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isEnumDeclaration(node)) add(node.name);
        else if (ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) add(node.name);
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

function unsafeMarkdownUses(fileName: string, source: string): string[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const problems: string[] = [];
    const bindings = new Set<string>();
    const safeNames = new Set<string>();
    // local name -> how this file imported it
    const imported = new Map<string, { spec: string; exportName: string }>();
    const declared = declaredNames(sf);
    const at = (node: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const stringOf = (node: ts.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
    const isMarkdownModule = (spec: string | undefined) => packageOf(spec) === "react-markdown";
    const checkLibrary = (node: ts.Node, spec: string | undefined) => {
        const lib = packageOf(spec);
        if (lib && MARKDOWN_LIBRARIES.has(lib) && !ALLOWED_MARKDOWN_LIBRARIES.some(([file, name]) => file === fileName && name === lib))
            problems.push(
                `${at(node)} imports ${spec}, a library that turns Markdown or HTML text into elements. Render with ` +
                    "<ReactMarkdown components={withSafeMarkdownImages(...)}>, or add the file, the library and the reason " +
                    "to ALLOWED_MARKDOWN_LIBRARIES in frontend/src/__tests__/architecture.test.ts.",
            );
    };
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const spec = stringOf(node.moduleSpecifier);
            const named = clause?.namedBindings;
            const onlyTypes =
                !!clause && (clause.isTypeOnly || (!clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((el) => el.isTypeOnly)));
            if (!onlyTypes) checkLibrary(node, spec);
            if (clause && !clause.isTypeOnly && spec !== undefined) {
                if (clause.name) imported.set(clause.name.text, { spec, exportName: "default" });
                if (named && ts.isNamespaceImport(named)) imported.set(named.name.text, { spec, exportName: "*" });
                if (named && ts.isNamedImports(named))
                    for (const el of named.elements)
                        if (!el.isTypeOnly) imported.set(el.name.text, { spec, exportName: (el.propertyName ?? el.name).text });
            }
            if (spec === "@mike/ui" && named && ts.isNamedImports(named))
                for (const el of named.elements)
                    if (!el.isTypeOnly && (el.propertyName ?? el.name).text === "withSafeMarkdownImages") safeNames.add(el.name.text);
            if (isMarkdownModule(spec) && clause && !clause.isTypeOnly) {
                if (clause.name) bindings.add(clause.name.text);
                if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text);
                if (named && ts.isNamedImports(named))
                    for (const el of named.elements)
                        if (!el.isTypeOnly && !MARKDOWN_TYPE_ONLY.has((el.propertyName ?? el.name).text)) bindings.add(el.name.text);
            }
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const spec = stringOf(node.moduleReference.expression);
            if (!node.isTypeOnly) checkLibrary(node, spec);
            if (isMarkdownModule(spec) && !node.isTypeOnly) bindings.add(node.name.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
            const spec = stringOf(node.moduleSpecifier);
            if (isMarkdownModule(spec)) problems.push(`${at(node)} re-exports react-markdown`);
            checkLibrary(node, spec);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
            const spec = stringOf(node.arguments[0]);
            if (isMarkdownModule(spec)) problems.push(`${at(node)} loads react-markdown dynamically`);
            checkLibrary(node, spec);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    // A name imported as the shared function must not be declared a second time (a parameter or a local that shadows it).
    for (const name of safeNames) {
        const all = declared.get(name) ?? [];
        if (all.length > 1)
            problems.push(`${at(all[1])} declares ${name}, which this file also imports from "@mike/ui" as withSafeMarkdownImages. Use another name.`);
    }
    /** `node` is an inline plugin list whose names are the known plugins, imported from where they must be. */
    const pluginListProblem = (list: ts.Expression, accepted: string[][]): string | undefined => {
        if (!ts.isArrayLiteralExpression(list)) return "the list must be written inline as an array";
        const texts: string[] = [];
        for (const el of list.elements) {
            const head = ts.isArrayLiteralExpression(el) ? el.elements[0] : el;
            if (!head || !ts.isIdentifier(head)) return "every entry must be a plugin name, or [name, options]";
            const known = KNOWN_PLUGINS[head.text];
            if (!known) return `${head.text} is not a known plugin`;
            const how = imported.get(head.text);
            const where = how ? resolvedSpecifier(fileName, how.spec) : undefined;
            if (!how || where !== known.from || how.exportName !== known.exportName)
                return `${head.text} must be the ${known.exportName === "default" ? "default" : `named \`${known.exportName}\``} import from "${known.from}" in this file`;
            if ((declared.get(head.text) ?? []).length !== 1) return `${head.text} is declared more than once in this file`;
            texts.push(el.getText(sf).replace(/\s+/g, " "));
        }
        if (!accepted.some((expected) => texts.length === expected.length && texts.every((t, i) => t === expected[i])))
            return `the list [${texts.join(", ")}] is not the one listed for this file`;
        return undefined;
    };
    const walk = (node: ts.Node) => {
        if (ts.isJsxOpeningLikeElement(node) && bindings.has(node.tagName.getText(sf))) {
            const tag = node.tagName.getText(sf);
            const seen = new Map<string, number>();
            for (const prop of node.attributes.properties) {
                if (ts.isJsxSpreadAttribute(prop)) {
                    problems.push(`${at(prop)} <${tag}> has a spread attribute, which can replace components. Pass each prop by name.`);
                    continue;
                }
                const name = prop.name.getText(sf);
                if (name === "components" || MARKDOWN_CONTROL_PROPS.has(name)) {
                    seen.set(name, (seen.get(name) ?? 0) + 1);
                    if (seen.get(name) === 2)
                        problems.push(`${at(prop)} <${tag}> has more than one ${name} attribute; React reads the last. Keep one.`);
                }
                if (!MARKDOWN_CONTROL_PROPS.has(name)) continue;
                const init = prop.initializer;
                const value = init && ts.isJsxExpression(init) ? init.expression : undefined;
                const text = init ? init.getText(sf).replace(/\s+/g, " ") : "true";
                let why: string | undefined;
                if (name === "remarkPlugins" || name === "rehypePlugins") {
                    const entry = ALLOWED_MARKDOWN_PROPS.find(([file, p]) => file === fileName && p === name);
                    const accepted = [...(entry ? [entry[2]] : []), ...(name === "remarkPlugins" ? [GFM_ONLY] : [])];
                    why = value ? pluginListProblem(value, accepted) : "the list must be written inline as an array";
                } else why = "no value is listed for this prop";
                if (why)
                    problems.push(
                        `${at(prop)} <${tag}> sets ${name}=${text}: ${why}. A plugin, option or URL transform can change what an image becomes; ` +
                            "if it is intended, list it in ALLOWED_MARKDOWN_PROPS / KNOWN_PLUGINS in frontend/src/__tests__/architecture.test.ts.",
                    );
            }
            const comps = node.attributes.properties.filter((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "components");
            const init = comps[0]?.initializer;
            const call = init && ts.isJsxExpression(init) ? init.expression : undefined;
            if (comps.length !== 1 || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !safeNames.has(call.expression.text))
                problems.push(
                    `${at(node)} <${tag}> must pass one components={withSafeMarkdownImages(...)} with withSafeMarkdownImages imported from "@mike/ui".`,
                );
        } else if (
            ts.isIdentifier(node) &&
            bindings.has(node.text) &&
            !ts.isImportSpecifier(node.parent) &&
            !ts.isImportClause(node.parent) &&
            !ts.isNamespaceImport(node.parent) &&
            !ts.isImportEqualsDeclaration(node.parent) &&
            !ts.isJsxOpeningLikeElement(node.parent) &&
            !ts.isJsxClosingElement(node.parent) &&
            !ts.isTypeQueryNode(node.parent)
        ) {
            problems.push(`${at(node)} uses ${node.text} other than as a JSX element`);
        }
        ts.forEachChild(node, walk);
    };
    walk(sf);
    return problems;
}

describe("Markdown from a model or another person", () => {
    const REPO_FILES = (() => {
        const out: string[] = [];
        const scan = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "node_modules") scan(full);
                } else out.push(full);
            }
        };
        scan(join(FRONTEND, "src"));
        scan(join(REPO, "word-addin/src"));
        scan(join(REPO, "packages"));
        return out;
    })();
    const production = productionSources(REPO_FILES.map((file) => toPosix(relative(REPO, file)))).map((rel) => join(REPO, rel));

    it("rule 6: every react-markdown element in production code passes its components through withSafeMarkdownImages", () => {
        // Parsing every file is slow on a loaded machine: only a file whose text names a Markdown package can import one.
        const names = [...MARKDOWN_LIBRARIES, "react-markdown"];
        const users = production.filter((file) => {
            const text = readFileSync(file, "utf8");
            return names.some((name) => text.includes(name));
        });        expect(users.filter((file) => /react-markdown/.test(readFileSync(file, "utf8"))).length, "the scan must see the Markdown call sites").toBeGreaterThanOrEqual(10);
        const problems = users.flatMap((file) => unsafeMarkdownUses(toPosix(relative(REPO, file)), readFileSync(file, "utf8")));
        expect(
            problems,
            "Wrap the components table in withSafeMarkdownImages(...) from @mike/ui (pass none as withSafeMarkdownImages()): " +
                "it applies the rule that keeps an image from another site from loading without a click.",
        ).toEqual([]);
    });

    it("rule 6 fails for a file that uses the library without the shared rule", () => {
        const SAFE_IMPORT = 'import { withSafeMarkdownImages } from "@mike/ui";';
        const wrap = (body: string, imports = 'import ReactMarkdown from "react-markdown";', safe = SAFE_IMPORT) =>
            `${imports}\n${safe}\nexport const A = () => ${body};`;
        const bad = [
            wrap("<ReactMarkdown>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={{ p: P }}>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={TABLE}>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={{ ...withSafeMarkdownImages(), img: Mine }}>{text}</ReactMarkdown>"),
            wrap("<Md>{text}</Md>", 'import Md from "react-markdown";'),
            wrap("<MarkdownAsync>{text}</MarkdownAsync>", 'import { MarkdownAsync } from "react-markdown";'),
            wrap("h(ReactMarkdown, null)"),
            wrap("<X />", 'export { default } from "react-markdown";'),
            wrap('import("react-markdown")', "export {};"),
            // a. a spread can replace `components`
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} {...props}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown {...props} components={withSafeMarkdownImages()}>{t}</ReactMarkdown>"),
            // b. the callee must be the one imported from @mike/ui
            wrap("<ReactMarkdown components={other(T)}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages(T)}>{t}</ReactMarkdown>", undefined, "const withSafeMarkdownImages = (c) => c;"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages(T)}>{t}</ReactMarkdown>", undefined, 'import { identity as withSafeMarkdownImages } from "lodash";'),
            wrap("<ReactMarkdown components={withSafeMarkdownImages(T)}>{t}</ReactMarkdown>", undefined, 'import { withSafeMarkdownImages } from "./mine";'),
            wrap("<ReactMarkdown components={ui.withSafeMarkdownImages(T)}>{t}</ReactMarkdown>"),
            // e. a plugin or URL transform is a decision taken in this file
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} rehypePlugins={[rehypeRaw]}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} remarkPlugins={[remarkEvil]}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} urlTransform={(u) => u}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} allowElement={() => true}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} allowedElements={['img']}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} disallowedElements={['p']}>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} unwrapDisallowed>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} skipHtml>{t}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} remarkRehypeOptions={{ handlers: {} }}>{t}</ReactMarkdown>"),
            // the allowlist is per file: another file may not use this file's plugin
            wrap("<ReactMarkdown components={withSafeMarkdownImages()} rehypePlugins={[rehypeKatex]}>{t}</ReactMarkdown>"),
        ];
        for (const source of bad) expect(unsafeMarkdownUses("x.tsx", source), source).not.toEqual([]);
        const good = [
            wrap("<ReactMarkdown components={withSafeMarkdownImages({ p: P })}>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages()}>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={withSafeMarkdownImages(TABLE)}>{text}</ReactMarkdown>"),
            wrap("<ReactMarkdown components={safe<Components>({ p: P })}>{text}</ReactMarkdown>", undefined, 'import { withSafeMarkdownImages as safe } from "@mike/ui";'),
            wrap("<ReactMarkdown components={withSafeMarkdownImages<Components>({ p: P })}>{text}</ReactMarkdown>"),
            wrap("<A />", 'import type { Components } from "react-markdown";\nimport type ReactMarkdown from "react-markdown";'),
            wrap("<A />", 'import { type Components } from "react-markdown";'),
            wrap("(null as unknown as React.ComponentProps<typeof ReactMarkdown>)", 'import ReactMarkdown from "react-markdown";'),
        ];
        for (const source of good) expect(unsafeMarkdownUses("x.tsx", source), source).toEqual([]);
    });

    it("rule 6 allows exactly the plugins production uses today, file by file", () => {
        const md = (imports: string, attrs: string) =>
            `import ReactMarkdown from "react-markdown";\nimport { withSafeMarkdownImages } from "@mike/ui";\n${imports}\n` +
            `export const A = () => <ReactMarkdown components={withSafeMarkdownImages()} ${attrs}>{t}</ReactMarkdown>;`;
        const gfm = 'import remarkGfm from "remark-gfm";';
        const katex = `${APP}/assistant/message/MarkdownContent.tsx`;
        const legal = `${APP}/legal/LegalDocument.tsx`;
        const katexImports = `${gfm}\nimport remarkMath from "remark-math";\nimport rehypeKatex from "rehype-katex";`;
        const katexAttrs = "remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]} rehypePlugins={[rehypeKatex]}";
        expect(unsafeMarkdownUses(katex, md(katexImports, katexAttrs))).toEqual([]);
        expect(unsafeMarkdownUses(katex, md(katexImports, "remarkPlugins={[remarkGfm]}"))).toEqual([]);
        expect(unsafeMarkdownUses(katex, md(katexImports, katexAttrs.replace("false", "true")))).not.toEqual([]);
        const legalImports = `${gfm}\nimport { rehypeLegalAnchors } from "@/app/components/legal/legalAnchors";`;
        expect(unsafeMarkdownUses(legal, md(legalImports, "remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeLegalAnchors]}"))).toEqual([]);
        // the same plugin read through a relative path is the same file
        expect(
            unsafeMarkdownUses(legal, md(`${gfm}\nimport { rehypeLegalAnchors } from "./legalAnchors";`, "rehypePlugins={[rehypeLegalAnchors]}")),
        ).toEqual([]);
        expect(unsafeMarkdownUses(legal, md('import { rehypeLegalAnchors } from "./other";', "rehypePlugins={[rehypeLegalAnchors]}"))).not.toEqual([]);
        expect(unsafeMarkdownUses(`${APP}/tabular/TabularCell.tsx`, md(gfm, "remarkPlugins={[remarkGfm]}"))).toEqual([]);
        expect(unsafeMarkdownUses(katex, md(legalImports, "rehypePlugins={[rehypeLegalAnchors]}"))).not.toEqual([]);
        expect(unsafeMarkdownUses(legal, md(`${legalImports}\nimport rehypeKatex from "rehype-katex";`, "rehypePlugins={[rehypeLegalAnchors, rehypeKatex]}"))).not.toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", md(legalImports, "rehypePlugins={[rehypeLegalAnchors]}"))).not.toEqual([]);
    });

    it("rule 6 fails when the shared function is declared a second time in the file", () => {
        const base = 'import ReactMarkdown from "react-markdown";\nimport { withSafeMarkdownImages as safe } from "@mike/ui";\n';
        const use = "<ReactMarkdown components={safe()}>{t}</ReactMarkdown>";
        expect(unsafeMarkdownUses("x.tsx", `${base}export const A = () => ${use};`)).toEqual([]);
        for (const shadow of [
            `export const A = ({ safe }) => ${use};`,
            `export const A = () => { const safe = (c) => c; return ${use}; };`,
            `export function A() { function safe() {} return ${use}; }`,
            `export const A = () => { const { safe } = props; return ${use}; };`,
            `export const A = () => (props.map((safe) => ${use}));`,
        ])
            expect(unsafeMarkdownUses("x.tsx", base + shadow), shadow).not.toEqual([]);
    });

    it("rule 6 fails an element with more than one components, or more than one of a controlled prop", () => {
        const head = 'import ReactMarkdown from "react-markdown";\nimport { withSafeMarkdownImages } from "@mike/ui";\n';
        const el = (attrs: string) => `${head}export const A = () => <ReactMarkdown ${attrs}>{t}</ReactMarkdown>;`;
        expect(unsafeMarkdownUses("x.tsx", el("components={withSafeMarkdownImages()}"))).toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", el("components={{}} components={withSafeMarkdownImages()}"))).not.toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", el("components={withSafeMarkdownImages()} components={{}}"))).not.toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", el("components={withSafeMarkdownImages()} components={withSafeMarkdownImages()}"))).not.toEqual([]);
        expect(
            unsafeMarkdownUses("x.tsx", el("components={withSafeMarkdownImages()} skipHtml skipHtml")),
        ).not.toEqual([]);
    });

    it("rule 6 takes its library list from what is installed, and a path into node_modules counts as the package", () => {
        for (const lib of [
            "mdast-util-from-markdown", "mdast-util-to-hast", "hast-util-raw", "hast-util-from-html", "parse5", "katex",
            "remark-gfm", "rehype-katex", "unified", "markdown-it", "micromark", "marked", "html-url-attributes", "prosemirror-markdown",
        ])
            expect(MARKDOWN_LIBRARIES.has(lib), lib).toBe(true);
        // Whatever is installed in the three applications and matches a family is on the list.
        for (const app of ["frontend", "backend"])
            for (const entry of readdirSync(join(REPO, app, "node_modules")))
                if (!entry.startsWith("@") && MARKDOWN_FAMILY.test(entry) && entry !== "react-markdown")
                    expect(MARKDOWN_LIBRARIES.has(entry), `${app}/node_modules/${entry}`).toBe(true);
        expect(MARKDOWN_LIBRARIES.has("react-markdown")).toBe(false);
        for (const source of [
            'import x from "../../../node_modules/mdast-util-to-hast/index.js";',
            'import x = require("hast-util-raw");',
            'import x = require("../../node_modules/parse5/dist/index.js");',
            'const x = require("katex");',
            'import "katex/dist/katex.min.css";',
            'import { x } from "html-url-attributes";',
            'import x from "../../node_modules/react-markdown/index.js";\nexport const A = () => <x>{t}</x>;',
        ])
            expect(unsafeMarkdownUses("x.tsx", source), source).not.toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", 'import type { Root } from "hast";\nimport { type Element } from "hast";')).toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", 'import { relative } from "./hast-util-raw";')).toEqual([]);
        // every allowlist line names a production file, and a library the list really holds
        for (const [file, lib] of ALLOWED_MARKDOWN_LIBRARIES) expect(MARKDOWN_LIBRARIES.has(lib), `${file} ${lib}`).toBe(true);
    });

    it("rule 6 fails for another library that turns Markdown or HTML text into elements, unless listed", () => {
        const libs = [
            "marked", "markdown-it", "micromark", "unified", "remark-parse", "remark-rehype", "rehype-raw",
            "rehype-react", "hast-util-to-jsx-runtime", "markdown-to-jsx", "html-react-parser",
        ];
        for (const lib of libs) {
            for (const source of [
                `import x from "${lib}";`,
                `import { x } from "${lib}";`,
                `import * as x from "${lib}";`,
                `import "${lib}";`,
                `export { x } from "${lib}";`,
                `const x = require("${lib}");`,
                `const x = await import("${lib}");`,
                `import x from "${lib}/lib/index.js";`,
            ])
                expect(unsafeMarkdownUses("x.tsx", source), source).not.toEqual([]);
        }
        expect(unsafeMarkdownUses("x.tsx", 'import type { Token } from "marked";')).toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", 'import { marked as m } from "marked-other";')).toEqual([]);
        // an explicit, justified use is allowed in its own file only
        const editor = "frontend/src/app/components/ui/markdown-editor.tsx";
        expect(unsafeMarkdownUses(editor, 'import { marked } from "marked";')).toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", 'import { marked } from "marked";')).not.toEqual([]);
        expect(unsafeMarkdownUses(editor, 'import { unified } from "unified";')).not.toEqual([]);
    });

    it("rule 6 scans script files too", () => {
        expect(
            productionSources([
                "a/b.jsx", "a/c.js", "a/d.mjs", "a/e.tsx", "a/f.ts", "a/g.test.js", "a/h.spec.jsx",
                "a/__tests__/i.js", "a/j.stories.tsx", "a/k.json", "a/l.md",
            ]),
        ).toEqual(["a/b.jsx", "a/c.js", "a/d.mjs", "a/e.tsx", "a/f.ts"]);
        const wrap = (file: string) => unsafeMarkdownUses(file, 'import ReactMarkdown from "react-markdown";\nexport const A = () => <ReactMarkdown>{t}</ReactMarkdown>;');
        for (const file of ["x.jsx", "x.js", "x.mjs"]) expect(wrap(file), file).not.toEqual([]);
    });

    it("rule 6 allowlist entries are all still in use", () => {
        const files = production.map((file) => toPosix(relative(REPO, file)));
        for (const [file] of [...ALLOWED_MARKDOWN_LIBRARIES, ...ALLOWED_MARKDOWN_PROPS, ...MARKDOWN_PLUGIN_FILES.map((f) => [f])])
            expect(files, `${file} is on the Markdown allowlist but is not a production file`).toContain(file);
    });

    it("rule 6 flags the probes written to get past it, and only the stated limits stay unflagged", () => {
        for (const probe of RULE_PROBES) {
            const problems = unsafeMarkdownUses(probe.fileName, probe.source);
            if (probe.flagged) expect(problems, `${probe.id} ${probe.name}`).not.toEqual([]);
            else expect(problems, `${probe.id} ${probe.name}: ${probe.note ?? ""}`).toEqual([]);
        }
    });

    it("rule 6 checks what a plugin name is bound to, not its spelling", () => {
        const gfm = 'import remarkGfm from "remark-gfm";\n';
        const el = (attrs: string) => `import ReactMarkdown from "react-markdown";\nimport { withSafeMarkdownImages } from "@mike/ui";\nexport const A = () => <ReactMarkdown components={withSafeMarkdownImages()} ${attrs}>{t}</ReactMarkdown>;`;
        const bad = [
            // the add-in's plugin list written as a named array that gained an entry
            `${gfm}import evil from "./evil";\nconst REMARK_PLUGINS = [remarkGfm, evil];\n` + el("remarkPlugins={REMARK_PLUGINS}"),
            gfm + 'import evil from "./evil";\n' + el("remarkPlugins={[remarkGfm, evil]}"),
            'import remarkGfm from "./evilRemark";\n' + el("remarkPlugins={[remarkGfm]}"),
            'import evil from "./evilRemark";\nconst remarkGfm = evil;\n' + el("remarkPlugins={[remarkGfm]}"),
            'import { remarkGfm } from "remark-gfm";\n' + el("remarkPlugins={[remarkGfm]}"),
            gfm + "export const f = (remarkGfm) => remarkGfm;\n" + el("remarkPlugins={[remarkGfm]}"),
            el("remarkPlugins={[remarkGfm]}"),
        ];
        for (const source of bad) expect(unsafeMarkdownUses("x.tsx", source), source).not.toEqual([]);
    });
});
