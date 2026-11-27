// Every caller of extractRowColumns names the person's check for the row, and
// builds it with the one shared function. The required argument of the type
// already stops a call that leaves it out; this stops a call that passes a
// check of its own (an inline function, any other expression) from slipping in
// beside it.
//
// What this reading of the source CAN show: every call passes an object
// literal whose `mayReadRow` is either a direct `createRowReadCheck(` call or a
// name that its file assigns only from `createRowReadCheck(`; nothing else
// assigns `mayReadRow`; and `createRowReadCheck` is built only in the files
// listed below.
//
// What it CANNOT see: that the user id (and address) handed to
// `createRowReadCheck` is the run's person and not someone else. A text scan
// cannot know who that is. The behavioural tests of each caller pin it, by
// taking a document away from the run's person and asserting the row is left
// out: tabular.rowAccess.test.ts (the synchronous run),
// workers/__tests__/extractionWorker.rowAccess.test.ts (the queued row job)
// and tabular.cells.rowAccess.test.ts (the request-side single cell).
//
// It also goes by the NAME `createRowReadCheck`: a file that declared something
// else under that name would pass here (the same behavioural tests pin that),
// and the shared function imported under another name is refused.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");
const TABULAR = join(SRC, "modules", "tabular");

/** Files that build a row check, each for the reason given. */
const BUILDERS = {
    "lib/tabularReadAccess.ts": "defines it",
    "modules/tabular/tabular.cells.ts": "the request-side single cell asks the question itself",
    "modules/tabular/tabular.extraction.ts": "calls extractRowColumns (queued row job)",
    "modules/tabular/tabular.generateStream.ts": "calls extractRowColumns (synchronous run)",
};

function productionFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "__tests__" ? [] : productionFiles(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The text from an opening bracket at `start` to its match (inclusive), or null. */
function balanced(code: string, start: number): string | null {
    const open = code[start];
    const close = ({ "{": "}", "(": ")", "[": "]" } as Record<string, string>)[open];
    if (!close) return null;
    let depth = 0;
    for (let at = start; at < code.length; at += 1) {
        if ("{([".includes(code[at])) depth += 1;
        if ("})]".includes(code[at])) depth -= 1;
        if (depth === 0) return code.slice(start, at + 1);
    }
    return null;
}

/** What follows each `extractRowColumns(` in a source text: the object literal, or null when the argument is anything else. */
function callArguments(source: string): (string | null)[] {
    const code = stripComments(source);
    return [...code.matchAll(/\bextractRowColumns\s*\(\s*/g)]
        .filter((match) => !/\b(?:function|async function)\s+$/.test(code.slice(0, match.index)))
        .map((match) => {
            const at = (match.index ?? 0) + match[0].length;
            return code[at] === "{" ? balanced(code, at) : null;
        });
}

/** The value given to `name` at the top level of an object literal: "shorthand", its text, or null when absent. Spreads make it unknowable. */
function propertyValue(literal: string, name: string): { values: string[]; spread: boolean } {
    const inner = literal.slice(1, -1);
    const values: string[] = [];
    let spread = false;
    let depth = 0;
    let begin = 0;
    const parts: string[] = [];
    for (let at = 0; at <= inner.length; at += 1) {
        const char = inner[at];
        if (char && "{([".includes(char)) depth += 1;
        else if (char && "})]".includes(char)) depth -= 1;
        else if ((char === "," && depth === 0) || at === inner.length) {
            parts.push(inner.slice(begin, at).trim());
            begin = at + 1;
        }
    }
    for (const part of parts) {
        if (part.startsWith("...")) spread = true;
        else if (part === name) values.push("shorthand");
        else if (new RegExp(`^${name}\\s*:`).test(part)) values.push(part.replace(new RegExp(`^${name}\\s*:\\s*`), ""));
    }
    return { values, spread };
}

/** True when `expression` is one call of the shared function and nothing more. */
const isSharedCall = (expression: string) =>
    /^createRowReadCheck\s*\(/.test(expression) && balanced(expression, expression.indexOf("(")) === expression.slice(expression.indexOf("("));

/** True when every assignment `name = ...` in the code is a call of the shared function (and there is at least one). */
function assignedOnlyFromSharedCall(code: string, name: string): boolean {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const assignments = [...code.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*(?::[^=;(){}]+)?=(?![=>])\\s*`, "g"))];
    return (
        assignments.length > 0 &&
        assignments.every((match) => {
            const rest = code.slice((match.index ?? 0) + match[0].length);
            const end = rest.search(/;\s*\n|\n\s*\n/);
            return isSharedCall(rest.slice(0, end === -1 ? undefined : end).trim());
        })
    );
}

/** What is wrong with the way a source text calls extractRowColumns, if anything. */
function problemsWithCalls(source: string): string[] {
    const code = stripComments(source);
    const problems: string[] = [];
    for (const literal of callArguments(source)) {
        if (literal === null) {
            problems.push("the argument is not an object literal");
            continue;
        }
        const { values, spread } = propertyValue(literal, "mayReadRow");
        if (spread) problems.push("a spread could carry the check");
        if (values.length !== 1) {
            problems.push("mayReadRow is not named exactly once");
            continue;
        }
        const [value] = values;
        if (value === "shorthand") {
            if (!assignedOnlyFromSharedCall(code, "mayReadRow")) problems.push("mayReadRow is not assigned only from createRowReadCheck");
        } else if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) {
            if (!assignedOnlyFromSharedCall(code, value)) problems.push(`${value} is not assigned only from createRowReadCheck`);
        } else if (!isSharedCall(value)) problems.push("mayReadRow is not built by createRowReadCheck");
    }
    return problems;
}

/** Every assignment or property named mayReadRow whose value is not the shared function's call or a plain name. */
function strayChecks(source: string): string[] {
    const code = stripComments(source);
    const stray: string[] = [];
    for (const match of code.matchAll(/\bmayReadRow\s*(=(?![=>])|:)\s*/g)) {
        if (match[1] === ":" && /\?\s*$/.test(code.slice(Math.max(0, (match.index ?? 0) - 2), match.index))) continue;
        const rest = code.slice((match.index ?? 0) + match[0].length);
        const end = rest.search(/[,;\n}]/);
        const value = rest.slice(0, end === -1 ? undefined : end).trim();
        const plainName = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
        if (!plainName && !/^createRowReadCheck\s*\(/.test(value)) stray.push(value);
    }
    return stray;
}

describe("callers of extractRowColumns", () => {
    it("pass an object literal whose mayReadRow comes only from createRowReadCheck, in every file of the tabular module", () => {
        const offenders = productionFiles(TABULAR)
            .filter((file) => !file.endsWith("tabular.extractRow.ts"))
            .map((file) => [relative(SRC, file), problemsWithCalls(readFileSync(file, "utf8"))] as const)
            .filter(([, problems]) => problems.length > 0);
        expect(offenders).toEqual([]);
    });

    it("are the only readers of a row's text, with the request's single-cell regenerate asking the same question", () => {
        const readers = productionFiles(TABULAR)
            .filter((file) => !file.endsWith("tabular.rows.ts"))
            .filter((file) => /\bloadRowDocumentText\s*\(/.test(stripComments(readFileSync(file, "utf8"))));
        expect(readers.map((file) => relative(SRC, file)).sort()).toEqual([
            "modules/tabular/tabular.cells.ts",
            "modules/tabular/tabular.extractRow.ts",
        ]);
        for (const file of readers) expect(readFileSync(file, "utf8"), file).toMatch(/createRowReadCheck\(|args\.mayReadRow/);
    });

    it("are found in the tabular module only", () => {
        const callers = productionFiles(SRC)
            .filter((file) => !file.endsWith("tabular.extractRow.ts"))
            .filter((file) => callArguments(readFileSync(file, "utf8")).length > 0)
            .map((file) => relative(SRC, file))
            .sort();
        expect(callers).toEqual(["modules/tabular/tabular.extraction.ts", "modules/tabular/tabular.generateStream.ts"]);
    });

    it("are the only code that builds a row check, apart from the listed files, and nothing else is given as mayReadRow", () => {
        const builders = productionFiles(SRC)
            .filter((file) => /\bcreateRowReadCheck\b/.test(stripComments(readFileSync(file, "utf8"))))
            .map((file) => relative(SRC, file))
            .sort();
        expect(builders).toEqual(Object.keys(BUILDERS).sort());

        const strays = productionFiles(SRC)
            .filter((file) => !file.endsWith("tabular.extractRow.ts"))
            .map((file) => [relative(SRC, file), strayChecks(readFileSync(file, "utf8"))] as const)
            .filter(([, values]) => values.length > 0);
        expect(strays).toEqual([]);
    });

    it("are recognised: a call without the check, or with one of its own, is flagged", () => {
        const flagged = (text: string) => problemsWithCalls(text).length > 0;
        const built = "const mayReadRow = createRowReadCheck({ db });\n";
        expect(flagged("await extractRowColumns({ db, row });")).toBe(true);
        expect(flagged("await extractRowColumns({ db, row, mayReadRow: async () => true });")).toBe(true);
        expect(flagged("await extractRowColumns({ db, row, mayReadRow: () => Promise.resolve(true) });")).toBe(true);
        expect(flagged("await extractRowColumns(args);")).toBe(true);
        expect(flagged("await extractRowColumns({ ...rest, mayReadRow });")).toBe(true);
        expect(flagged("const mayReadRow = async () => true;\nawait extractRowColumns({ db, row, mayReadRow });")).toBe(true);
        expect(flagged(`${built}let mayReadRow2 = 1;\nmayReadRow = async () => true;\nawait extractRowColumns({ db, mayReadRow });`)).toBe(true);
        expect(flagged(`${built}await extractRowColumns({ db, row, mayReadRow });`)).toBe(false);
        expect(flagged(`const check = createRowReadCheck({ db });\nawait extractRowColumns({ db, row, mayReadRow: check });`)).toBe(false);
        expect(flagged("await extractRowColumns({ db, mayReadRow: createRowReadCheck({ db, userId }) });")).toBe(false);
        expect(flagged("await extractRowColumns({ db, mayReadRow: createRowReadCheck({ db }) || (async () => true) });")).toBe(true);
        expect(flagged("// extractRowColumns({ db })\nconst x = 1;")).toBe(false);
        expect(strayChecks("const o = { mayReadRow: async () => true };")).not.toEqual([]);
        expect(strayChecks("mayReadRow = async () => true;")).not.toEqual([]);
        expect(strayChecks("const mayReadRow = createRowReadCheck({ db });")).toEqual([]);
    });
});
