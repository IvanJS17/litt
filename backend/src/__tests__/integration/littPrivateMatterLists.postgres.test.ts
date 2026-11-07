import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT C2 against upstream's cycle-3 list and permission rewrites (#749,
// 20261030_*): performance.litt-private-matters.sql checks every function the
// tranche created or redefined. This suite also proves the file depends on
// LiTT's guards: with upstream's departure rewrite alone, or with the
// private-matter guard switched off, it fails. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_litt_matter_lists_${process.pid}_${Date.now()}`;
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

describe.skipIf(!container)("private matters in upstream's cycle-3 lists (PostgreSQL)", () => {
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
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    const assertions = () => read("src/__tests__/sql/performance.litt-private-matters.sql");

    it("hides a private matter from everyone outside its team in every list and verdict", () => {
        sql(assertions());
    }, 120_000);

    it("needs the LiTT departure migration: upstream's rewrite alone hands a matter project to departure", () => {
        sql(read("migrations/20261030_04_forward_document_references.sql"));
        expect(sqlError(assertions())).toMatch(/org_members_departure_items: matter project stays with the matter team/);
        // Filename order on an existing database: upstream's file, then LiTT's.
        sql(read("migrations/20261030_51_litt_departure_private_matter.sql"));
        sql(read("migrations/20261030_51_litt_departure_private_matter.sql"));
        sql(assertions());
    }, 120_000);

    it("depends on the private-matter guard: switched off, the lists leak the matter", () => {
        sql(`create or replace function public.project_private_matter_denied(p_project_id uuid, p_user_id text)
            returns boolean language sql stable security definer set search_path = public as $$ select false $$;`);
        expect(sqlError(assertions())).toMatch(/owner: project_access_role|owner\/: project_list_access/);
    }, 120_000);
});
