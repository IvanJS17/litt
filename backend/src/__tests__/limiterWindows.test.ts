// Every rate limiter takes its window through the shared helpers, which keep
// it within what the limiter can hold. A window written any other way fails
// here: bring it through `minutes()` or `hours()` of lib/limiterWindow.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
            return name === "__tests__" || name === "node_modules" ? [] : sources(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
}

const KEY = /^\s*(?:windowMs|"windowMs"|'windowMs')\s*:/;

/** The lines that give a limiter its window in a file that builds limiters (a type's field aside). */
function windowLines(text: string): string[] {
    if (!/from "express-rate-limit"/.test(text)) return [];
    return text
        .split("\n")
        .filter((line) => KEY.test(line) && !/^\s*["']?windowMs["']?\s*:\s*number;\s*$/.test(line));
}

/** The whole value is one call of a helper, or the window the builder was given: nothing is added, multiplied or chosen around it. */
const ALLOWED = {
    test(line: string): boolean {
        const value = line.replace(KEY, "").trim();
        if (/^options\.windowMs,$/.test(value)) return true;
        const call = /^(?:minutes|hours)\(/.exec(value);
        if (!call || !value.endsWith("),")) return false;
        let depth = 0;
        for (let i = call[0].length - 1; i < value.length - 1; i++) {
            if (value[i] === "(") depth++;
            else if (value[i] === ")" && --depth === 0) return i === value.length - 2;
        }
        return false;
    },
};

describe("rate-limit windows", () => {
    it("come through the shared helpers in every file that builds a limiter", () => {
        const offenders = sources(SRC).flatMap((path) =>
            windowLines(readFileSync(path, "utf8"))
                .filter((line) => !ALLOWED.test(line))
                .map((line) => `${relative(SRC, path)}: ${line.trim()}`),
        );
        expect(offenders).toEqual([]);
    });

    it("finds the limiters it is meant to watch", () => {
        const watched = sources(SRC).filter((path) => windowLines(readFileSync(path, "utf8")).length > 0);
        expect(watched.map((path) => relative(SRC, path)).sort()).toEqual([
            "app.ts",
            "modules/client-profile/client-profile.routes.ts",
            "modules/radar/radar.routes.ts",
            "modules/uploads/uploads.routes.ts",
        ]);
    });

    it("refuses a window multiplied in place", () => {
        const text = 'import rateLimit from "express-rate-limit";\nrateLimit({\n  windowMs: envInt("X", 15) * 60 * 1000,\n});\n';
        expect(windowLines(text).filter((line) => !ALLOWED.test(line))).toHaveLength(1);
    });

    it("sees a window written with the other quote style", () => {
        const text = 'import rateLimit from "express-rate-limit";\nrateLimit({\n  "windowMs": 60_000,\n  \'windowMs\': minutes(1) * 2,\n});\n';
        expect(windowLines(text)).toHaveLength(2);
        expect(windowLines(text).filter((line) => !ALLOWED.test(line))).toHaveLength(2);
    });

    it("takes only a whole call of a helper or the given window as the value", () => {
        const allowed = ['windowMs: minutes(envInt("X", 15)),', '  "windowMs": hours(1),', "  'windowMs': options.windowMs,"];
        const refused = [
            'windowMs: minutes(envInt("X", 15)) * 60,',
            'windowMs: minutes(1) + hours(2),',
            'windowMs: minutes(1) || 5000,',
            'windowMs: options.windowMs ?? 5000,',
            "windowMs: 60_000,",
            "windowMs: minutes(1)",
        ];
        expect(allowed.filter((line) => !ALLOWED.test(line))).toEqual([]);
        expect(refused.filter((line) => ALLOWED.test(line))).toEqual([]);
    });
});
