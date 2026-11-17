import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The backend reads and writes every LiTT table with the service role. A
// database whose public schema has no default privileges for new tables
// (production) gives that role nothing unless the migration grants it, and the
// first write then fails with 42501. So every table a LiTT migration creates
// must be granted to service_role by a LiTT migration (the same one or later).
const dir = path.resolve(__dirname, "../../migrations");
const litt = readdirSync(dir)
    .filter((f) => /_litt_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(path.join(dir, f), "utf8").toLowerCase() }));

const grantsToServiceRole = litt
    .flatMap(({ sql }) => sql.match(/grant [^;]*? to service_role/g) ?? [])
    .join("\n");

describe("LiTT migrations grant the service role", () => {
    const created = litt.flatMap(({ file, sql }) =>
        [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => ({ file, table: m[1] })),
    );

    it("finds the tables", () => {
        expect(created.length).toBeGreaterThan(10);
    });

    it.each(created)("$table ($file)", ({ table }) => {
        expect(grantsToServiceRole).toMatch(new RegExp(`public\\.${table}\\b`));
    });
});
