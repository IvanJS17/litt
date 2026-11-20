import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ai_call_usage (20261119_60_litt_ai_call_usage.sql): re-runnable migration,
// insert-only in the database, backend-only grants, no browser access. Opt in
// with MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all
// writes target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_ai_call_usage_${process.pid}_${Date.now()}`;
const psql = (query: string) =>
    execFileSync("docker", [
        "exec", "-i", container!, "psql", "-U", "postgres", "-d", database,
        "-v", "ON_ERROR_STOP=1", "-XqAt",
    ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const failure = (query: string): string => {
    try {
        psql(query);
    } catch (error) {
        return String((error as { stderr?: unknown }).stderr ?? error);
    }
    throw new Error("expected the statement to fail");
};
const row = () =>
    `insert into public.ai_call_usage(surface, engine, provider, model, input_tokens, output_tokens)
     values ('rule_suggestion_catalog', 'byok', 'claude', 'claude-opus-5-5', 1200, 80)`;

describe.skipIf(!container)("ai_call_usage in PostgreSQL", () => {
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
        // Re-running the migration over the final shape must be a no-op, twice.
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261119_60_litt_ai_call_usage.sql"), "utf8");
        psql(migration);
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("is recorded in the ledger and has exactly one guard trigger", () => {
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261119_60_litt_ai_call_usage.sql'`)).toBe("1");
        expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.ai_call_usage'::regclass and not tgisinternal`)).toBe("1");
    });

    it("stores tokens and engine, with cost null when unpriced", () => {
        psql(row());
        expect(psql(`select engine || ',' || provider || ',' || model || ',' || input_tokens || ',' || output_tokens || ',' || coalesce(cost_usd::text, 'null') from public.ai_call_usage`))
            .toBe("byok,claude,claude-opus-5-5,1200,80,null");
        psql(`insert into public.ai_call_usage(surface, engine, provider, model, input_tokens, cost_usd)
            values ('triage.classify', 'jev', 'typesafe', 'jev-1.14.0', 2000, 0.000084)`);
        expect(psql(`select cost_usd from public.ai_call_usage where engine = 'jev'`)).toBe("0.00008400");
    });

    it("refuses update and delete, even for the backend role", () => {
        expect(failure(`update public.ai_call_usage set input_tokens = 1`)).toContain("insert-only");
        expect(failure(`delete from public.ai_call_usage`)).toContain("insert-only");
        expect(failure(`set role service_role; delete from public.ai_call_usage`)).toMatch(/insert-only|permission denied/);
    });

    it("checks the engine, the counts and the surface label", () => {
        expect(failure(`insert into public.ai_call_usage(surface, engine, provider, model) values ('s', 'other', 'p', 'm')`)).toContain("engine");
        expect(failure(`insert into public.ai_call_usage(surface, engine, provider, model, input_tokens) values ('s', 'byok', 'p', 'm', -1)`)).toContain("input_tokens");
        expect(failure(`insert into public.ai_call_usage(surface, engine, provider, model) values ('Bad Surface', 'byok', 'p', 'm')`)).toContain("surface");
        expect(failure(`insert into public.ai_call_usage(surface, engine, provider, model) values ('s', 'byok', ' ', 'm')`)).toContain("provider");
    });

    it("grants the backend role select and insert only; the browser roles get nothing", () => {
        expect(psql(`select has_table_privilege('service_role', 'public.ai_call_usage', 'select') and has_table_privilege('service_role', 'public.ai_call_usage', 'insert')`)).toBe("t");
        expect(psql(`select has_table_privilege('service_role', 'public.ai_call_usage', 'update') or has_table_privilege('service_role', 'public.ai_call_usage', 'delete')`)).toBe("f");
        for (const role of ["authenticated", "anon"])
            expect(psql(`select has_table_privilege('${role}', 'public.ai_call_usage', 'select') or has_table_privilege('${role}', 'public.ai_call_usage', 'insert')`)).toBe("f");
        expect(psql(`select relrowsecurity from pg_class where oid = 'public.ai_call_usage'::regclass`)).toBe("t");
    });

    it("keeps no text column", () => {
        expect(psql(`select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ai_call_usage' and column_name ~* '(prompt|answer|quote|content|text|key|secret|email|name)'`)).toBe("0");
    });
});
