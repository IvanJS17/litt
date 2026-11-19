import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Playbooks linked to request types (20261119_50_litt_request_type_playbooks.sql):
// the guard trigger (same firm, ready, shared), unlinking by marking, no delete,
// one open link per type and playbook, grants and row-level security. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes target
// a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_type_playbooks_${process.pid}_${Date.now()}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
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
const asUser = (user: number, statement: string) =>
    psql(`begin; set local role authenticated;
        select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
        ${statement};
        commit;`).split("\n").pop()!;

const MEMBER = 1;
const OUTSIDER = 2;
const ORG = 10;
const OTHER_ORG = 11;
const TYPE = 70;
const OTHER_TYPE = 71;
const READY = 90;
const DRAFT = 91;
const PRIVATE = 92;
const FOREIGN = 93;

const link = (type: number, playbook: number, org = ORG) =>
    `insert into public.request_type_playbooks(org_id, type_id, playbook_id, linked_by) values (${q(org)}, ${q(type)}, ${q(playbook)}, ${q(MEMBER)})`;

describe.skipIf(!container)("request type playbooks in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261119_50_litt_request_type_playbooks.sql"), "utf8");
        psql(migration);
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`set session_replication_role = replica;
            truncate public.request_type_playbooks, public.playbooks, public.matter_request_types cascade;
            delete from public.org_members; delete from public.organizations; delete from auth.users;`);
        psql(`insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 2) n;
            insert into public.organizations(id, name, kind) values (${q(ORG)}, 'Firm', 'team'), (${q(OTHER_ORG)}, 'Other', 'team');
            insert into public.org_members(org_id, user_id, role) values (${q(ORG)}, ${q(MEMBER)}, 'member'), (${q(OTHER_ORG)}, ${q(OUTSIDER)}, 'owner');
            insert into public.matter_request_types(id, organization_id, seed_key) values
              (${q(TYPE)}, ${q(ORG)}, 'contracts_clients'), (${q(OTHER_TYPE)}, ${q(OTHER_ORG)}, 'other');
            insert into public.playbooks(id, user_id, org_id, visibility, name, content_json, status) values
              (${q(READY)}, ${q(MEMBER)}, ${q(ORG)}, 'organization', 'Listo', '{}', 'ready'),
              (${q(DRAFT)}, ${q(MEMBER)}, ${q(ORG)}, 'organization', 'Borrador', '{}', 'draft'),
              (${q(PRIVATE)}, ${q(MEMBER)}, ${q(ORG)}, 'private', 'Privado', '{}', 'ready'),
              (${q(FOREIGN)}, ${q(OUTSIDER)}, ${q(OTHER_ORG)}, 'organization', 'Ajeno', '{}', 'ready');`);
    });

    it("links a ready playbook shared with the same firm, to several types and back", () => {
        psql(link(TYPE, READY));
        psql(`insert into public.matter_request_types(id, organization_id, seed_key) values (${q(72)}, ${q(ORG)}, 'other')`);
        psql(link(72, READY));
        expect(psql("select count(*) from public.request_type_playbooks")).toBe("2");
    });

    it("refuses a draft, a private playbook, another firm's playbook and another firm's type", () => {
        expect(failure(link(TYPE, DRAFT))).toContain("ready playbook");
        expect(failure(link(TYPE, PRIVATE))).toContain("ready playbook");
        expect(failure(link(TYPE, FOREIGN))).toContain("ready playbook");
        expect(failure(link(TYPE, 999))).toContain("ready playbook");
        expect(failure(link(OTHER_TYPE, READY))).toContain("another firm");
        expect(failure(link(TYPE, READY, OTHER_ORG))).toContain("another firm");
        expect(failure(`insert into public.request_type_playbooks(org_id, type_id, playbook_id, unlinked_at)
            values (${q(ORG)}, ${q(TYPE)}, ${q(READY)}, now())`)).toContain("starts open");
        expect(psql("select count(*) from public.request_type_playbooks")).toBe("0");
    });

    it("keeps one open link per type and playbook, and lets a link be made again after unlinking", () => {
        psql(link(TYPE, READY));
        expect(failure(link(TYPE, READY))).toContain("request_type_playbooks_open_idx");
        psql(`update public.request_type_playbooks set unlinked_at = now(), unlinked_by = ${q(MEMBER)}`);
        psql(link(TYPE, READY));
        expect(psql("select count(*) from public.request_type_playbooks")).toBe("2");
        expect(psql("select count(*) from public.request_type_playbooks where unlinked_at is null")).toBe("1");
    });

    it("never deletes, and changes a link only by unlinking it once", () => {
        psql(link(TYPE, READY));
        expect(failure("delete from public.request_type_playbooks")).toContain("keeps its history");
        expect(failure(`update public.request_type_playbooks set playbook_id = ${q(DRAFT)}`)).toContain("only changes by being unlinked");
        expect(failure("update public.request_type_playbooks set linked_by = null")).toContain("only changes by being unlinked");
        psql(`update public.request_type_playbooks set unlinked_at = now(), unlinked_by = ${q(MEMBER)}`);
        expect(failure("update public.request_type_playbooks set unlinked_at = now()")).toContain("only changes by being unlinked");
        expect(failure("update public.request_type_playbooks set unlinked_at = null")).toContain("only changes by being unlinked");
        expect(psql("select count(*) from public.request_type_playbooks")).toBe("1");
    });

    it("lets erasing an account and deleting a playbook go ahead", () => {
        psql(link(TYPE, READY));
        psql(`set session_replication_role = replica; delete from auth.users where id = ${q(MEMBER)}`);
        psql(`delete from public.playbooks where id = ${q(READY)}`);
        expect(psql("select count(*) from public.request_type_playbooks")).toBe("1");
    });

    it("grants the service role reads and writes, a member reads only, nobody else anything", () => {
        psql(link(TYPE, READY));
        expect(asUser(MEMBER, "select count(*) from public.request_type_playbooks")).toBe("1");
        expect(asUser(OUTSIDER, "select count(*) from public.request_type_playbooks")).toBe("0");
        expect(failure(`begin; set local role authenticated;
            select set_config('request.jwt.claim.sub', ${q(MEMBER)}, true);
            ${link(TYPE, READY)}; commit;`)).toContain("permission denied");
        expect(failure(`begin; set local role authenticated; update public.request_type_playbooks set unlinked_at = now(); commit;`)).toContain("permission denied");
        expect(failure("begin; set local role anon; select 1 from public.request_type_playbooks; commit;")).toContain("permission denied");
        expect(psql(`begin; set local role service_role; select count(*) from public.request_type_playbooks; commit;`).split("\n").pop()).toBe("1");
        expect(failure("begin; set local role service_role; delete from public.request_type_playbooks; commit;")).toContain("permission denied");
        expect(psql("select relrowsecurity from pg_class where oid = 'public.request_type_playbooks'::regclass")).toBe("t");
    });
});
