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

// The other insert-only tables: the same refusal in the database (a trigger),
// the same guard here. A fact of the client profile is also never changed.
const INSERT_ONLY_TABLES = [
    "audit_events",
    "matter_request_events",
    "matter_profile_facts",
    "matter_profile_fact_events",
];

describe("insert-only tables are insert-only in the backend", () => {
    for (const table of INSERT_ONLY_TABLES) {
        it(`no source file updates, upserts or deletes ${table} rows`, () => {
            const offenders: string[] = [];
            const pattern = new RegExp(`from\\(\\s*["']${table}["']\\s*\\)`, "g");
            for (const file of sourceFiles(SRC)) {
                const text = readFileSync(file, "utf8");
                for (const match of text.matchAll(pattern)) {
                    const chain = text.slice(match.index, text.indexOf(";", match.index));
                    if (/\.(update|upsert|delete)\s*\(/.test(chain))
                        offenders.push(relative(SRC, file));
                }
            }
            expect(offenders).toEqual([]);
        });
    }

    it("finds the tables it guards (a renamed table would make the scan vacuous)", () => {
        const all = sourceFiles(SRC).map((file) => readFileSync(file, "utf8")).join("\n");
        for (const table of INSERT_ONLY_TABLES) expect(all).toContain(`"${table}"`);
    });
});
