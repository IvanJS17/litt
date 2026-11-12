// @vitest-environment node
// How scripts/i18n finds TypeScript: explicitly from frontend/, and with a
// clear message (not a stack trace) when it is missing or the wrong major.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadTypeScript, ts, visibleLiterals } from "./literals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("loadTypeScript", () => {
    let dir;
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

    const frontendWith = (version) => {
        dir = mkdtempSync(join(tmpdir(), "i18n-ts-test-"));
        if (version) {
            const pkg = join(dir, "frontend/node_modules/typescript");
            mkdirSync(pkg, { recursive: true });
            writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "typescript", version, main: "index.js" }));
            writeFileSync(join(pkg, "index.js"), `module.exports = { fake: ${JSON.stringify(version)} };`);
        } else mkdirSync(join(dir, "frontend"), { recursive: true });
        return join(dir, "frontend");
    };

    it("loads the TypeScript 5 of this repository's frontend", () => {
        expect(ts.version.split(".")[0]).toBe("5");
        expect(loadTypeScript().version).toBe(ts.version);
    });

    it("accepts any 5.x from the directory it is given", () => {
        expect(loadTypeScript(frontendWith("5.9.3"))).toEqual({ fake: "5.9.3" });
    });

    it("says to run npm ci --prefix frontend when TypeScript is missing", () => {
        expect(() => loadTypeScript(frontendWith(null))).toThrow(/TypeScript not found.*npm ci --prefix frontend/);
    });

    it("says what it found, and what to run, when the major version is not 5", () => {
        expect(() => loadTypeScript(frontendWith("7.0.0"))).toThrow(/found TypeScript 7\.0\.0.*npm ci --prefix frontend/);
    });

    it("the CLI exits 1 with that one line, not a stack trace, when frontend has no TypeScript", () => {
        dir = mkdtempSync(join(tmpdir(), "i18n-ts-cli-"));
        cpSync(HERE, join(dir, "scripts/i18n"), { recursive: true });
        mkdirSync(join(dir, "frontend"), { recursive: true });
        const result = spawnSync(process.execPath, [join(dir, "scripts/i18n/extract.mjs"), "--ns", "demo", "--prune"], {
            encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^extract: TypeScript not found: .*`npm ci --prefix frontend`\n$/);
        expect(result.stderr).not.toContain("    at ");
    });
});

describe("visibleLiterals: a lone word with a trailing ellipsis", () => {
    const literals = (expr) =>
        visibleLiterals("Demo.tsx", `export const Demo = ({ busy }: { busy: boolean }) => <button>{${expr}}</button>;`);

    it("flags \"Saving...\" and \"Saving\u2026\" like \"Saving\"", () => {
        expect(literals('busy ? "Saving..." : "Save"')).toEqual(["Saving...", "Save"]);
        expect(literals('busy ? "Saving\u2026" : "Save"')).toEqual(["Saving\u2026", "Save"]);
        expect(literals('busy ? "Saving" : "Save"')).toEqual(["Saving", "Save"]);
    });

    it("still skips a bare ellipsis and technical tokens", () => {
        expect(literals('busy ? "..." : "\u2026"')).toEqual([]);
        expect(literals('busy ? "saving..." : "SAVE_NOW"')).toEqual([]);
    });
});

describe("visibleLiterals: a catalog key kept in a table is not visible text", () => {
    const literals = (source) => visibleLiterals("Demo.tsx", source);

    it("skips a dotted camelCase key in a label field, so a table of keys needs no allowance", () => {
        expect(literals('export const ROWS = [{ label: "settings.layout.tab.account", title: "organizations.organizationPrivacyData.deleteRows.chats.title" }];')).toEqual([]);
    });

    it("still flags a sentence, a single word and a short dotted phrase", () => {
        expect(literals('export const ROWS = [{ label: "Account settings" }, { label: "Account" }, { title: "Done. Really." }];')).toEqual([
            "Account settings",
            "Account",
            "Done. Really.",
        ]);
    });
});
