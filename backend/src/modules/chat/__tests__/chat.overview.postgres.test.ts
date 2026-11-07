import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// GET /chat's set-based list (get_chats_overview) against the per-chat verdict,
// LiTT's private-matter rule (C2) included. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; this suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_chat_overview_${process.pid}_${Date.now()}`;
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

describe.skipIf(!container)("chat list access in PostgreSQL", () => {
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

    const parity = () => read("src/modules/chat/__tests__/chat.overview.sql");
    const upstream = () => read("migrations/20261029_01_chat_overview_candidates.sql");
    const litt = () => read("migrations/20261106_53_litt_chat_overview_private_matter.sql");

    it("lists exactly what the per-chat verdict grants, private matters included", () => {
        sql(parity());
        sql(read("src/modules/chat/__tests__/chat.overview.repro.sql"));
    }, 120_000);

    it("needs the LiTT migration: upstream's form alone shows a private matter's chats outside its team", () => {
        sql(upstream());
        expect(sqlError(parity())).toMatch(/the list contains exactly the chats the verdict grants/);
        // Filename order on an existing database: upstream's file, then LiTT's.
        sql(litt());
        sql(litt());
        sql(parity());
    }, 120_000);
});
