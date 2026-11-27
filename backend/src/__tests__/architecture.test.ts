// Architecture fitness test — the backend's layering rules, executable.
//
// Conventions are worthless if nothing checks them. This test walks every
// TypeScript file under `src/`, reads its import statements, and fails when a
// file crosses a boundary the module layout forbids. It needs no lint plugin
// or dependency-cruiser: a directory walk and a syntax parser make the
// rules in `AGENTS.md` ("Backend Structure") load-bearing.
//
// The rules:
//
//   1. `lib/` is the shared kernel. It never imports from `modules/`.
//   2. A module is reached from outside only through its facade
//      (`modules/<domain>/<name>.service.ts`). Another module, a worker, a
//      job — none of them may import a module's topic files. The one other
//      entry point is `*.routes.ts`, and only `app.ts` may import it: that is
//      how a module's HTTP surface gets mounted.
//   3. Everything in a module except its `*.routes.ts` files is HTTP-agnostic:
//      no `express` import, no `req`/`res`.
//   4. Route files parse requests and map results; they never query the
//      database. Counted, not banned outright, so the debt that remains is
//      visible and can only shrink (a ratchet).
//   5. Facades re-export by name. `export *` hides what a module exposes.
//   6. `middleware/` is request plumbing; it depends on `lib/`, not on
//      domain modules.
//   7. `src/routes/` no longer exists. New HTTP surfaces are modules.
//   8. Document-version writes and lifecycle RPCs belong to documents.
//   9. Object storage is reached only through the `lib/storage.ts` facade.
//      Transports live in `lib/storage/` and are imported by nothing else,
//      and only the S3 adapter talks to the AWS SDK, so a fork can swap the
//      backend with `setStorageAdapter()` without any call site bypassing it.
//
// Each rule has an explicit allowlist. Adding to an allowlist is a reviewable
// decision with a comment explaining why; silently widening one is not.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { dependencies, loadSourceParser, readPaths, resolveDependency, type Paths } from "./helpers/sourceDependencies";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|mts|cts)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(SRC).map((f) => relative(SRC, f).split(sep).join("/"));
const isTestFile = (f: string) => /(^|\/)__tests__\//.test(f) || /\.test\.ts$/.test(f);
const PRODUCTION_FILES = ALL_FILES.filter((f) => !isTestFile(f));

function read(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

let PATHS: Paths;
beforeAll(async () => {
  await loadSourceParser();
  PATHS = readPaths(resolve(SRC, "../tsconfig.json"));
});
function importsOf(file: string): string[] {
  return dependencies(read(file), file).map(({ specifier }) => {
    const resolved = resolveDependency(join(SRC, file), specifier, resolve(SRC, ".."), PATHS);
    return resolved ? relative(SRC, resolved).split(sep).join("/").replace(/\.[cm]?[jt]sx?$/, "") : specifier;
  });
}

const moduleOf = (file: string): string | null => {
  const m = /^modules\/([^/]+)\//.exec(file);
  return m ? m[1] : null;
};

/** The single facade file of a module, e.g. `modules/chat/chat.service`. */
function facadeOf(domain: string): string {
  const dir = join(SRC, "modules", domain);
  const facades = readdirSync(dir).filter((f) => /\.service\.ts$/.test(f));
  if (facades.length !== 1) {
    throw new Error(
      `modules/${domain} must have exactly one *.service.ts facade, found: ${facades.join(", ") || "none"}`,
    );
  }
  return `modules/${domain}/${facades[0].replace(/\.ts$/, "")}`;
}

const MODULES = existsSync(join(SRC, "modules"))
  ? readdirSync(join(SRC, "modules")).filter((d) =>
      statSync(join(SRC, "modules", d)).isDirectory(),
    )
  : [];

/**
 * True when the text names the repair library as a bare module specifier or as a whole path
 * segment: the name between quotes (any style), slashes or backslashes. A text scan: it cannot
 * see a name that is built at run time.
 */
function namesRepairLibrary(text: string): boolean {
  return /["'`\/\\]jsonrepair["'`\/\\]/.test(text);
}

/** Source without comments. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const code = (file: string) => stripComments(read(file));

/**
 * True when a production file reads or names the stored text where it must not: the table, the column or the
 * two slice functions appear only in the files that own them (documents.indexing.ts writes the table;
 * documentTextCache.ts and documents.textSearch.ts hold the two slice readers). Any spelling counts: the
 * table in an embed (`!inner(*)`), a name in a variable, a template literal. A name built from pieces at run
 * time is the one thing a text scan cannot see; it needs the pieces "document", "version" and "texts" and is
 * not how the code base spells table names.
 */
function textReadsOutsideTheReaders(file: string, source: string): boolean {
  const text = stripComments(source);
  const mentions = (re: RegExp) => re.test(text);
  // `*` or text_content in the column list of an embed of the table, in any spelling (`(status,*)`, `!inner(*)`).
  const embedsTheText = () => [...text.matchAll(/document_version_texts\s*(?:![\w.]+\s*)?\(([^)]*)\)/g)].some((m) => /\*|text_content/.test(m[1]));
  const selectsEverything = () => /\.select\(\s*["'`]\s*\*/.test(text);
  // a select of everything, or of text_content, chained from the table itself
  const selectsTheTextOfTheTable = () => /from\(\s*["'`]document_version_texts["'`]\s*\)[^;]*?\.select\(\s*["'`][^"'`]*(\*|text_content)/.test(text);
  if (file === "modules/documents/documents.indexing.ts") return mentions(/\bread_document_text\b|\bdocument_text_slice\b/) || selectsTheTextOfTheTable() || embedsTheText();
  // The cache names the table only in an embed of explicit columns; the text comes from the one bounded reader.
  if (file === "lib/documentTextCache.ts") return mentions(/\bread_document_text\b|\btext_content\b|from\(\s*["'`]document_version_texts/) || embedsTheText() || selectsEverything();
  if (file === "modules/documents/documents.textSearch.ts") return mentions(/\bdocument_text_slice\b|\bdocument_version_texts\b|\btext_content\b/);
  return mentions(/\bdocument_version_texts\b|\btext_content\b|\bread_document_text\b|\bdocument_text_slice\b/)
    || mentions(/["'`]document["'`]\s*,\s*["'`]version["'`]\s*,\s*["'`]texts["'`]/);
}

/**
 * True when a production file selects the text of a scan reading (`pages`, or `*`) from `document_version_ocr` at
 * all, or asks for its pages anywhere but in documents.ocr.state.ts: the bounded function `document_ocr_pages`,
 * called there by the one assembler, is the only way to that text.
 */
function readsScanTextOutsideTheAssembler(file: string, source: string): boolean {
  const text = stripComments(source);
  if (file !== "modules/documents/documents.ocr.state.ts" && /\bdocument_ocr_pages\b/.test(text)) return true;
  // an embed of the table in another select (`document_version_ocr(pages)`, `!inner(*)`, or no column list at all)
  const embeds = [...text.matchAll(/document_version_ocr\s*(?:![\w.]+\s*)?\(([^)]*)\)/g)].some((m) => m[1].trim() === "" || /\*|\bpages\b/.test(m[1]));
  return embeds || [...text.matchAll(/document_version_ocr/g)].some((m) =>
    /^[\s\S]{0,300}?\.select\(\s*["'`][^"'`]*(\bpages\b|\*)/.test(text.slice(m.index!)));
}

// Only the scan-reading job and the copy to a split version write a scan reading's row.
const SCAN_READING_WRITERS = new Set(["modules/documents/documents.ocr.ts", "modules/documents/documents.ocr.state.ts"]);
function writesScanReadingOutsideItsWriters(file: string, source: string): boolean {
  return !SCAN_READING_WRITERS.has(file)
    && /document_version_ocr[\s\S]{0,400}?\.(?:upsert|insert|update)\(/.test(stripComments(source));
}

describe("backend architecture", () => {
  it("domain implementations cannot import application workflows or their own facade", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const domain = moduleOf(file);
      if (!domain || /\.routes\.ts$/.test(file)) continue;
      for (const spec of importsOf(file)) {
        if (spec.startsWith("application/") || spec === facadeOf(domain)) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("application workflows are HTTP-agnostic", () => {
    expect(PRODUCTION_FILES.filter(f => f.startsWith("application/") && importsOf(f).includes("express"))).toEqual([]);
  });

  it("credential consumers use its public API", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES.filter(f => !f.startsWith("lib/providerCredentials/"))) {
      for (const spec of importsOf(file)) if (spec.startsWith("lib/providerCredentials/") && spec !== "lib/providerCredentials/index") offenders.push(`${file} -> ${spec}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every module has exactly one facade and at least one routes file", () => {
    for (const domain of MODULES) {
      expect(() => facadeOf(domain)).not.toThrow();
      const files = readdirSync(join(SRC, "modules", domain));
      expect(
        files.some((f) => /\.routes\.ts$/.test(f)),
        `modules/${domain} has no *.routes.ts`,
      ).toBe(true);
    }
  });

  it("rule 1: lib/ never imports from modules/", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES.filter((f) => f.startsWith("lib/"))) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith("modules/") || spec.startsWith("application/")) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rule 2: a module is imported from outside only through its facade", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const own = moduleOf(file);
      for (const spec of importsOf(file)) {
        const target = moduleOf(spec + "/");
        if (!target || target === own) continue;
        if (spec === facadeOf(target)) continue;
        // app.ts mounts routers; a routes file is a module's HTTP entry point.
        if (file === "app.ts" && /\.routes$/.test(spec)) continue;
        offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rule 3: only *.routes.ts inside a module may import express", () => {
    const ALLOWED = new Set<string>([
      // The tabular generate stream writes SSE frames while it runs
      // extraction; the streaming loop is the documented layering exception
      // (see the file header). It takes `res` explicitly rather than hiding
      // it in a closure so the exception stays visible at the call site.
      "modules/tabular/tabular.generateStream.ts",
    ]);
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      if (!file.startsWith("modules/")) continue;
      if (/\.routes\.ts$/.test(file) || ALLOWED.has(file)) continue;
      const specs = importsOf(file);
      if (specs.includes("express")) offenders.push(file);
      const text = read(file);
      if (/\bres\.(status|json|setHeader|send|write)\(/.test(text))
        offenders.push(`${file} (writes to res)`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 4: route files do not query the database (ratchet)", () => {
    // Remaining inline queries per routes file. A number may go DOWN when a
    // handler is moved behind its service; it must never go up. Delete the
    // entry when the file reaches zero.
    const BASELINE: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const file of PRODUCTION_FILES) {
      if (!/\.routes\.ts$/.test(file)) continue;
      const text = read(file);
      const n = (text.match(/\.(from|rpc)\(\s*["']/g) ?? []).length;
      if (n > 0) counts[file] = n;
    }
    const regressions = Object.entries(counts)
      .filter(([file, n]) => n > (BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > baseline ${BASELINE[file] ?? 0}`);
    expect(regressions).toEqual([]);
    const stale = Object.entries(BASELINE)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file}: baseline ${n} is stale, now ${counts[file] ?? 0}`);
    expect(stale, "lower the baseline so the ratchet keeps its teeth").toEqual([]);
  });

  it("rule 5: facades re-export by name, never `export *`", () => {
    const offenders = MODULES.map((d) => `${facadeOf(d)}.ts`).filter((f) =>
      /^\s*export\s+\*\s+from/m.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("rule 6: middleware/ never imports from modules/", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES.filter((f) => f.startsWith("middleware/"))) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith("modules/") || spec.startsWith("application/")) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rule 7: src/routes/ is gone; HTTP surfaces are modules", () => {
    expect(existsSync(join(SRC, "routes"))).toBe(false);
  });

  it("document version mutations belong to the documents module", () => {
    const directWrite = /\.from\(\s*["']document_versions["']\s*\)\s*\.(insert|upsert|update|delete)\s*\(/;
    const lifecycleRpc = /\.rpc\(\s*["'](?:create_document_versions?|activate_document_version|delete_document_version)["']/;
    const offenders = PRODUCTION_FILES.filter((file) =>
      !file.startsWith("modules/documents/") &&
      (directWrite.test(read(file)) || lifecycleRpc.test(read(file))),
    );
    expect(offenders).toEqual([]);
  });

  it("rule 9: object storage is reached only through lib/storage.ts", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const inTransport = file.startsWith("lib/storage/");
      for (const spec of importsOf(file)) {
        if (spec.startsWith("@aws-sdk/") && file !== "lib/storage/s3.ts") {
          offenders.push(`${file} -> ${spec}`);
        }
        if (
          spec.startsWith("lib/storage/") &&
          file !== "lib/storage.ts" &&
          !inTransport
        ) {
          offenders.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rule 10: the JSON repair library is reached only through lib/boundedJsonRepair.ts", () => {
    // The library has no bound on its time; the one helper runs it under a deadline.
    const offenders = PRODUCTION_FILES.filter(
      (file) =>
        file !== "lib/boundedJsonRepair.ts" &&
        (importsOf(file).some((spec) => spec === "jsonrepair" || spec.startsWith("jsonrepair/")) ||
          namesRepairLibrary(read(file))),
    );
    expect(offenders).toEqual([]);
    expect(namesRepairLibrary(read("lib/boundedJsonRepair.ts"))).toBe(true);
  });

  // Content computed from documents is judged when it is read (AGENTS.md, security rule 2). A Word chat's
  // answers are such content: every file that reads the Word chat tables is listed here with the
  // way it judges what it serves, and a new reader is added with its own test.
  it("security rule 2: the readers of Word chat messages are the known ones", () => {
    const READERS: Record<string, string> = {
      "lib/chatReadAccess.ts": "the shared judging code",
      "modules/word-chat/wordChat.service.ts": "the transcript, judged with readableChatMessages",
      "modules/word-chat/wordChat.routes.ts": "the running turn, judged with mayWatchChatTurn",
      "application/exports/buildJsonExport.ts": "the export, judged with readableChatMessages",
      "modules/chat/engine/priorTurnAccess.ts": "the prior turns given to the model, judged with readableByOwnSources",
      "lib/trainingTurn/accountability.ts": "names the table of a backing check's citations; its readers pass mayOpenWorkMatter",
      "modules/training-supervision/trainingSupervision.signals.ts": "citation counts of a work, after mayOpenWorkMatter",
      "modules/chat/engine/routeStreaming.ts": "writes the reserved answer",
      "lib/wordWorkspace.ts": "reads attachments to place the chat in a workspace, not content",
      "modules/memory/memory.curator.ts": "the owner's own memory, not served to a reader",
    };
    const readers = PRODUCTION_FILES.filter((file) => /word_chat_messages/.test(read(file)));
    expect(readers.filter((file) => !(file in READERS))).toEqual([]);
  });

  it("security rule 2: a training reader of a Word chat's work passes the chat to mayOpenWorkMatter", () => {
    // These have no Word chat to judge: a matter only, or a chat of the assistant.
    const NO_WORD_CHAT = new Set([
      "lib/trainingWork.ts",
      "modules/training-supervision/trainingSupervision.lens.ts",
      "modules/training-criteria-contrast/trainingCriteriaContrast.service.ts",
    ]);
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES.filter((f) => !NO_WORD_CHAT.has(f))) {
      for (const call of read(file).split("mayOpenWorkMatter(").slice(1)) {
        if (!call.slice(0, call.indexOf(");")).includes("wordChatId")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rule 10: the text scan sees every spelling of a load of the library", () => {
    const named = [
      'import { jsonrepair } from "jsonrepair";',
      'export { jsonrepair } from "jsonrepair";',
      'const m = () => import("jsonrepair");',
      'const x = require("jsonrepair");',
      'const x = require (\'jsonrepair\');',
      "const x = require(`jsonrepair`);",
      'const x = require("jsonrepair/stream");',
      'const x = module.require("jsonrepair");',
      'const x = require("../../../node_modules/jsonrepair/lib/umd/jsonrepair.js");',
      'const x = require("/abs/node_modules/jsonrepair/lib/cjs/index.js");',
      'const x = require("..\\\\node_modules\\\\jsonrepair\\\\lib\\\\index.js");',
      'const x = createRequire(__filename)("jsonrepair");',
      'const x = createRequire(import.meta.url)("jsonrepair/lib/cjs/index.js");',
      "const x = require(`../node_modules/jsonrepair/lib/umd/jsonrepair.js`);",
    ];
    const notNamed = [
      'import { x } from "./jsonrepairs";',
      'const x = require("my-jsonrepair");',
      'const x = require("./boundedJsonRepair");',
      'import { repairJson } from "../boundedJsonRepair";',
      'const x = "jsonrepairing";',
      "const x = 1; // no library here",
    ];
    for (const sample of named) expect(namesRepairLibrary(sample), sample).toBe(true);
    for (const sample of notNamed) expect(namesRepairLibrary(sample), sample).toBe(false);
  });

  it("rule 11: a stored document text is read only through the bounded-slice readers", () => {
    // No response from the database may carry a whole text: the column is read by the two slice
    // functions only, and a text is assembled from slices in one place (lib/documentTextSlices.ts).
    // The table is matched by name in any form (embed, `!inner(*)`, a name held in a variable), so a file
    // outside the two that may touch it never mentions it at all.
    const offenders = (files: Array<[string, string]>) => files.filter(([file, text]) => textReadsOutsideTheReaders(file, text)).map(([file]) => file);
    expect(offenders(PRODUCTION_FILES.map((file) => [file, read(file)]))).toEqual([]);
    expect(code("modules/documents/documents.indexing.ts").match(/text_content[^\n]*/g)).toEqual(["text_content: null, error_code: errorCode, updated_at: new Date().toISOString() })"]);
    // the cache's embed names its columns: no `*`, no text_content
    expect(code("lib/documentTextCache.ts")).not.toMatch(/document_version_texts\s*(!\w+\s*)?\(\s*\*/);
    expect(code("lib/documentTextCache.ts")).not.toMatch(/text_content/);
  });

  it("rule 11: the check refuses the spellings of a whole-text read that name the table in the source", () => {
    // A text rule catches a table named in the source, not one computed at run time.
    const forms: Array<[string, string]> = [
      ["modules/documents/documents.sneaky.ts", 'db.from("document_versions").select("id,document_version_texts!inner(*)")'],
      ["modules/documents/documents.sneaky.ts", 'const TEXTS = "document_version_texts"; db.from(TEXTS).select("*")'],
      ["modules/documents/documents.sneaky.ts", "db.from('document_version_texts').select('text_content')"],
      ["modules/documents/documents.sneaky.ts", 'db.from("document_versions").select("document_version_texts(*)")'],
      ["modules/documents/documents.sneaky.ts", 'db.rpc("read_document_text", {})'],
      ["modules/documents/documents.sneaky.ts", "db.rpc(`document_text_slice`, {})"],
      ["modules/documents/documents.sneaky.ts", 'const c = "text_" + "content"; db.from(["document", "version", "texts"].join("_"))'],
    ];
    for (const [file, text] of forms) expect(textReadsOutsideTheReaders(file, text), text).toBe(true);
    // inside the files that may touch the table: `*` or text_content in any embed or select
    const cache = "lib/documentTextCache.ts";
    expect(textReadsOutsideTheReaders(cache, 'select("id,document_version_texts(status,*)")')).toBe(true);
    expect(textReadsOutsideTheReaders(cache, 'db.from("document_version_texts").select("*")')).toBe(true);
    expect(textReadsOutsideTheReaders(cache, 'select("text_revision,document_version_texts!inner(*)")')).toBe(true);
    expect(textReadsOutsideTheReaders("modules/documents/documents.indexing.ts", 'db.from("document_version_texts").select("*")')).toBe(true);
    // the allowed places and plain comments are not flagged
    expect(textReadsOutsideTheReaders("modules/documents/documents.indexing.ts", 'db.from("document_version_texts").update({ text_content: null })')).toBe(false);
    expect(textReadsOutsideTheReaders("lib/documentTextCache.ts", 'select("document_version_texts(status)"); db.rpc("document_text_slice", {})')).toBe(false);
    expect(textReadsOutsideTheReaders("modules/documents/documents.textSearch.ts", 'db.rpc("read_document_text", {})')).toBe(false);
    expect(textReadsOutsideTheReaders("modules/documents/documents.other.ts", "// the table document_version_texts is server-only\nconst x = 1;")).toBe(false);
  });

  it("rule 13: the pages stored for a scan reading come only from the bounded result, and only two files write the row", () => {
    expect(PRODUCTION_FILES.filter((file) => writesScanReadingOutsideItsWriters(file, read(file)))).toEqual([]);
    const job = code("modules/documents/documents.ocr.ts");
    expect(job).toMatch(/boundOcrReading\(\s*result\s*,/);
    expect(job).toMatch(/pages:\s*stored\.pages/);
    expect(job).not.toMatch(/pages:\s*result\b/);
    expect(writesScanReadingOutsideItsWriters("modules/documents/documents.sneaky.ts", 'db.from("document_version_ocr").upsert({ pages })')).toBe(true);
    expect(writesScanReadingOutsideItsWriters("modules/documents/documents.sneaky.ts", 'db.from("document_version_ocr").select("status")')).toBe(false);
    expect(writesScanReadingOutsideItsWriters("modules/documents/documents.ocr.ts", 'db.from("document_version_ocr").upsert({})')).toBe(false);
  });

  it("rule 12: no file names the pages of a scan reading, in a select or an embed, outside the bounded function and its one assembler (a table named in the source, not one computed at run time)", () => {
    expect(PRODUCTION_FILES.filter((file) => readsScanTextOutsideTheAssembler(file, read(file)))).toEqual([]);
    // no select of `pages` or `*` from the table, not even in documents.ocr.state.ts
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.ocr.state.ts", read("modules/documents/documents.ocr.state.ts"))).toBe(false);
    expect(code("modules/documents/documents.ocr.state.ts")).toMatch(/rpc\(\s*["']document_ocr_pages["']/);
    expect(code("modules/documents/documents.ocr.state.ts")).not.toMatch(/from\(\s*["']document_version_ocr["']\s*\)\s*\.select/);
    // the rule sees the forms
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'db.from("document_versions").select("id,document_version_ocr(pages)")')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'select("id,document_version_ocr!inner(status,*)")')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'select("id,document_version_ocr()")')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'select("id,document_version_ocr(status,failed_pages)")')).toBe(false);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'db.from("document_version_ocr").select("version_id,pages")')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.ocr.state.ts", 'db.from("document_version_ocr").select("version_id,pages")')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", "db.from('document_version_ocr').select('*')")).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.sneaky.ts", 'db.rpc("document_ocr_pages", {})')).toBe(true);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.ocr.state.ts", 'db.rpc("document_ocr_pages", {})')).toBe(false);
    expect(readsScanTextOutsideTheAssembler("modules/platform/platform.stats.ts", '"document_version_ocr", "version_id,requested_by,created_at"')).toBe(false);
    expect(readsScanTextOutsideTheAssembler("modules/documents/documents.ocr.ts", 'db.from("document_version_ocr").update({}).select("version_id")')).toBe(false);
  });
});
