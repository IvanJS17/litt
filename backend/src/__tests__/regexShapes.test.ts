// Super-linear regular expressions stay out of backend code.
//
// A backtracking engine that meets `(a+)+`, or `\s*(.*?)\s*$` on a long enough
// input, holds the thread for seconds or minutes, and Node has no regex
// timeout. The backend serves every tenant from one API thread and one jobs
// thread, so a long answer from a model or a long saved text must never be
// the input of such an expression. Text of that kind is scanned by
// `lib/modelJsonFence.ts`, with a size limit and in linear time.
//
// This test reads every regular expression literal and every `new RegExp("…")`
// of a non-test file under `src/` and fails on five shapes:
//
//   - nested-quantifier: a group repeated without bound whose body repeats
//     something itself (`(?:[^\[\]]|\[[^\]]*\])+`, `(\s*,\s*x)*`), unless a
//     mandatory delimiter that nothing repeated can match splits it one way;
//   - overlapping-alternation: a group repeated without bound whose
//     alternatives can start with the same character, or one can be empty
//     (`(\w|\d)+`, `(a|)*`);
//   - end-anchored-run: an unbounded run tried from every position of the
//     text and read to its end, because the pattern is anchored only there
//     (`\s+$`, `^x+|[.\s]+$`, `\s*```$`), unless a start anchor comes before it
//     or a mandatory character the run cannot match comes right before it.
//     A group that matches one character, with or without alternatives, is a
//     run like the character itself (`(?:\s)+$`, `(?:a|b)*$`), a group of
//     several characters repeated is one too (`(?:ab)+$`), and a lookahead for
//     the end (`\s+(?=$)`) or a word boundary or lookbehind before the end
//     (`\s+\b$`) does not change that;
//   - adjacent-quantifiers: two unbounded runs side by side, or with only
//     optional parts (or a character both can match) between them, whose
//     characters overlap (`\s*\s*`, `.*.*`, `\s*(.*?)\s*$`, `[^>]*>?[^>]*`,
//     `(?:\s)*\s*x`, `\s*\n([\s\S]*)`);
//   - unclosed-scan: a pattern that starts with a character, has an unbounded
//     run that can match that character, and then something mandatory
//     (`<w:t\b[^>]*>`, `<a>[\s\S]*?<\/a>`): with the closing part missing,
//     every occurrence of the first character starts a read to the end.
//
// What the test guarantees: those shapes, as written in a literal pattern, do
// not appear in backend source outside RATCHET below. RATCHET only shrinks:
// each entry says why it is still there and how many times the pattern appears
// in its file (a new identical expression in a listed file fails), and the test
// fails on an entry whose pattern is gone, so a fixed pattern has to leave the
// list.
//
// What it does not see, and only a cost test of the parser can:
//   - a pattern built at run time (`new RegExp(variable)`, a template with
//     substitutions) and a string passed to `.match()` / `.search()`, which
//     the engine turns into a pattern: such patterns are not read at all (the
//     number of `new RegExp(variable)` is only counted below);
//   - a bounded repetition that is expensive all the same (`\s{1,100000}$`,
//     `(.*a){10}`);
//   - the cost of a backreference (`<(\w+)>\s*([\s\S]*?)\s*<\/\1>`, `(a)\1+$`),
//     which the reader sees as a part it cannot read;
//   - an unbounded run that starts a pattern with no anchor at all and is
//     followed by something that fails (`\s+x`, `\bimage\b.*\bunsupported`): every position
//     is tried and each reads to the end of the run;
//   - a run ended by a group of several alternatives before the `$`
//     (`(?:a|b+)$`), or separated from the next run by such a group;
//   - how large the input is: it reports a shape, not a measured cost, so a
//     listed pattern with "input bounded" is only as good as that statement.
// Every parser of untrusted text still needs its own cost test
// (`expectLinearCost`) and a size limit.

import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { superlinearShapes } from "./helpers/regexShapes";
import { sourceFiles } from "./helpers/sourceDependencies";

let parse: typeof import("@babel/parser", { with: { "resolution-mode": "import" } }).parse;
beforeAll(async () => {
    ({ parse } = await import("@babel/parser"));
});

const SRC = resolve(__dirname, "..");

type Expression = { file: string; source: string; flags: string };

type Ast = { type: string; [key: string]: unknown };

function expressionsOf(file: string): { found: Expression[]; dynamic: number } {
    const code = readFileSync(join(SRC, file), "utf8");
    const ast = parse(code, { sourceType: "unambiguous", plugins: ["typescript"] }) as unknown as Ast;
    const found: Expression[] = [];
    let dynamic = 0;
    const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const n = node as Ast;
        if (n.type === "RegExpLiteral") found.push({ file, source: String(n.pattern), flags: String(n.flags) });
        if ((n.type === "NewExpression" || n.type === "CallExpression") && (n.callee as Ast).type === "Identifier" && (n.callee as { name: string }).name === "RegExp") {
            const [pattern, flags] = n.arguments as Ast[];
            const flagText = flags?.type === "StringLiteral" ? String(flags.value) : "";
            if (pattern?.type === "StringLiteral") found.push({ file, source: String(pattern.value), flags: flagText });
            else if (pattern?.type === "TemplateLiteral" && (pattern.expressions as unknown[]).length === 0)
                found.push({ file, source: String(((pattern.quasis as Ast[])[0].value as { cooked: string }).cooked), flags: flagText });
            else dynamic++;
        }
        for (const [key, value] of Object.entries(n)) if (!["loc", "comments", "tokens"].includes(key)) visit(value);
    };
    visit(ast);
    return { found, dynamic };
}

const FILES = sourceFiles(SRC).map((f) => relative(SRC, f).split(sep).join("/"));

/**
 * Expressions that still hold a flagged shape: the file, the exact source of
 * the pattern, how many times it appears in that file, and why it is still
 * there. The list may only shrink: its length is capped below, an entry whose
 * pattern is gone or no longer flagged fails the test, and so does an entry
 * whose count differs from what the file holds (a new identical expression in
 * a listed file is a new expression). A reason is one of
 *   "pending: file owned by another open change",
 *   "input bounded by <constant>",
 *   "second part of this delivery".
 */
const RATCHET: { file: string; source: string; count: number; reason: string }[] = [
    { file: "lib/mcp/client.ts", source: "^_+|_+$", count: 1, reason: "pending: file owned by another open change (the connector OAuth branch)" },
    { file: "lib/mcp/client.ts", source: "=+$", count: 1, reason: "pending: file owned by another open change (the connector OAuth branch)" },
    { file: "lib/mcp/oauth.ts", source: "\\/+$", count: 1, reason: "pending: file owned by another open change (the connector OAuth branch)" },
    { file: "lib/mcp/types.ts", source: "\\.+$", count: 1, reason: "pending: file owned by another open change (the connector OAuth branch)" },
    { file: "modules/user/user.routes.ts", source: "\\/+$", count: 1, reason: "pending: file owned by another open change (the connector OAuth branch)" },
    { file: "lib/inviteEmail.ts", source: "already.*registered", count: 1, reason: "pending: file owned by another open change (the invited-address sign-up branch)" },
    { file: "lib/llm/cloudProviders.ts", source: "\\/+$", count: 3, reason: "input bounded: a base URL or endpoint is refused over 300 characters (the literal in normalizeCustomBaseUrl and normalizeAzureEndpoint); azureClientTarget reads an endpoint already normalized" },
    { file: "lib/memory/archive.ts", source: "[. ]+$", count: 1, reason: "second part of this delivery: a trim of project names" },
    { file: "lib/llm/toolCallParsing.ts", source: "<(?:tool_call|toolcall)\\b[^>]*>|<\\|tool_call(?:_start)?\\|>", count: 1, reason: "second part of this delivery: the tolerant tool-call parsers" },
    { file: "lib/llm/toolCallParsing.ts", source: "<[｜|]DSML[｜|]invoke\\s+name=[\"']?([^>\"'\\s]+)[\"']?\\s*>([\\s\\S]*?)<\\/[｜|]DSML[｜|]invoke\\s*>", count: 1, reason: "second part of this delivery: the tolerant tool-call parsers" },
    { file: "lib/llm/toolCallParsing.ts", source: "<[｜|]DSML[｜|]parameter\\s+name=[\"']?([^>\"'\\s]+)[\"']?(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/[｜|]DSML[｜|]parameter\\s*>", count: 1, reason: "second part of this delivery: the tolerant tool-call parsers" },
    { file: "lib/llm/toolCallParsing.ts", source: "<function(?:=|\\s+name=[\"'])([^>\"'\\s]+)[\"']?\\s*>", count: 1, reason: "second part of this delivery: the tolerant tool-call parsers" },
    { file: "lib/llm/toolCallParsing.ts", source: "<([a-zA-Z_][\\w.-]*)>\\s*([\\s\\S]*?)\\s*<\\/\\1>", count: 1, reason: "second part of this delivery: the tolerant tool-call parsers" },
    { file: "lib/docxInventory.ts", source: "<w:t(?:\\s[^>]*)?>[^<]*\\S[^<]*<\\/w:t>", count: 1, reason: "second part of this delivery: the Word XML scans" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:t\\b[^>]*?\\/>|<w:t\\b[^>]*>([\\s\\S]*?)<\\/w:t>|<w:(tab|br|cr)\\b[^>]*>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:style\\b([^>]*)>([\\s\\S]*?)<\\/w:style>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:name\\b([^>]*)\\/>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:body\\b[^>]*>([\\s\\S]*?)<\\/w:body>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:(p|tbl)\\b[^>]*>[\\s\\S]*?<\\/w:\\1>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:tr\\b[^>]*>([\\s\\S]*?)<\\/w:tr>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:tc\\b[^>]*>([\\s\\S]*?)<\\/w:tc>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "modules/playbooks/playbooks.word.ts", source: "<w:p\\b[^>]*>[\\s\\S]*?<\\/w:p>", count: 1, reason: "second part of this delivery: Word XML" },
    { file: "lib/observability/diagnostics.ts", source: "\\btools?\\.\\d+|input_schema|invalid schema for function|function parameters|tool[^.]*\\bschema\\b", count: 1, reason: "input bounded by PROVIDER_MESSAGE_CHARS (4,096 characters of the provider's message)" },
    { file: "modules/auth/auth.messages.ts", source: "password .*too (weak|short)", count: 1, reason: "second part of this delivery: classifiers of identity-service error messages (their length is not bounded here)" },
    { file: "lib/webSearch/pageReader.ts", source: "<meta[^>]+charset\\s*=\\s*[\"']?\\s*([\\w.:-]+)", count: 1, reason: "input bounded by the first 1,024 bytes of a page (metaCharset)" },
    { file: "modules/client-profile/client-profile.dates.ts", source: "^(\\d{1,2})\\s*(?:o|º|°)?\\s+de\\s+([a-záéíóú]+)\\s+(?:de|del)\\s+(\\d{4})$", count: 1, reason: "input bounded by VALUE_MAX (1,000 characters) in client-profile.extract.shared.ts" },
    { file: "modules/client-profile/client-profile.dates.ts", source: "(\\d{1,4})\\s*\\)?\\s*d[ií]as?(?:\\s+(h[aá]biles|naturales|calendario))?", count: 1, reason: "input bounded by VALUE_MAX (1,000 characters) in client-profile.extract.shared.ts" },
    { file: "lib/workflowCatalogSource.ts", source: "^---\\n([\\s\\S]*?)\\n---(?:\\n|$)([\\s\\S]*)$", count: 1, reason: "input bounded by MAX_FILE_BYTES (5 MiB), a file of a pinned catalog archive" },
    { file: "modules/radar/radar.rules.ts", source: "^https:\\/\\/[^\\s/]+\\.[^\\s/]+", count: 1, reason: "input bounded: a citation url of the bundled rule catalog, not user text" },
];
const RATCHET_MAX_ENTRIES = 29;
// Patterns built at run time (`new RegExp(variable)`) are not read; their number is fixed here so a new one is a decision.
const DYNAMIC_PATTERNS = 18;

/** Every flagged pattern, once, with how many times it appears in its file. */
const flagged = (): { key: string; file: string; source: string; kinds: string[]; count: number }[] => {
    const byKey = new Map<string, { key: string; file: string; source: string; kinds: string[]; count: number }>();
    for (const file of FILES) {
        for (const { source, flags } of expressionsOf(file).found) {
            const shapes = superlinearShapes(source, flags);
            if (!shapes.length) continue;
            const key = `${file} :: ${source}`;
            const known = byKey.get(key);
            if (known) known.count++;
            else byKey.set(key, { key, file, source, kinds: shapes.map((s) => `${s.kind}: ${s.detail}`), count: 1 });
        }
    }
    return [...byKey.values()];
};

describe("the shape reader", () => {
    const kinds = (source: string, flags = "") => [...new Set(superlinearShapes(source, flags).map((s) => s.kind))];

    it("flags a repeated group that repeats inside", () => {
        expect(kinds("(a+)+")).toEqual(["nested-quantifier"]);
        expect(kinds("^(?:[^\\[\\]]|\\[[^\\]]*\\])+$")).toContain("nested-quantifier");
        expect(kinds("(?:a{2,})*")).toContain("nested-quantifier");
        expect(kinds("(\\s*,\\s*)*")).toContain("nested-quantifier");
        expect(kinds("(?:a+a)+")).toContain("nested-quantifier");
    });
    it("flags a repeated group whose alternatives can start alike", () => {
        expect(kinds("(a|a)*")).toEqual(["overlapping-alternation"]);
        expect(kinds("(?:\\w|\\d)+")).toEqual(["overlapping-alternation"]);
        expect(kinds("(?:a|)+")).toEqual(["overlapping-alternation"]);
        expect(kinds("(?:ab|a)+")).toEqual(["overlapping-alternation"]);
        expect(kinds("(?:x|[a-z])*")).toEqual(["overlapping-alternation"]);
        expect(kinds("(?:a|A)*", "i")).toEqual(["overlapping-alternation"]);
    });
    it("flags a run anchored only at the end of the text", () => {
        for (const source of ["\\s+$", "x*$", "[ \\t]+$", "\\.+$", "\\/+$", "[. ]+$", "[.\\s]+$", "foo.*$", "\\s*```$", "-\\s*\\s*$"]) {
            expect(kinds(source), source).toContain("end-anchored-run");
        }
        // Inside an alternative that has no start anchor of its own.
        expect(kinds("^[-*•\\s]+|[.\\s]+$")).toEqual(["end-anchored-run"]);
        expect(kinds("^[\"'`]+|[\"'`.,:;!?]+$")).toEqual(["end-anchored-run"]);
        expect(kinds("^a|(?:b|c)|\\s+$")).toEqual(["end-anchored-run"]);
        // The start anchor of another line does not fix the start.
        expect(kinds("^\\s+$", "m")).toContain("end-anchored-run");
    });
    it("leaves a run that is anchored at the start, bounded, or stopped by what comes before it", () => {
        for (const source of ["^\\s+$", "^a*b+$", "^x\\s*$", "^(?:a|b+$)", "^-?\\d+$", "\\s{1,5}$", "a\\s*$", "\\.[a-z]+$", "(?:foo|bar)\\s*$", ",[^,]*$", "\\s+x", "^\\s+"]) {
            expect(kinds(source), source).not.toContain("end-anchored-run");
        }
    });
    it("flags two runs side by side that can match the same characters", () => {
        for (const source of ["\\s*\\s*", ".*.*", "\\s*(.*?)\\s*$", "[^>]*>?[^>]*", "\\d+\\.?\\d*", "\\s+\\S*\\s+", "a*(?:b)?a*", "\\s*\\n([\\s\\S]*)\\n", "^name:\\s*(.*?)\\s*$", "=\\s*[\"']?\\s*x"]) {
            expect(kinds(source), source).toContain("adjacent-quantifiers");
        }
        expect(kinds("\\s*\\s*", "u")).toContain("adjacent-quantifiers");
    });
    it("leaves runs a mandatory character or a disjoint set keeps apart", () => {
        for (const source of ["\\s*,\\s*", "[a-z]+\\d+", "a+b+", "\\s*x\\s*", "[^>]*>[^>]*", "\\w+\\s*=", "(?:ab)+c*", "\\d*\\.\\d*", "\\s+\\S+\\s+", "a{2,5}a*"]) {
            expect(kinds(source), source).not.toContain("adjacent-quantifiers");
        }
    });
    it("leaves alternatives that start differently, bounded repeats and plain quantifiers", () => {
        expect(kinds("(?:\\\\.|[^\\\\\"])*")).toEqual([]);
        expect(kinds("(?:ab)+")).toEqual([]);
        expect(kinds("(?:a|b)*")).toEqual([]);
        expect(kinds("(?:a+){2}")).toEqual([]);
        expect(kinds("(a+)?")).toEqual([]);
        expect(kinds("[a-z]+(?:-[a-z]+)?")).toEqual([]);
        expect(kinds("(?:a+b)+")).toEqual([]);
        expect(kinds("(?<=\\W)on[a-z]+\\s*=")).toEqual([]);
        expect(kinds("\\{(\\d+)(?:(,)(\\d*))?\\}")).toEqual([]);
    });
    it("leaves a repeated group split one way by a mandatory delimiter the repeated parts cannot match", () => {
        expect(kinds("^[a-z0-9]+(?:-[a-z0-9]+)*$")).toEqual([]);
        expect(kinds("^(?:[a-z0-9-]{0,61}\\.)+[a-z]+$")).toEqual([]);
        expect(kinds("(?:[a-z]+\\u0101)+")).toEqual([]);
        expect(kinds("(?:\\p{L}+-)+", "u")).toEqual([]);
        expect(kinds("(?:\\d+\\u00e9)+")).toEqual([]);
    });
    it("does not take as a delimiter what the repeated part can also match", () => {
        // Characters past ASCII, class escapes, case folding, a pair of surrogates, a backreference.
        for (const [source, flags] of [
            ["(?:.+\\u0101)+", ""],
            ["(?:[^a]+\\u0101)+", ""],
            ["(?:\\p{L}+\\u0101)+", "u"],
            ["(?:\\S+\\u3042)+", ""],
            ["(?:.+\\ud83d\\ude00)+", ""],
            ["(?:.+\\u{1f600})+", "u"],
            ["(?:(a)[a-z]+\\1)+", ""],
            ["(?:(a)[a-z]+\\1)+", "u"],
            ["(a)(?:-[b-z]+\\1*)+", ""],
            ["(?<d>a)(?:-[b-z]+\\k<d>*)+", ""],
            ["(?:[a-z]+K)+", "i"],
            ["(?:[a-z]+\\u212a)+", "iu"],
            ["(?:[^\\\\]+[\\\\x])+", ""],
        ] as const) {
            expect(kinds(source, flags), `${source} /${flags}`).toContain("nested-quantifier");
        }
    });
    it("sees through a group, a lookahead for the end and a boundary around a run", () => {
        // Each of these is as slow as its bare form.
        for (const source of ["(?:\\s)+$", "(\\s)*$", "(?:a|b)*$", "(?:[ \\t]|\\n)+$", "(?:(?:\\s))+$", "(?:ab)+$", "(?:foo|bar)*$", "\\s+(?=$)", "\\s+\\b$", "\\s+(?<=\\s)$"]) {
            expect(kinds(source), source).toContain("end-anchored-run");
        }
        for (const source of ["(?:\\s)*\\s*x", "(\\s)+\\s*", "(?:a|b)*(?:b|c)*", "\\s*(?:,|\\s)\\s*x"]) {
            expect(kinds(source), source).toContain("adjacent-quantifiers");
        }
    });
    it("leaves a wrapped run that a start anchor, a bound or a disjoint character keeps in check", () => {
        for (const source of ["^(?:\\s)+$", "(?:a|b)*", "(?:\\s){1,5}$", "x(?:a|b)*$", "(?:a|b)*(?:c|d)*", "(?:ab)+", "\\s+(?=x)", "(?:\\s)*x\\s*"]) {
            expect(kinds(source), source).toEqual([]);
        }
    });
    it("flags a pattern whose run can contain its own first character and is followed by something mandatory", () => {
        for (const source of ["<a>[\\s\\S]*?<\\/a>", "<w:t\\b[^>]*>", "\\[[^\\]]*\\]", "<(\\w+)>.*<\\/\\1>"]) {
            expect(kinds(source), source).toContain("unclosed-scan");
        }
        for (const source of ["\"[^\"]*\"", "^<a>.*<\\/a>", "<[^<]*>", "x[^>]*", "a[^b]*b?"]) {
            expect(kinds(source), source).not.toContain("unclosed-scan");
        }
    });
    it("flags the shapes of the patterns that read model answers and stored text before they were replaced by scans", () => {
        // Each is a pattern that read a model's answer or a stored text and was replaced by a linear scan.
        const earlier: [string, string, string, string][] = [
            ["a fence around an array", "^```[a-zA-Z]*\\s*([\\s\\S]*?)\\s*```$", "", "adjacent-quantifiers"],
            ["a labelled line", "^\\s*[*_`]*\\s*(veredicto|fundamento)\\s*[*_`]*\\s*:\\s*[*_`]*\\s*(.*?)\\s*[*_`]*\\s*$", "i", "adjacent-quantifiers"],
            ["a fenced json block", "^```(?:json)?\\s*\\n([\\s\\S]*)\\n```$", "i", "adjacent-quantifiers"],
            ["a tagged block", "<EDITS>\\s*([\\s\\S]*?)\\s*<\\/EDITS>", "gi", "adjacent-quantifiers"],
            ["the quotes of a title", "^[\"'`]+|[\"'`.,:;!?]+$", "g", "end-anchored-run"],
            ["a closing fence", "\\s*```$", "i", "end-anchored-run"],
            ["a link attribute", "<[^>]+\\b(?:href|src|xlink:href)\\s*=\\s*[\"']?\\s*(?:javascript\\s*:|data\\s*:\\s*text\\/html)", "i", "adjacent-quantifiers"],
            ["trailing blanks", "[ \\t]+$", "", "end-anchored-run"],
            ["a name line", "^name:\\s*(.*?)\\s*$", "", "adjacent-quantifiers"],
            ["a citation marker", "\\[\\[((?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\]", "g", "nested-quantifier"],
        ];
        for (const [what, source, flags, kind] of earlier) expect(kinds(source, flags), what).toContain(kind);
    });
});

describe("backend source holds no super-linear regular expression shape", () => {
    it("has no flagged expression outside the ratchet list", () => {
        const listed = new Set(RATCHET.map((entry) => `${entry.file} :: ${entry.source}`));
        const offenders = flagged()
            .filter((hit) => !listed.has(hit.key))
            .map((hit) => `${hit.key}\n    ${hit.kinds.join("\n    ")}`);
        expect(offenders, "scan the text with lib/modelJsonFence.ts (a trim: trim(), trimEnd(), trimChars), or add the pattern to RATCHET with the reason").toEqual([]);
    });

    it("counts the patterns built at run time", () => {
        const dynamic = FILES.reduce((total, file) => total + expressionsOf(file).dynamic, 0);
        expect(dynamic, "a pattern built at run time is not read by this test: review it, then change DYNAMIC_PATTERNS").toBe(DYNAMIC_PATTERNS);
    });

    it("keeps every ratchet entry alive, counted, explained, and the list from growing", () => {
        const live = new Map(flagged().map((hit) => [hit.key, hit.count]));
        const stale = RATCHET.filter((entry) => !live.has(`${entry.file} :: ${entry.source}`)).map((entry) => `${entry.file} :: ${entry.source}`);
        expect(stale, "remove entries whose expression is gone or no longer flagged").toEqual([]);
        const miscounted = RATCHET.filter((entry) => live.get(`${entry.file} :: ${entry.source}`) !== entry.count).map(
            (entry) => `${entry.file} :: ${entry.source} appears ${live.get(`${entry.file} :: ${entry.source}`)} times, the list says ${entry.count}`,
        );
        expect(miscounted, "a listed pattern appears a different number of times: a new identical expression is a new expression").toEqual([]);
        expect(RATCHET.filter((entry) => entry.reason.trim().length < 20)).toEqual([]);
        expect(RATCHET.length, "the list only shrinks: lower RATCHET_MAX_ENTRIES with it").toBeLessThanOrEqual(RATCHET_MAX_ENTRIES);
    });
});
