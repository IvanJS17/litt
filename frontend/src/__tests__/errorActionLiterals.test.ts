// The `action` given to notifyError / describeError / reportFault becomes the
// title of the failure toast ("No fue posible {action}"). A fixed English
// phrase there yields a half-Spanish sentence, so it must come from the
// catalog (`errors.action.*`, through clientTranslator()).

import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "../../../scripts/i18n/literals.mjs";

const REPO = resolve(__dirname, "../../..");
const APP = join(REPO, "frontend/src/app");

const REPORTS_ERRORS = /\b(notifyError|describeError|reportFault|notifyPartialFailure)\b/;
// `action: "..."`, `action: '...'` or a template literal with prose in it.
const LITERAL_ACTION = /\baction:\s*(["'`])(?!\s*\|)[^"'`]*[a-zA-Z]/g;

function offenders(source: string): string[] {
    if (!REPORTS_ERRORS.test(source)) return [];
    return [...source.matchAll(LITERAL_ACTION)].map((m) => m[0]);
}

describe("failure toasts: the action comes from the catalog", () => {
    it("no source passes a hand-written phrase as `action`", () => {
        const found: Record<string, string[]> = {};
        for (const abs of sourceFiles(APP)) {
            if (/\.test\.tsx?$/.test(abs)) continue;
            const hits = offenders(readFileSync(abs, "utf8"));
            if (hits.length) found[relative(REPO, abs).split(sep).join("/")] = hits;
        }
        expect(found, 'Use clientTranslator()("errors.action.…") instead of a literal').toEqual({});
    });

    it("the scan flags a literal and accepts a catalog lookup", () => {
        expect(offenders('notifyError(e, { action: "save your acceptance" })')).toHaveLength(1);
        expect(offenders("notifyError(e, { action: `add ${name}` })")).toHaveLength(1);
        expect(offenders('notifyError(e, { action: clientTranslator()("errors.action.x") })')).toEqual([]);
    });
});
