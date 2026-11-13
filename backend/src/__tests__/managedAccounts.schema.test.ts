import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The two columns behind managed accounts are written by the backend only.
const schema = readFileSync(resolve(__dirname, "../../schema.sql"), "utf8");
const migration = readFileSync(
    resolve(__dirname, "../../migrations/20261113_10_litt_managed_accounts.sql"),
    "utf8",
);

describe("managed accounts schema", () => {
    it("keeps both tables closed to the browser roles", () => {
        expect(schema).toContain("revoke all on public.user_profiles from anon, authenticated;");
        expect(schema).toContain("revoke all on public.organizations from anon, authenticated;");
    });

    it("grants nothing on the new columns to a client role, in schema or migration", () => {
        for (const sql of [schema, migration]) {
            const grants = sql
                .split(";")
                .filter((statement) => /\bgrant\b/i.test(statement))
                .filter((statement) => /created_by_org_id|managed_accounts|managed_notice_seen_org_id/.test(statement));
            expect(grants).toEqual([]);
        }
    });

    it("declares the same columns in the schema and the migration", () => {
        for (const column of ["managed_accounts boolean not null default false", "created_by_org_id uuid", "managed_notice_seen_org_id uuid"]) {
            expect(schema).toContain(column);
            expect(migration).toContain(column);
        }
    });
});
