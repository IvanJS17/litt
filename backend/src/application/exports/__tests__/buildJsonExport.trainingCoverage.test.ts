import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    TRAINING_EXPORT_EXCLUDED,
    TRAINING_EXPORT_KEYS,
    buildUserAccountExport,
} from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// ARCO, transversal: every `training_*` table of the schema is discovered
// here (not listed by hand), and must be carried by the account export or
// explicitly left out with a reason. A new learning table fails this test
// until somebody decides.
const backendDir = path.resolve(__dirname, "../../../..");
const schema = readFileSync(path.join(backendDir, "schema.sql"), "utf8");

const TABLE_RE = /create table (?:if not exists )?public\.(training_\w+) \(([\s\S]*?)\n\);/g;

function discover(): Map<string, string[]> {
    const tables = new Map<string, string[]>();
    for (const match of schema.matchAll(TABLE_RE)) {
        const columns = new Set<string>();
        for (const line of match[2].split("\n")) {
            const column = /^\s{2}([a-z_]+)\s+(?:uuid|text|integer|int|bigint|boolean|jsonb|timestamptz|smallint|bytea|date|numeric)\b/.exec(line);
            if (column) columns.add(column[1]);
        }
        tables.set(match[1], [...columns]);
    }
    for (const match of schema.matchAll(
        /alter table public\.(training_\w+) add column if not exists ([a-z_]+)/g,
    )) {
        tables.get(match[1])?.push(match[2]);
    }
    return tables;
}

// Mentor ids and credential references never leave in a learning table. The one
// exception is the holder's own mentor on `training_pupils`: who mentors them
// is the relationship the holder is entitled to read.
const SECRET_COLUMNS = ["credential_ref", "digest_salt", "seed", "mentor_user_id"];
const isOtherPersonColumn = (column: string) => /_by$/.test(column);

describe("account export: every training_* table has a decision", () => {
    const tables = discover();

    it("finds the training tables in the schema (the discovery itself works)", () => {
        expect(tables.size).toBeGreaterThanOrEqual(13);
        expect(tables.has("training_turn_notes")).toBe(true);
        expect(tables.get("training_turn_notes")).toContain("trainee_user_id");
    });

    it("carries each table or excludes it with a reason, never both, never neither", () => {
        const covered = new Set(Object.keys(TRAINING_EXPORT_KEYS));
        const excluded = new Set(Object.keys(TRAINING_EXPORT_EXCLUDED));
        for (const table of tables.keys()) {
            expect(covered.has(table) || excluded.has(table), `${table}: not exported and not excluded`).toBe(true);
            expect(covered.has(table) && excluded.has(table), `${table}: both exported and excluded`).toBe(false);
        }
        for (const table of [...covered, ...excluded])
            expect(tables.has(table), `${table}: listed but not in the schema`).toBe(true);
        for (const [table, reason] of Object.entries(TRAINING_EXPORT_EXCLUDED))
            expect(reason.length, `${table}: reason`).toBeGreaterThan(40);
    });

    it("only excludes tables that hold no trainee's learning data", () => {
        for (const table of Object.keys(TRAINING_EXPORT_EXCLUDED))
            expect(tables.get(table), table).not.toContain("trainee_user_id");
    });

    it("exports a row of each table the holder owns, without secrets or other people's ids", async () => {
        const holder = "holder";
        const rows: Record<string, Row[]> = {
            organizations: [{ id: "org-a", kind: "team" }],
            org_members: [{ org_id: "org-a", user_id: holder, role: "member" }],
        };
        for (const table of Object.keys(TRAINING_EXPORT_KEYS)) {
            const row: Row = {};
            for (const column of tables.get(table) ?? []) row[column] = `x-${column}`;
            row.org_id = "org-a";
            if ("trainee_user_id" in row) row.trainee_user_id = holder;
            if (table === "training_mentors") row.user_id = holder;
            rows[table] = [row];
        }
        const { db } = makeExportDb(rows);
        const out = (await buildUserAccountExport(db, holder, "h@example.test", null)) as any;

        const exportedKeys = Object.keys(out.training).sort();
        expect(exportedKeys).toEqual(Object.values(TRAINING_EXPORT_KEYS).sort());
        for (const [table, key] of Object.entries(TRAINING_EXPORT_KEYS)) {
            expect(out.training[key], `${table} → training.${key}`).toHaveLength(1);
            for (const column of Object.keys(out.training[key][0])) {
                expect(SECRET_COLUMNS.includes(column) && !(table === "training_pupils" && column === "mentor_user_id"),
                    `${table}.${column}`).toBe(false);
                expect(isOtherPersonColumn(column), `${table}.${column}`).toBe(false);
            }
        }
    });

    it("every learning table goes with the membership (cascade from org_members, directly or through the pupil)", () => {
        const viaMembership = (table: string, seen = new Set<string>()): boolean => {
            if (seen.has(table)) return false;
            seen.add(table);
            const body = [...schema.matchAll(TABLE_RE)].find((m) => m[1] === table)?.[2] ?? "";
            const extra = [...schema.matchAll(new RegExp(`alter table public\\.${table} add constraint[\\s\\S]*?;`, "g"))]
                .map((m) => m[0]).join("\n");
            const text = `${body}\n${extra}`;
            if (/references public\.org_members\([^)]*\)\s*on delete cascade/.test(text)) return true;
            for (const parent of ["training_pupils", "training_mentors"])
                if (new RegExp(`references public\\.${parent}\\([^)]*\\)\\s*on delete cascade`).test(text) && viaMembership(parent, seen))
                    return true;
            return false;
        };
        for (const table of Object.keys(TRAINING_EXPORT_KEYS))
            expect(viaMembership(table), `${table} must be deleted with the membership`).toBe(true);
    });

    it("the migrations create no training table the schema lacks", () => {
        const dir = path.join(backendDir, "migrations");
        for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
            const sql = readFileSync(path.join(dir, file), "utf8");
            for (const match of sql.matchAll(/create table (?:if not exists )?public\.(training_\w+)/g))
                expect(tables.has(match[1]), `${file}: ${match[1]}`).toBe(true);
        }
    });
});
