import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, card 6, in PostgreSQL: the notes that hints and
// counterparty rounds write against the columns of
// 20261108_60_litt_training_criterion_turns.sql. The assertions live in
// performance.litt-training-modes.sql and run in CI with the performance.*.sql
// loop; this suite runs the same file locally and proves it depends on the
// rules: with the mode check dropped, or the notes' membership cascade gone, it
// fails. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the
// suite owns a disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_modes_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_60_litt_training_criterion_turns.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-modes.sql";
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

describe.skipIf(!container)("LiTT training hint and counterpart notes in PostgreSQL", () => {
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
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("accepts the shapes the server writes, rejects the rest, and removes them with the membership", () => {
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails when the mode check is dropped", () => {
        sql(`alter table public.training_turn_notes drop constraint training_turn_notes_mode_check;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/expected training_turn_notes_mode_check to reject/);
        sql(read(MIGRATION));
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails when a skipped note may carry a contrast", () => {
        sql(`alter table public.training_turn_notes drop constraint training_turn_notes_contrast_check;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/training_turn_notes_contrast_check/);
        sql(`alter table public.training_turn_notes add constraint training_turn_notes_contrast_check check (
            (contrast_status = 'ready') = (contrast is not null) and (contrast is null or char_length(contrast) <= 8000));`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails when the notes lose their membership cascade", () => {
        sql(`alter table public.training_turn_notes drop constraint training_turn_notes_member_fkey;`);
        expect(sqlError(read(ASSERTIONS))).toMatch(/must go with the membership|violates|foreign key/);
        sql(`alter table public.training_turn_notes add constraint training_turn_notes_member_fkey
            foreign key (org_id, trainee_user_id) references public.org_members(org_id, user_id) on delete cascade;`);
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);
});
