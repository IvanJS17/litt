import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, own map and retake, in PostgreSQL
// (20261108_78_litt_training_retakes.sql).
// performance.litt-training-retakes.sql holds the assertions (who reads a
// retake, constraints, the answer written once, deletion with the membership,
// re-running the migration) and runs in CI with the performance.*.sql loop.
// This suite runs the same file locally against a disposable database and
// proves it depends on the rule: with a leaky training_can_read_learning, or
// with a table that lost its membership cascade, or the write-once trigger,
// it fails. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<postgres container>;
// the suite owns a disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_retakes_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_78_litt_training_retakes.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-retakes.sql";
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

describe.skipIf(!container)("LiTT training retakes in PostgreSQL", () => {
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

    it("lets only the person and their current mentor read, keeps the answer once, and deletes with the person", () => {
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails without the rule: a function that also lets owners and admins read", () => {
        sql(`create or replace function public.training_can_read_learning(p_actor uuid, p_org uuid, p_trainee uuid)
            returns boolean language sql stable security definer set search_path = '' as $$
              select p_actor = p_trainee
                or exists (select 1 from public.training_pupils p where p.org_id = p_org
                  and p.trainee_user_id = p_trainee and p.mentor_user_id = p_actor)
                or exists (select 1 from public.org_members m where m.org_id = p_org
                  and m.user_id = p_actor and m.role in ('owner', 'admin'));
            $$;`);
        expect(sqlError(assertions())).toMatch(/matrix: admin reads the pupil; .*owner reads the pupil/);
        sql(`create or replace function public.training_can_read_learning(p_actor uuid, p_org uuid, p_trainee uuid)
            returns boolean language sql stable security definer set search_path = '' as $$
              select coalesce(exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_trainee)
                and (p_actor = p_trainee or exists (select 1 from public.training_pupils p
                  join public.org_members mentor on mentor.org_id = p.org_id and mentor.user_id = p.mentor_user_id
                  where p.org_id = p_org and p.trainee_user_id = p_trainee and p.mentor_user_id = p_actor)), false);
            $$;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when the table loses its membership cascade", () => {
        sql(`alter table public.training_retakes drop constraint training_retakes_member_fkey;`);
        expect(sqlError(assertions())).toMatch(/leaving the firm deletes the retake/);
        sql(read(MIGRATION));
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when the table is opened to a browser role", () => {
        sql(`grant select on public.training_retakes to authenticated;`);
        expect(sqlError(assertions())).toMatch(/a browser role has a privilege on training_retakes/);
        sql(`revoke all on public.training_retakes from authenticated;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);
});
