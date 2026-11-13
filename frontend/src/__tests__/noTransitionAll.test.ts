import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "../../../scripts/i18n/literals.mjs";

// `transition-all` animates every property that changes, layout ones included,
// and on a slow phone that is a stutter. Name what moves: transition-colors,
// or transition-[width,transform].
const REPO = resolve(__dirname, "../../..");
const ROOTS = ["frontend/src", "packages/ui/src", "word-addin/src"];
const CLASS_USE = /(^|[\s"'`])transition-all(?=[\s"'`])/m;

describe("transitions", () => {
    it("no class list says transition-all", () => {
        const offenders: string[] = [];
        for (const root of ROOTS)
            for (const abs of sourceFiles(join(REPO, root))) {
                if (/\.test\.tsx?$/.test(abs)) continue;
                const code = readFileSync(abs, "utf8")
                    .split("\n")
                    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
                    .join("\n");
                if (CLASS_USE.test(code)) offenders.push(relative(REPO, abs).split(sep).join("/"));
            }
        expect(offenders).toEqual([]);
    });
});
