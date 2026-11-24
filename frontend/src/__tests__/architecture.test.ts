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

// Rule 6. Returns what is wrong with how `source` uses react-markdown and the
// other libraries that turn Markdown or HTML text into elements; empty when
// every Markdown element passes its `components` through the
// `withSafeMarkdownImages` imported from `@mike/ui`, carries no spread, and
// uses only the plugins and transforms listed below.
const MARKDOWN_TYPE_ONLY = new Set(["Components", "Options", "ExtraProps", "UrlTransform", "AllowElement"]);

// Libraries that turn Markdown or HTML text into elements (or into HTML that
// is then inserted). A production import needs an entry here, with the reason.
const MARKDOWN_LIBRARIES = [
    "marked", "markdown-it", "micromark", "unified", "remark-parse", "remark-rehype", "rehype-raw",
    "rehype-react", "hast-util-to-jsx-runtime", "markdown-to-jsx", "html-react-parser",
    "tiptap-markdown", "dompurify", "isomorphic-dompurify", "sanitize-html", "showdown", "snarkdown",
];
// [file, library, why this use cannot put a model's or another person's image on the page]
const ALLOWED_MARKDOWN_LIBRARIES: [string, string, string][] = [
    ["frontend/src/app/components/ui/markdown-editor.tsx", "marked", "parses two strings to compare them; the result is never inserted"],
    ["frontend/src/app/components/ui/markdown-editor.tsx", "tiptap-markdown", "editor configured with html:false, and the editor has no image node"],
    ["word-addin/src/taskpane/components/workflows/WorkflowPromptEditor.tsx", "tiptap-markdown", "editor configured with html:false, and the editor has no image node"],
    ["frontend/src/app/components/assistant/CaseView.tsx", "dompurify", "case-law HTML (not model text) sanitized with an allowlist that has no img, style or srcset"],
];
// The props that change what a Markdown element parses or lets through, with
// the value each file uses today. Anything else is a decision to take here.
const MARKDOWN_CONTROL_PROPS = new Set([
    "rehypePlugins", "remarkPlugins", "urlTransform", "allowElement", "allowedElements",
    "disallowedElements", "unwrapDisallowed", "skipHtml",
]);
const REMARK_GFM = "frontend/src/app/components";
// [file, prop, value as written (whitespace collapsed)]
const ALLOWED_MARKDOWN_PROPS: [string, string, string][] = [
    [`${REMARK_GFM}/assistant/message/MarkdownContent.tsx`, "remarkPlugins", "{[ [remarkMath, { singleDollarTextMath: false }], remarkGfm, ]}"],
    [`${REMARK_GFM}/assistant/message/MarkdownContent.tsx`, "rehypePlugins", "{[rehypeKatex]}"],
    [`${REMARK_GFM}/assistant/message/EventBlocks.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/legal/LegalDocument.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/legal/LegalDocument.tsx`, "rehypePlugins", "{[rehypeLegalAnchors]}"],
    [`${REMARK_GFM}/legal/SignupLegal.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/tabular/TRChatPanel.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/tabular/TRSidePanel.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/tabular/TabularCell.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/workflows/WFColumnViewModal.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/workflows/WorkflowAddonPreviewModal.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    [`${REMARK_GFM}/workflows/WorkflowPickerContent.tsx`, "remarkPlugins", "{[remarkGfm]}"],
    ["word-addin/src/shared/chat/Markdown.tsx", "remarkPlugins", "{REMARK_PLUGINS}"],
];

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

function unsafeMarkdownUses(fileName: string, source: string): string[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const problems: string[] = [];
    const bindings = new Set<string>();
    const safeNames = new Set<string>();
    const at = (node: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const moduleName = (node: ts.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
    const isMarkdownModule = (node: ts.Node | undefined) => moduleName(node) === "react-markdown";
    const libraryOf = (spec: string | undefined) =>
        spec === undefined ? undefined : MARKDOWN_LIBRARIES.find((lib) => spec === lib || spec.startsWith(`${lib}/`));
    const checkLibrary = (node: ts.Node, spec: string | undefined) => {
        const lib = libraryOf(spec);
        if (lib && !ALLOWED_MARKDOWN_LIBRARIES.some(([file, name]) => file === fileName && name === lib))
            problems.push(
                `${at(node)} imports ${spec}, a library that turns Markdown or HTML text into elements. Render with ` +
                    "<ReactMarkdown components={withSafeMarkdownImages(...)}>, or add the file, the library and the reason " +
                    "to ALLOWED_MARKDOWN_LIBRARIES in frontend/src/__tests__/architecture.test.ts.",
            );
    };
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            if (!clause?.isTypeOnly) checkLibrary(node, moduleName(node.moduleSpecifier));
            if (moduleName(node.moduleSpecifier) === "@mike/ui" && clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
                for (const el of clause.namedBindings.elements)
                    if (!el.isTypeOnly && (el.propertyName ?? el.name).text === "withSafeMarkdownImages") safeNames.add(el.name.text);
            if (isMarkdownModule(node.moduleSpecifier) && clause && !clause.isTypeOnly) {
                if (clause.name) bindings.add(clause.name.text);
                const named = clause.namedBindings;
                if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text);
                if (named && ts.isNamedImports(named))
                    for (const el of named.elements)
                        if (!el.isTypeOnly && !MARKDOWN_TYPE_ONLY.has((el.propertyName ?? el.name).text))
                            bindings.add(el.name.text);
            }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
            if (isMarkdownModule(node.moduleSpecifier)) problems.push(`${at(node)} re-exports react-markdown`);
            checkLibrary(node, moduleName(node.moduleSpecifier));
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
            if (isMarkdownModule(node.arguments[0])) problems.push(`${at(node)} loads react-markdown dynamically`);
            checkLibrary(node, moduleName(node.arguments[0]));
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    const walk = (node: ts.Node) => {
        if (ts.isJsxOpeningLikeElement(node) && bindings.has(node.tagName.getText(sf))) {
            const tag = node.tagName.getText(sf);
            for (const prop of node.attributes.properties) {
                if (ts.isJsxSpreadAttribute(prop))
                    problems.push(`${at(prop)} <${tag}> has a spread attribute, which can replace components. Pass each prop by name.`);
                else if (MARKDOWN_CONTROL_PROPS.has(prop.name.getText(sf))) {
                    const name = prop.name.getText(sf);
                    const value = prop.initializer ? prop.initializer.getText(sf).replace(/\s+/g, " ") : "true";
                    const allowed = ALLOWED_MARKDOWN_PROPS.some(([file, p, v]) => file === fileName && p === name && v === value);
                    const isGfm = name === "remarkPlugins" && value === "{[remarkGfm]}";
                    if (!allowed && !isGfm)
                        problems.push(
                            `${at(prop)} <${tag}> sets ${name}=${value}. A plugin or URL transform can change what an image becomes: ` +
                                "if it is intended, list the file, prop and value in ALLOWED_MARKDOWN_PROPS in frontend/src/__tests__/architecture.test.ts.",
                        );
                }
            }
            const attr = node.attributes.properties.find(
                (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "components",
            );
            const init = attr?.initializer;
            const call = init && ts.isJsxExpression(init) ? init.expression : undefined;
            if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !safeNames.has(call.expression.text))
                problems.push(
                    `${at(node)} <${tag}> must pass components={withSafeMarkdownImages(...)} with withSafeMarkdownImages imported from "@mike/ui".`,
                );
        } else if (
            ts.isIdentifier(node) &&
            bindings.has(node.text) &&
            !ts.isImportSpecifier(node.parent) &&
            !ts.isImportClause(node.parent) &&
            !ts.isNamespaceImport(node.parent) &&
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
        const users = production;
        expect(users.filter((file) => /react-markdown/.test(readFileSync(file, "utf8"))).length, "the scan must see the Markdown call sites").toBeGreaterThanOrEqual(10);
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
        const md = (attrs: string) =>
            `import ReactMarkdown from "react-markdown";\nimport { withSafeMarkdownImages } from "@mike/ui";\n` +
            `export const A = () => <ReactMarkdown components={withSafeMarkdownImages()} ${attrs}>{t}</ReactMarkdown>;`;
        const katex = "frontend/src/app/components/assistant/message/MarkdownContent.tsx";
        const legal = "frontend/src/app/components/legal/LegalDocument.tsx";
        expect(unsafeMarkdownUses(katex, md("rehypePlugins={[rehypeKatex]}"))).toEqual([]);
        expect(unsafeMarkdownUses(legal, md("rehypePlugins={[rehypeLegalAnchors]}"))).toEqual([]);
        expect(unsafeMarkdownUses("x.tsx", md("remarkPlugins={[remarkGfm]}"))).toEqual([]);
        expect(unsafeMarkdownUses(katex, md("rehypePlugins={[rehypeLegalAnchors]}"))).not.toEqual([]);
        expect(unsafeMarkdownUses(legal, md("rehypePlugins={[rehypeKatex, rehypeRaw]}"))).not.toEqual([]);
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
        for (const [file] of [...ALLOWED_MARKDOWN_LIBRARIES, ...ALLOWED_MARKDOWN_PROPS])
            expect(files, `${file} is on the Markdown allowlist but is not a production file`).toContain(file);
    });
});
