import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { TOUCH_TARGET_CLASS } from "@mike/ui";
import { describe, expect, it } from "vitest";

describe("TOUCH_TARGET_CLASS", () => {
    it("only grows the tappable area for a coarse pointer", async () => {
        const base = resolve(process.cwd(), "src/app");
        const compiler = await compile(
            readFileSync(join(base, "globals.css"), "utf8"),
            { base, onDependency: () => {} },
        );
        const css = compiler.build(TOUCH_TARGET_CLASS.split(" "));
        // Every rule that makes the 44 px square sits inside the media query.
        expect(css).toContain("@media (pointer: coarse)");
        expect(css).toMatch(/width: calc\(var\(--spacing\) \* 11\)/);
        const start = css.indexOf("@media (pointer: coarse)");
        const end = css.indexOf("\n  }\n", start);
        const inside = css.slice(start, end);
        for (const rule of css.match(/\.pointer-coarse[^{]*\{/g) ?? []) {
            expect(inside).toContain(rule);
        }
    });
});
