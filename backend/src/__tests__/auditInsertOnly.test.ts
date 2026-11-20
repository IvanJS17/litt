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
// the same guard here (the MCP server's own records, design §7.4; a fact of
// the client profile is also never changed).
const INSERT_ONLY_TABLES = [
    "audit_events",
    "mcp_tool_calls",
    "mcp_oauth_audit",
    "matter_request_events",
    "matter_profile_facts",
    "matter_profile_fact_events",
    "matter_radar_item_events",
    "matter_obligation_rule_events",
    "matter_obligation_item_events",
    "matter_report_sent_events",
    "obligation_rule_suggestions",
    "obligation_rule_suggestion_events",
    "obligation_rule_questions",
    "obligation_rule_question_answers",
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

describe("mcp_tool_calls is insert-only in the database", () => {
    const root = resolve(SRC, "../..");
    const migration = readFileSync(
        join(root, "backend/migrations/20261116_40_litt_mcp_tool_calls.sql"),
        "utf8",
    );
    const schema = readFileSync(join(root, "backend/schema.sql"), "utf8");

    it.each([
        ["the migration", migration],
        ["schema.sql", schema],
    ])("%s refuses UPDATE and DELETE and closes the table to clients", (_name, sql) => {
        expect(sql).toMatch(
            /create trigger mcp_tool_calls_insert_only_trigger\s+before update or delete on public\.mcp_tool_calls/,
        );
        expect(sql).toContain("alter table public.mcp_tool_calls enable row level security;");
        expect(sql).toContain("revoke all on public.mcp_tool_calls from anon, authenticated;");
    });

    it("keeps no argument, result or text column", () => {
        const table = migration.slice(
            migration.indexOf("create table if not exists public.mcp_tool_calls"),
            migration.indexOf(");", migration.indexOf("create table if not exists public.mcp_tool_calls")),
        );
        expect(table).not.toMatch(/\b(args|arguments|result|content|text_body|payload|detail)\b/);
    });
});
