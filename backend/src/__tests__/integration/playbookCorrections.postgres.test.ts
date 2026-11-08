import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 3, card 12 in PostgreSQL
// (20261108_70_litt_playbook_corrections.sql): a correction batch is an
// import of kind 'correction', its changes have source 'correction' and the
// person whose correction it is; one batch runs per playbook; the attribution
// goes with the account; nothing of the pupil has a column. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<postgres container>; the suite owns a
// disposable database and never touches the application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_playbook_corrections_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261108_70_litt_playbook_corrections.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
function sql(query: string): string {
    return execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-XAtq"], {
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

const MENTOR = "aaaaaaaa-0000-4000-8000-000000000001";
const PARTNER = "aaaaaaaa-0000-4000-8000-000000000002";
const PLAYBOOK = "bbbbbbbb-0000-4000-8000-000000000001";
const importRow = (id: string, kind: string, status: string) =>
    `insert into public.playbook_imports(id, user_id, kind, filename, model, status, stage, playbook_id, started_at)
     values ('${id}', '${MENTOR}', '${kind}', '', 'claude-opus-5', '${status}', 'compiling', '${PLAYBOOK}', now());`;
const changeRow = (id: string, source: string, attributedTo: string | null) =>
    `insert into public.playbook_changes(id, playbook_id, source, attributed_to, op, rule_id)
     values ('${id}', '${PLAYBOOK}', '${source}', ${attributedTo ? `'${attributedTo}'` : "null"}, 'add_rule', 'r1');`;

describe.skipIf(!container)("LiTT playbook corrections in PostgreSQL", () => {
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
        // Re-running the migration must land on the same shape.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
        sql(`insert into auth.users(id, email) values ('${MENTOR}', 'mentor@example.com'), ('${PARTNER}', 'partner@example.com');
            insert into public.playbooks(id, user_id, name, content_json)
            values ('${PLAYBOOK}', '${MENTOR}', 'Arrendamientos', '{}'::jsonb);`);
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("admits corrections only as the right kind and source, attributed only to a correction", () => {
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000001", "correction", "completed"))).toBe("");
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000002", "dictation", "completed"))).toMatch(/playbook_imports_kind_check/);
        expect(sqlError(changeRow("dddddddd-0000-4000-8000-000000000001", "correction", PARTNER))).toBe("");
        expect(sqlError(changeRow("dddddddd-0000-4000-8000-000000000002", "starting_point", null))).toBe("");
        expect(sqlError(changeRow("dddddddd-0000-4000-8000-000000000003", "starting_point", PARTNER))).toMatch(/playbook_changes_attribution_check/);
        expect(sqlError(changeRow("dddddddd-0000-4000-8000-000000000004", "dictation", null))).toMatch(/playbook_changes_source_check/);
    });

    it("runs one batch of corrections per playbook, beside one proposal", () => {
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000011", "correction", "running"))).toBe("");
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000012", "correction", "running"))).toMatch(/idx_playbook_imports_one_running_correction/);
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000013", "proposal", "running"))).toBe("");
        // The first one ended: another may start.
        sql(`update public.playbook_imports set status = 'completed', completed_at = now()
            where id = 'cccccccc-0000-4000-8000-000000000011';`);
        expect(sqlError(importRow("cccccccc-0000-4000-8000-000000000014", "correction", "running"))).toBe("");
    });

    it("keeps the change, without the attribution, when the account goes", () => {
        sql(`delete from auth.users where id = '${PARTNER}';`);
        expect(sql(`select attributed_to is null from public.playbook_changes
            where id = 'dddddddd-0000-4000-8000-000000000001';`).trim()).toBe("t");
    });

    it("has no column that names a pupil on the tables corrections touch", () => {
        const columns = sql(`select column_name from information_schema.columns
            where table_schema = 'public' and table_name in ('playbook_imports', 'playbook_changes')
              and (column_name ilike '%trainee%' or column_name ilike '%pupil%' or column_name ilike '%learner%');`);
        expect(columns.trim()).toBe("");
        // Browser roles read neither table.
        expect(sql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('playbook_imports', 'playbook_changes')
              and grantee in ('anon', 'authenticated');`).trim()).toBe("0");
    });
});
