import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt in with MIKE_TEST_POSTGRES_CONTAINER=supabase_db_backend. All writes
// target disposable databases; the container's application DB is untouched.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const suffix = `${process.pid}_${Date.now()}`;
const oldDb = `mike_test_theme_old_${suffix}`;
const freshDb = `mike_test_theme_fresh_${suffix}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (database: string, query: string): string =>
    execFileSync(
        "docker",
        ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-XqAt"],
        { input: `${query}\n\\q\n`, encoding: "utf8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
const migration = readFileSync(resolve(process.cwd(), "migrations/20261114_10_litt_theme.sql"), "utf8");

describe.skipIf(!container)("user_profiles.theme in PostgreSQL", () => {
    const created: string[] = [];
    beforeAll(() => {
        for (const name of [oldDb, freshDb]) {
            execFileSync("docker", ["exec", container!, "createdb", "-U", "postgres", name]);
            created.push(name);
        }
        // The table as it was before the migration: dark_mode, no theme.
        sql(
            oldDb,
            `create table public.user_profiles (
                user_id uuid primary key,
                display_name text,
                dark_mode boolean not null default false
            );
            insert into public.user_profiles (user_id, dark_mode) values
                ('${uid(1)}', true), ('${uid(2)}', false), ('${uid(3)}', true);`,
        );
        // A new install: schema.sql already carries the end state.
        sql(freshDb, "create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now()); create function auth.uid() returns uuid language sql stable as 'select null::uuid'; create function auth.role() returns text language sql stable as 'select null::text'; create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';");
        sql(freshDb, readFileSync(resolve(process.cwd(), "schema.sql"), "utf8"));
    }, 120_000);
    afterAll(() => {
        for (const name of created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", name]);
    });

    it("turns dark_mode=true into dark and false into light, and drops dark_mode", () => {
        sql(oldDb, migration);
        expect(
            sql(oldDb, "select user_id || ':' || theme from public.user_profiles order by user_id"),
        ).toBe([`${uid(1)}:dark`, `${uid(2)}:light`, `${uid(3)}:dark`].join("\n"));
        expect(
            sql(
                oldDb,
                "select count(*) from information_schema.columns where table_name='user_profiles' and column_name='dark_mode'",
            ),
        ).toBe("0");
    });

    it("can run again without changing anything", () => {
        sql(oldDb, "update public.user_profiles set theme='system' where user_id='" + uid(2) + "'");
        sql(oldDb, migration);
        expect(sql(oldDb, `select theme from public.user_profiles where user_id='${uid(2)}'`)).toBe("system");
        expect(sql(oldDb, `select theme from public.user_profiles where user_id='${uid(1)}'`)).toBe("dark");
    });

    it("starts new accounts on system and refuses any other value", () => {
        sql(oldDb, `insert into public.user_profiles (user_id) values ('${uid(9)}')`);
        expect(sql(oldDb, `select theme from public.user_profiles where user_id='${uid(9)}'`)).toBe("system");
        expect(() => sql(oldDb, `update public.user_profiles set theme='sepia' where user_id='${uid(9)}'`)).toThrow(
            /user_profiles_theme_check/,
        );
        expect(() => sql(oldDb, `update public.user_profiles set theme=null where user_id='${uid(9)}'`)).toThrow(
            /not-null|null value/,
        );
    });

    it("schema.sql has the same end state as the migration", () => {
        const describe = (database: string) =>
            sql(
                database,
                `select column_name || '|' || is_nullable || '|' || coalesce(column_default,'') from information_schema.columns
                 where table_schema='public' and table_name='user_profiles' and column_name in ('theme','dark_mode')`,
            );
        expect(describe(freshDb)).toBe("theme|NO|'system'::text");
        expect(describe(oldDb)).toBe(describe(freshDb));
        expect(
            sql(freshDb, "select pg_get_constraintdef(oid) from pg_constraint where conname='user_profiles_theme_check'"),
        ).toBe(
            sql(oldDb, "select pg_get_constraintdef(oid) from pg_constraint where conname='user_profiles_theme_check'"),
        );
        expect(sql(freshDb, "select count(*) from public.schema_migrations where filename='20261114_10_litt_theme.sql'")).toBe("1");
    });
});
