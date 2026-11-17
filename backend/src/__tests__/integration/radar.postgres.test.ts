import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The radar's action events (20261116_70_litt_matter_radar_events.sql): the
// constraints, the insert-only events, the one-way order (ack, then dismiss or
// done), the reason a dismissal needs, row-level security (read by the matter's
// active roster only, no browser write) and account erasure (no actor column
// blocks deleting an account). Opt in with MIKE_TEST_POSTGRES_CONTAINER=<a
// supabase/postgres container>; all writes target a disposable database
// dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_radar_${process.pid}_${Date.now()}`;
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
/** One statement as a browser user: the `authenticated` role with `sub` set. */
const asUser = (user: number, statement: string) =>
    psql(`begin; set local role authenticated;
        select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
        ${statement};
        commit;`).split("\n").pop()!;

const OWNER = 1;
const EDITOR = 2;
const VIEWER = 3;
const ORG_ADMIN = 4;
const REVOKED = 5;
const LEFT_FIRM = 6;
const OUTSIDER = 7;
const ORG = 10;
const OTHER_ORG = 11;
const WORKSPACE = 20;
const MATTER = 30;
const PLAIN_MATTER = 31;
const PROJECT = 40;
const DOC = 50;
const VERSION = 60;
const FACT = 80;
const SHA = "a".repeat(64);

const insertFact = (extra: { matter?: number; id?: number; kind?: string; label?: string; data?: string; start?: number; end?: number; quote?: string; sha?: string } = {}) =>
    `insert into public.matter_profile_facts(id, matter_id, kind, label, data, document_id, version_id, start_char, end_char, quote, text_sha256, created_by)
     values (${q(extra.id ?? FACT)}, ${q(extra.matter ?? MATTER)}, '${extra.kind ?? "contract"}', '${extra.label ?? "Arrendamiento"}',
             '${extra.data ?? '{"counterparty":"A"}'}', ${q(DOC)}, ${q(VERSION)}, ${extra.start ?? 10}, ${extra.end ?? 20},
             '${extra.quote ?? "una cita"}', '${extra.sha ?? SHA}', ${q(EDITOR)})`;
const insertAction = (action: string, extra: { type?: string; reason?: string | null; due?: string | null; fact?: number; matter?: number } = {}) =>
    `insert into public.matter_radar_item_events(fact_id, matter_id, item_type, action, due_on, reason, actor_user_id)
     values (${q(extra.fact ?? FACT)}, ${q(extra.matter ?? MATTER)}, '${extra.type ?? "expiry"}', '${action}',
             ${extra.due === null ? "null" : `'${extra.due ?? "2026-12-31"}'`}, ${extra.reason == null ? "null" : `'${extra.reason}'`}, ${q(EDITOR)})`;

describe.skipIf(!container)("deadline radar events in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261116_70_litt_matter_radar_events.sql"), "utf8");
        psql(migration);
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        // Replica mode skips the guard triggers (insert-only) for the cleanup only.
        psql(`set session_replication_role = replica;
            truncate public.matter_radar_item_events, public.matter_profile_fact_events, public.matter_profile_facts cascade;
            delete from public.document_versions; delete from public.documents; delete from public.projects;
            delete from public.matter_memberships; delete from public.matters;
            delete from public.workspaces; delete from public.org_members;
            delete from public.organizations; delete from auth.users;`);
        psql(`insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
            insert into public.organizations(id, name, kind) values (${q(ORG)}, 'Firm', 'team'), (${q(OTHER_ORG)}, 'Other', 'team');
            insert into public.org_members(org_id, user_id, role) values
              (${q(ORG)}, ${q(OWNER)}, 'owner'), (${q(ORG)}, ${q(EDITOR)}, 'member'), (${q(ORG)}, ${q(VIEWER)}, 'member'),
              (${q(ORG)}, ${q(ORG_ADMIN)}, 'admin'), (${q(ORG)}, ${q(REVOKED)}, 'member'),
              (${q(OTHER_ORG)}, ${q(OUTSIDER)}, 'owner');
            insert into public.workspaces(id, organization_id, name) values (${q(WORKSPACE)}, ${q(ORG)}, 'W');
            insert into public.matters(id, workspace_id, name, is_retainer) values
              (${q(MATTER)}, ${q(WORKSPACE)}, 'Iguala', true), (${q(PLAIN_MATTER)}, ${q(WORKSPACE)}, 'Juicio', false);
            insert into public.matter_memberships(matter_id, user_id, role, status) values
              (${q(MATTER)}, ${q(OWNER)}, 'matter_owner', 'active'), (${q(MATTER)}, ${q(EDITOR)}, 'editor', 'active'),
              (${q(MATTER)}, ${q(VIEWER)}, 'viewer', 'active'), (${q(MATTER)}, ${q(REVOKED)}, 'editor', 'revoked'),
              (${q(MATTER)}, ${q(LEFT_FIRM)}, 'editor', 'active');
            insert into public.projects(id, name, org_id) values (${q(PROJECT)}, 'P', ${q(ORG)});
            insert into public.documents(id, project_id) values (${q(DOC)}, ${q(PROJECT)});
            insert into public.document_versions(id, document_id, version_number) values (${q(VERSION)}, ${q(DOC)}, 1);
            ${insertFact()};
            insert into public.matter_profile_fact_events(fact_id, matter_id, actor_user_id, action) values (${q(FACT)}, ${q(MATTER)}, ${q(EDITOR)}, 'created');`);
    });

    it("has a column for no hours, minutes or estimates", () => {
        expect(
            psql(`select count(*) from information_schema.columns where table_schema = 'public'
              and table_name = 'matter_radar_item_events' and column_name ~* '(hour|minute|estimate|duration|time_spent)'`),
        ).toBe("0");
    });

    it("is created by the migration over the final schema without changing it (re-run twice in setup)", () => {
        expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.matter_radar_item_events'::regclass and not tgisinternal`)).toBe("1");
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261116_70_litt_matter_radar_events.sql'`)).toBe("1");
    });

    it("enforces the vocabulary, and a reason for a dismissal", () => {
        // The guard trigger runs before the CHECKs, so an unknown action fails there.
        expect(failure(insertAction("snooze"))).toMatch(/check|does not follow/);
        expect(failure(insertAction("ack", { type: "monthly" }))).toContain("check");
        expect(failure(insertAction("dismiss"))).toContain("dismiss_reason");
        expect(failure(insertAction("dismiss", { reason: "   " }))).toContain("dismiss_reason");
        expect(failure(insertAction("done", { reason: "x".repeat(501) }))).toContain("check");
        psql(insertAction("dismiss", { reason: "No aplica" }));
        expect(psql("select count(*) from public.matter_radar_item_events")).toBe("1");
    });

    it("keeps events insert-only and bound to a fact of the same matter", () => {
        psql(insertAction("ack"));
        expect(failure(`update public.matter_radar_item_events set reason = 'x'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_radar_item_events`)).toContain("insert-only");
        expect(failure(insertAction("done", { matter: PLAIN_MATTER }))).toContain("foreign key");
        expect(failure(insertAction("done", { fact: 99 }))).toContain("foreign key");
        expect(psql("select count(*) from public.matter_radar_item_events")).toBe("1");
    });

    it("moves an item one way: ack, then dismiss or done, each item on its own", () => {
        psql(insertAction("ack"));
        expect(failure(insertAction("ack"))).toContain("does not follow");
        // Another item of the same fact is independent.
        psql(insertAction("ack", { type: "notice", due: "2026-12-01" }));
        psql(insertAction("done"));
        expect(failure(insertAction("done"))).toContain("does not follow");
        expect(failure(insertAction("dismiss", { reason: "x" }))).toContain("does not follow");
        expect(failure(insertAction("ack"))).toContain("does not follow");
        // Straight to dismiss, or to done, without an ack, is allowed.
        psql(insertAction("dismiss", { type: "power_expiry", reason: "x", due: null }));
        expect(failure(insertAction("done", { type: "power_expiry", due: null }))).toContain("does not follow");
        expect(psql("select count(*) from public.matter_radar_item_events")).toBe("4");
    });

    it("never deletes the fact an event names", () => {
        psql(insertAction("ack"));
        expect(failure(`delete from public.matter_profile_facts`)).toContain("insert-only");
    });

    it("shows events to the matter's active roster only", () => {
        psql(insertAction("ack"));
        const count = (user: number) => asUser(user, "select count(*) from public.matter_radar_item_events");
        for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user), String(user)).toBe("1");
        for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user), String(user)).toBe("0");
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(count(VIEWER)).toBe("0");
    });

    it("gives the browser no write at all, and the backend role no change or delete", () => {
        psql(insertAction("ack"));
        const denied = (statement: string, user = OWNER) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(insertAction("done"));
        denied(`update public.matter_radar_item_events set reason = 'x'`);
        denied(`delete from public.matter_radar_item_events`);
        psql(`begin; set local role service_role; ${insertAction("done")}; commit;`);
        expect(failure(`begin; set local role service_role; update public.matter_radar_item_events set reason = 'x';`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; delete from public.matter_radar_item_events;`)).toContain("permission denied");
    });

    it("lets the person who acted delete their account, and keeps the event", () => {
        psql(insertAction("ack"));
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select actor_user_id from public.matter_radar_item_events`)).toBe(uid(EDITOR));
        expect(
            psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
              where t.relname = 'matter_radar_item_events' and c.contype = 'f' and c.confrelid = 'auth.users'::regclass`),
        ).toBe("0");
    });
});
