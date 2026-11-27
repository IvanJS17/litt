// Every caller of extractRowColumns names the person's check for the row, and
// builds it with the one shared function. The required argument of the type
// already stops a call that leaves it out; this stops a call that passes a
// check of its own (or one that always says yes) from slipping in beside it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");
const TABULAR = join(SRC, "modules", "tabular");

function productionFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "__tests__" ? [] : productionFiles(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The argument object text of every `extractRowColumns({ ... })` call in a source text. */
function callArguments(source: string): string[] {
    const code = stripComments(source);
    const found: string[] = [];
    for (const match of code.matchAll(/\bextractRowColumns\s*\(\s*\{/g)) {
        let depth = 1;
        let end = (match.index ?? 0) + match[0].length;
        while (depth > 0 && end < code.length) {
            const char = code[end++];
            if (char === "{") depth += 1;
            if (char === "}") depth -= 1;
        }
        found.push(code.slice((match.index ?? 0) + match[0].length - 1, end));
    }
    return found;
}

/** A call is acceptable when its check comes from the shared function, directly or through a local named for it. */
function leavesOutTheCheck(source: string): boolean {
    const code = stripComments(source);
    const calls = callArguments(source);
    return calls.some((call) => !/\bmayReadRow\b/.test(call)) || (calls.length > 0 && !/\bcreateRowReadCheck\s*\(/.test(code));
}

describe("callers of extractRowColumns", () => {
    it("pass a check built by createRowReadCheck, in every file of the tabular module", () => {
        const offenders = productionFiles(TABULAR)
            .filter((file) => !file.endsWith("tabular.extractRow.ts"))
            .filter((file) => leavesOutTheCheck(readFileSync(file, "utf8")))
            .map((file) => relative(SRC, file));
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

    it("are recognised: a call without the check, or with a check of its own, is flagged", () => {
        expect(leavesOutTheCheck("await extractRowColumns({ db, row });")).toBe(true);
        expect(leavesOutTheCheck("await extractRowColumns({ db, row, mayReadRow: async () => true });")).toBe(true);
        expect(leavesOutTheCheck("const mayReadRow = createRowReadCheck({ db });\nawait extractRowColumns({ db, row, mayReadRow });")).toBe(false);
        expect(leavesOutTheCheck("// extractRowColumns({ db })\nconst x = 1;")).toBe(false);
    });
});
