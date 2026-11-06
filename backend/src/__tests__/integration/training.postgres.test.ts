import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// LiTT training rows in PostgreSQL (20261106_50_litt_training.sql): they end
// with the membership, a mentor with pupils cannot leave, and account
// erasure releases the pupils instead of blocking. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database that is dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_${process.pid}_${Date.now()}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const psql = (query: string) =>
    execFileSync("docker", [
        "exec", "-i", container!, "psql", "-U", "postgres", "-d", database,
        "-v", "ON_ERROR_STOP=1", "-XqAt",
    ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const count = (table: string, where = "true") =>
    Number(psql(`select count(*) from public.${table} where ${where}`));
const failure = (query: string): string => {
    try {
        psql(query);
    } catch (error) {
        return String((error as { stderr?: unknown }).stderr ?? error);
    }
    throw new Error("expected the statement to fail");
};

const ORG = 10;
const OWNER = 1;
const MENTOR = 2;
const PUPIL = 3;

describe.skipIf(!container)("LiTT training rows in PostgreSQL", () => {
    let created = false;
    beforeAll(() => {
        execFileSync("docker", ["exec", container!, "createdb", "-U", "postgres", database]);
        created = true;
        psql(`create schema auth;
            create table auth.users (id uuid primary key, email text,
                raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
        psql(readFileSync(resolve(process.cwd(), "schema.sql"), "utf8"));
        // Re-running the migration over the final shape must be a no-op.
        const migration = readFileSync(
            resolve(process.cwd(), "migrations/20261106_50_litt_training.sql"),
            "utf8",
        );
        psql(migration);
        psql(migration);
    }, 120_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`truncate auth.users, public.organizations, public.db_jobs cascade;
            insert into auth.users(id,email) values
                (${q(OWNER)},'owner@example.test'), (${q(MENTOR)},'mentor@example.test'),
                (${q(PUPIL)},'pupil@example.test');
            insert into public.organizations(id,name,created_by) values (${q(ORG)},'Despacho',${q(OWNER)});
            insert into public.org_members(org_id,user_id,role) values
                (${q(ORG)},${q(OWNER)},'owner'), (${q(ORG)},${q(MENTOR)},'member'),
                (${q(ORG)},${q(PUPIL)},'member');
            insert into public.training_mentors(org_id,user_id,designated_by)
                values (${q(ORG)},${q(MENTOR)},${q(OWNER)});
            insert into public.training_pupils(org_id,trainee_user_id,mentor_user_id,assigned_by)
                values (${q(ORG)},${q(PUPIL)},${q(MENTOR)},${q(MENTOR)});
            insert into public.training_stages(org_id,trainee_user_id,practice,stage,updated_by) values
                (${q(ORG)},${q(PUPIL)},null,'junior',${q(MENTOR)}),
                (${q(ORG)},${q(PUPIL)},'laboral','pasante',${q(MENTOR)});`);
    });

    it("rejects what the rules forbid at the table level", () => {
        expect(failure(`insert into public.training_stages(org_id,trainee_user_id,practice,stage)
            values (${q(ORG)},${q(PUPIL)},null,'pasante');`)).toContain("training_stages_practice_key");
        expect(failure(`insert into public.training_stages(org_id,trainee_user_id,practice,stage)
            values (${q(ORG)},${q(PUPIL)},'Fiscal','junior');`)).toContain("training_stages_practice_check");
        expect(failure(`insert into public.training_stages(org_id,trainee_user_id,practice,stage)
            values (${q(ORG)},${q(PUPIL)},'fiscal','socio');`)).toContain("training_stages_stage_check");
        expect(failure(`insert into public.training_mentors(org_id,user_id) values (${q(ORG)},${q(PUPIL)});
            update public.training_pupils set mentor_user_id=${q(PUPIL)};`)).toContain("training_pupils_not_self");
        expect(failure(`delete from public.training_mentors where user_id=${q(MENTOR)};`))
            .toContain("training_pupils_mentor_fkey");
    });

    it("keeps the rows away from the browser roles", () => {
        expect(psql(`select bool_and(relrowsecurity) from pg_class
            where relname in ('training_mentors','training_pupils','training_stages')`)).toBe("t");
        expect(psql(`select has_table_privilege('authenticated','public.training_stages','select')`)).toBe("f");
    });

    it("drops a pupil's mentor and stages when they leave the organization", () => {
        psql(`select public.remove_org_member(${q(ORG)},${q(PUPIL)},${q(PUPIL)},null);`);
        expect(count("training_pupils")).toBe(0);
        expect(count("training_stages")).toBe(0);
        expect(count("training_mentors")).toBe(1);
    });

    it("refuses a mentor with pupils leaving, and lets them go once released", () => {
        expect(failure(`select public.remove_org_member(${q(ORG)},${q(MENTOR)},${q(OWNER)},null);`))
            .toContain("A training mentor with pupils cannot leave the organization");
        expect(count("org_members", `org_id=${q(ORG)} and user_id=${q(MENTOR)}`)).toBe(1);
        psql(`delete from public.training_pupils where mentor_user_id=${q(MENTOR)};
            select public.remove_org_member(${q(ORG)},${q(MENTOR)},${q(OWNER)},null);`);
        expect(count("training_mentors")).toBe(0);
        expect(count("org_members", `org_id=${q(ORG)} and user_id=${q(MENTOR)}`)).toBe(0);
    });

    it("releases an erased mentor's pupils instead of blocking the erasure", () => {
        psql(`select public.prepare_account_org_departures(${q(MENTOR)});`);
        expect(count("org_members", `org_id=${q(ORG)} and user_id=${q(MENTOR)}`)).toBe(0);
        expect(count("training_pupils")).toBe(0);
        expect(count("training_stages")).toBe(0);
        expect(psql(`select coalesce(current_setting('litt.training_erasure', true), '')`)).toBe("");
    });

    it("releases the pupils when the mentor's account row itself goes", () => {
        psql(`delete from auth.users where id=${q(MENTOR)};`);
        expect(count("training_mentors")).toBe(0);
        expect(count("training_pupils")).toBe(0);
    });
});
