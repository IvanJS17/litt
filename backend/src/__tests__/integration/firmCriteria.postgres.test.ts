import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, the firm's criteria, in PostgreSQL
// (20261108_76_litt_firm_criteria.sql).
// performance.litt-firm-criteria.sql holds the assertions (closed to the
// browser roles, scoped by organization, constraints, what survives leaving
// the firm, erasing the author's account and deleting the playbook) and runs in CI with the performance.*.sql loop. This suite
// runs the same file locally against a disposable database and proves it
// depends on the grants, the constraints and the author's set null. Opt in
// with MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_firm_criteria_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_76_litt_firm_criteria.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-firm-criteria.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
function sql(query: string) {
    execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-Xq"], {
        input: query, encoding: "utf8", timeout: 120_000, stdio: ["pipe", "pipe", "pipe"],
    });
}
function sqlError(query: string): string {
    try {
        sql(query);
    } catch (error) {
        return String((error as { stderr?: string }).stderr ?? error);
    }
    return "";
}

describe.skipIf(!container)("LiTT firm criteria in PostgreSQL", () => {
    let created = false;
    beforeAll(() => {
        execFileSync("docker", ["exec", container!, "createdb", "-U", "postgres", database]);
        created = true;
        sql(`create schema auth;
            create table auth.users (id uuid primary key, email text,
                raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
        sql(read("schema.sql"));
        // Re-running the migration on top of the final shape must land on it again.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("keeps the criteria the firm's: closed to browsers, bounded, and surviving the people who wrote them", () => {
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails when the table is opened to a browser role", () => {
        sql(`grant select on public.firm_criteria to authenticated;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/a browser role has a privilege on firm_criteria/);
        sql(`revoke all on public.firm_criteria from authenticated;`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails when the author is deleted with the account instead of set to null", () => {
        sql(`alter table public.firm_criteria drop constraint firm_criteria_author_user_id_fkey;
            alter table public.firm_criteria add constraint firm_criteria_author_user_id_fkey
              foreign key (author_user_id) references auth.users(id) on delete cascade;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/erasing the account leaves the firm/);
        sql(`alter table public.firm_criteria drop constraint firm_criteria_author_user_id_fkey;
            alter table public.firm_criteria add constraint firm_criteria_author_user_id_fkey
              foreign key (author_user_id) references auth.users(id) on delete set null;`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails without the rule that a dissenting opinion names a rule", () => {
        sql(`alter table public.firm_criteria drop constraint firm_criteria_rule_check;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/firm_criteria_rule_check/);
        sql(read(MIGRATION));
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);
});
