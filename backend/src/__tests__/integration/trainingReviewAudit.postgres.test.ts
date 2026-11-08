import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, bulk review designer, in PostgreSQL
// (20261108_66_litt_training_criterion_review_audits.sql). The assertions live
// in performance.litt-training-review-audits.sql and run in CI with the
// performance.*.sql loop. This suite runs the same file locally, re-runs the
// migration on top of the final schema, and proves the assertions depend on
// the table's own checks: with the sample check or the one-live-audit index
// removed, they fail. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<postgres
// container>; the suite owns a disposable database.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_review_audits_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_66_litt_training_criterion_review_audits.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-review-audits.sql";
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

describe.skipIf(!container)("LiTT training review audits in PostgreSQL", () => {
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
        // Re-running the migration on the final shape changes nothing.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("keeps cell content out of the sample and the evaluation coherent", () => {
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails without the sample check: a cell's text would be kept", () => {
        sql(`alter table public.training_review_audits drop constraint training_review_audits_sample_check;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/should have been refused/);
        sql(`alter table public.training_review_audits add constraint training_review_audits_sample_check
            check (public.training_review_audit_sample_ok(sample));`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails without the one-live-audit index", () => {
        sql(`drop index public.training_review_audits_live_idx;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/should have been refused/);
        sql(`create unique index training_review_audits_live_idx
            on public.training_review_audits(org_id, trainee_user_id, tabular_review_id) where status <> 'stale';`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);
});
