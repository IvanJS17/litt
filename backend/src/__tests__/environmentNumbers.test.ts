import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Numeric settings are read by one reader (lib/runtimeConfig.ts), which takes
// only a whole number in plain digits. `parseInt` takes the leading digits of
// anything ("10,000" is 10), so a file that reads the environment must not use
// it (nor `parseFloat`). A file is an offender when it reads the environment and
// has such a line that does not parse a request's query string.

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "__tests__") walk(full, out);
        } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
    }
    return out;
}

const READS_ENVIRONMENT = /process\.env|process\[["']env["']\]|NodeJS\.ProcessEnv|from "node:process"/;
const PARSE_INT = /\bparse(?:Int|Float)\(/;
const QUERY_STRING = /\breq\.query\b/;

describe("numeric settings", () => {
    it("are not read with parseInt or parseFloat in a file that reads the environment", () => {
        const offenders = walk(SRC)
            .filter((file) => {
                const text = readFileSync(file, "utf8");
                return (
                    READS_ENVIRONMENT.test(text) &&
                    text.split("\n").some((line) => PARSE_INT.test(line) && !QUERY_STRING.test(line))
                );
            })
            .map((file) => relative(SRC, file).split(sep).join("/"))
            .sort();
        expect(offenders).toEqual([]);
    });
});
