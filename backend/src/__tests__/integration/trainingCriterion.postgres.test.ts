import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, card 2, in PostgreSQL
// (20261108_60_litt_training_criterion_turns.sql). The assertions live in
// performance.litt-training-criterion.sql and run in CI with the
// performance.*.sql loop: the generic discovery of training_* tables, the
// role matrix on a pupil whose note carries a verdict (owner and admin do not
// read), the change of mentor, deletion with the membership, the constraints
// of the new columns and re-running the migration. This suite runs the same
// file locally and proves it depends on the rules: with a leaky reader rule, a
// note table that lost its membership cascade, RLS off, a browser grant or a
// dropped check, it fails. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<postgres
// container>; the suite owns a disposable database and never touches the
// application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_criterion_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_60_litt_training_criterion_turns.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-criterion.sql";
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

describe.skipIf(!container)("LiTT training criterion columns in PostgreSQL", () => {
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

    it("lets only the pupil and their current mentor read, deletes with the pupil and holds the constraints", () => {
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
        sql(read("migrations/20261107_60_litt_training_supervision.sql"));
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when the notes lose their membership cascade", () => {
        sql(`alter table public.training_turn_notes drop constraint training_turn_notes_member_fkey;`);
        expect(sqlError(assertions())).toMatch(/after leaving: training_turn_notes: \d row\(s\) of the pupil remain/);
        sql(`alter table public.training_turn_notes add constraint training_turn_notes_member_fkey
            foreign key (org_id, trainee_user_id) references public.org_members(org_id, user_id) on delete cascade;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when the notes lose row security or a browser role gets a privilege", () => {
        sql(`alter table public.training_turn_notes disable row level security;`);
        expect(sqlError(assertions())).toMatch(/training_turn_notes: RLS off/);
        sql(`alter table public.training_turn_notes enable row level security;
            grant select on public.training_turn_notes to authenticated;`);
        expect(sqlError(assertions())).toMatch(/training_turn_notes: a browser role has a privilege/);
        sql(`revoke all on public.training_turn_notes from anon, authenticated;`);
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("fails when a check of the new columns is dropped", () => {
        for (const check of ["confidence", "verdict", "foundation", "topics", "mode"]) {
            sql(`alter table public.training_turn_notes drop constraint training_turn_notes_${check}_check;`);
            expect(sqlError(assertions()), check).toMatch(new RegExp(`expected training_turn_notes_${check}_check to reject`));
            sql(read(MIGRATION));
        }
        expect(sqlError(assertions())).toBe("");
    }, 120_000);

    it("keeps a 'skipped' contrast out of the old status check", () => {
        sql(`alter table public.training_turn_notes drop constraint training_turn_notes_status_check;
            alter table public.training_turn_notes add constraint training_turn_notes_status_check
                check (contrast_status in ('pending', 'ready', 'failed'));`);
        expect(sqlError(assertions())).toMatch(/training_turn_notes_status_check|skipped/);
        sql(read(MIGRATION));
        expect(sqlError(assertions())).toBe("");
    }, 120_000);
});
