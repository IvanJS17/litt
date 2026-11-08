import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3 card 13 in PostgreSQL
// (20261108_82_litt_training_criterion_contrasts.sql). The assertions live in
// performance.litt-training-criteria.sql, which runs in CI with the
// performance.*.sql loop; this suite runs the same file locally against a
// disposable database and proves it depends on what it claims: with the
// membership cascade removed, or with a browser grant added, it fails. Opt in
// with MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_criteria_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_82_litt_training_criterion_contrasts.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-criteria.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
// psql reads the file from stdin here, so its \ir includes are inlined.
const assertions = () => {
    const dir = dirname(resolve(process.cwd(), ASSERTIONS));
    return read(ASSERTIONS).replace(/^\\ir (.+)$/gm, (_line, path: string) =>
        readFileSync(resolve(dir, path.trim()), "utf8"));
};
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

describe.skipIf(!container)("LiTT criteria contrasts in PostgreSQL", () => {
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
        // Re-running the migration over the final shape must land on it again.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("is reachable by the pupil and their current mentor only, and goes with the pupil", () => {
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when the table loses its membership cascade", () => {
        sql(`alter table public.training_criteria_contrasts drop constraint training_criteria_contrasts_member_fkey;`);
        expect(sqlError(assertions())).toMatch(/after leaving: no contrast of the pupil remains/);
        sql(`alter table public.training_criteria_contrasts add constraint training_criteria_contrasts_member_fkey
            foreign key (org_id, trainee_user_id) references public.org_members(org_id, user_id) on delete cascade;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when a browser role is granted the table", () => {
        sql(`grant select on public.training_criteria_contrasts to authenticated;`);
        expect(sqlError(assertions())).toMatch(/no browser privilege/);
        sql(`revoke all on public.training_criteria_contrasts from anon, authenticated;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);
});
