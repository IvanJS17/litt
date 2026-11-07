import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT C2 against upstream's list and permission rewrites (#749, cycles 3
// to 5: 20261030_*, 20261101_*): performance.litt-private-matters.sql checks
// every function those tranches created or redefined. This suite also proves
// the whole file depends on LiTT's guards: with upstream's project_access_role,
// departure or ownerless rewrite alone, or with the private-matter guard switched off,
// it fails. performance.litt-private-matters-controls.sql runs the same swaps
// in CI against a smaller fixture. Opt in with
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

describe.skipIf(!container)("private matters in upstream's cycle-3 to cycle-5 lists (PostgreSQL)", () => {
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

    it("needs the LiTT access migration: upstream's uuid-lookup project_access_role alone leaks the matter", () => {
        sql(read("migrations/20261101_03_member_lookup_by_uuid.sql"));
        expect(sqlError(assertions())).toMatch(/owner: project_access_role/);
        // Filename order on an existing database: upstream's file, then LiTT's.
        sql(read("migrations/20261101_50_litt_project_access_private_matter.sql"));
        sql(assertions());
    }, 120_000);

    it("needs the LiTT departure migration: upstream's rewrite alone hands a matter project to departure", () => {
        sql(read("migrations/20261101_18_departure_root_candidates.sql"));
        expect(sqlError(assertions())).toMatch(/org_members_departure_items: matter project stays with the matter team/);
        // Filename order on an existing database: upstream's file, then LiTT's
        // (twice: the migration is safe to re-run).
        sql(read("migrations/20261107_50_litt_departure_root_candidates_private_matter.sql"));
        sql(read("migrations/20261107_50_litt_departure_root_candidates_private_matter.sql"));
        sql(assertions());
    }, 120_000);

    it("needs the LiTT ownerless migration: upstream's set-based list alone offers a matter project to the owner", () => {
        sql(read("migrations/20261101_17_ownerless_items_set_based.sql"));
        expect(sqlError(assertions())).toMatch(/ownerless_org_item_ids: a matter project is never ownerless/);
        sql(read("migrations/20261107_51_litt_ownerless_items_private_matter.sql"));
        sql(assertions());
    }, 120_000);

    it("depends on the private-matter guard: switched off, the lists leak the matter", () => {
        sql(`create or replace function public.project_private_matter_denied(p_project_id uuid, p_user_id text)
            returns boolean language sql stable security definer set search_path = public as $$ select false $$;`);
        expect(sqlError(assertions())).toMatch(/owner: project_access_role|owner\/: project_list_access/);
    }, 120_000);
});
