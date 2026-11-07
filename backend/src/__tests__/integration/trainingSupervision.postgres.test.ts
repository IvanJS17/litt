import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 2 in PostgreSQL (20261107_60_litt_training_supervision.sql).
// performance.litt-training-supervision.sql holds the assertions (role
// matrix, mentor change, deletion, generic discovery of training_* tables,
// constraints, re-running the migration, negative controls) and runs in CI
// with the performance.*.sql loop. This suite runs the same file locally and
// proves it depends on the rule: with a leaky training_can_read_learning, or
// with a learning table that lost its membership cascade, it fails. Opt in
// with MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_supervision_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261107_60_litt_training_supervision.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-supervision.sql";
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

describe.skipIf(!container)("LiTT training supervision data in PostgreSQL", () => {
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
        // Re-running the migration over the final shape must be a no-op.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("lets only the pupil and their current mentor read, and deletes with the pupil", () => {
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
        expect(sqlError(assertions())).toMatch(/matrix: admin reads pupil; .*owner reads pupil/);
        sql(read(MIGRATION));
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when a learning table loses its membership cascade", () => {
        sql(`alter table public.training_defenses drop constraint training_defenses_member_fkey;`);
        expect(sqlError(assertions())).toMatch(/after leaving: training_defenses: 1 row\(s\) of the pupil remain/);
        sql(`alter table public.training_defenses add constraint training_defenses_member_fkey
            foreign key (org_id, trainee_user_id) references public.org_members(org_id, user_id) on delete cascade;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);
});
