import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// LiTT C3 (docs/UPSTREAM_SYNC_PLAN.md §3): audit is insert-only and attributed.
// The database refuses UPDATE and DELETE on audit_events (migration
// 20261023_11); this keeps the backend from shipping a code path that tries,
// which on a real database would fail after the statements before it ran.

const SRC = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
            return name === "__tests__" ? [] : sourceFiles(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
}

describe("audit_events is insert-only in the backend", () => {
    it("no source file updates, upserts or deletes audit rows", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const text = readFileSync(file, "utf8");
            for (const match of text.matchAll(/from\(\s*["']audit_events["']\s*\)/g)) {
                const chain = text.slice(match.index, text.indexOf(";", match.index));
                if (/\.(update|upsert|delete)\s*\(/.test(chain))
                    offenders.push(relative(SRC, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
