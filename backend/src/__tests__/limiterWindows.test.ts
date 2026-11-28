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

/** The lines that give a limiter its window in a file that builds limiters (a type's field aside). */
function windowLines(text: string): string[] {
    if (!/from "express-rate-limit"/.test(text)) return [];
    return text
        .split("\n")
        .filter((line) => /^\s*windowMs\s*:/.test(line) && !/^\s*windowMs:\s*number;\s*$/.test(line));
}

const ALLOWED = /^\s*windowMs:\s*(?:(?:minutes|hours)\(|options\.windowMs,)/;

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
});
