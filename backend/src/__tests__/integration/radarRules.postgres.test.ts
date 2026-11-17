import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The obligation rules' events (20261117_30_litt_matter_obligation_rules.sql):
// the constraints (the anchor of an activation is a fact of the same matter),
// the insert-only events, the order (on, off, on...), the one-way order of the
// actions on an item, row-level security (read by the matter's active roster
// only, no browser write), the explicit grants to the backend role and account
// erasure (no actor column blocks deleting an account). Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_obligations_${process.pid}_${Date.now()}`;
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

const KEY = "lgsm.asamblea_ordinaria_anual@1";
const insertRule = (action: string, extra: { code?: string; version?: number; matter?: number; anchor?: number | null; mode?: string | null } = {}) => {
    const anchor = extra.anchor === undefined ? (action === "activate" ? FACT : null) : extra.anchor;
    const mode = extra.mode === undefined ? (action === "activate" ? "direct" : null) : extra.mode;
    return `insert into public.matter_obligation_rule_events(matter_id, rule_code, rule_version, action, anchor_fact_id, anchor_mode, actor_user_id)
     values (${q(extra.matter ?? MATTER)}, '${extra.code ?? "lgsm.asamblea_ordinaria_anual"}', ${extra.version ?? 1}, '${action}',
             ${anchor === null ? "null" : q(anchor)}, ${mode === null ? "null" : `'${mode}'`}, ${q(EDITOR)})`;
};
const insertAction = (action: string, extra: { key?: string; reason?: string | null; due?: string | null; matter?: number } = {}) =>
    `insert into public.matter_obligation_item_events(matter_id, item_key, action, due_on, reason, actor_user_id)
     values (${q(extra.matter ?? MATTER)}, '${extra.key ?? `${KEY}:${uid(FACT)}`}', '${action}',
             ${extra.due === null ? "null" : `'${extra.due ?? "2027-04-30"}'`}, ${extra.reason == null ? "null" : `'${extra.reason}'`}, ${q(EDITOR)})`;
const insertFact = (id: number, matter: number) =>
    `insert into public.matter_profile_facts(id, matter_id, kind, label, data, document_id, version_id, start_char, end_char, quote, text_sha256, created_by)
     values (${q(id)}, ${q(matter)}, 'date', 'Cierre', '{"date_kind":"effective","date_on":"2026-12-31"}', ${q(DOC)}, ${q(VERSION)}, 10, 20, 'una cita', '${SHA}', ${q(EDITOR)})`;
const RULE_TABLES = ["matter_obligation_rule_events", "matter_obligation_item_events"];

describe.skipIf(!container)("obligation rule events in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261117_30_litt_matter_obligation_rules.sql"), "utf8");
        psql(migration);
        psql(migration);
        // The guard is replaced by a later migration (the order is per date); it is re-runnable too.
        const guard = readFileSync(resolve(process.cwd(), "migrations", "20261117_50_litt_radar_item_guard_due_on.sql"), "utf8");
        psql(guard);
        psql(guard);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        // Replica mode skips the guard triggers (insert-only) for the cleanup only.
        psql(`set session_replication_role = replica;
            truncate public.matter_obligation_rule_events, public.matter_obligation_item_events,
              public.matter_radar_item_events, public.matter_profile_fact_events, public.matter_profile_facts cascade;
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
            ${insertFact(FACT, MATTER)};`);
    });

    it("has a column for no hours, minutes or estimates", () => {
        for (const table of RULE_TABLES)
            expect(
                psql(`select count(*) from information_schema.columns where table_schema = 'public'
                  and table_name = '${table}' and column_name ~* '(hour|minute|estimate|duration|time_spent)'`),
            ).toBe("0");
    });

    it("is created by the migration over the final schema without changing it (re-run twice in setup)", () => {
        for (const table of RULE_TABLES)
            expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.${table}'::regclass and not tgisinternal`)).toBe("1");
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261117_30_litt_matter_obligation_rules.sql'`)).toBe("1");
    });

    it("grants the backend role explicitly: select and insert, nothing to change or delete", () => {
        for (const table of RULE_TABLES) {
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'select') and has_table_privilege('service_role', 'public.${table}', 'insert')`)).toBe("t");
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'update') or has_table_privilege('service_role', 'public.${table}', 'delete')`)).toBe("f");
            expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'insert') or has_table_privilege('anon', 'public.${table}', 'select')`)).toBe("f");
        }
    });

    it("enforces the vocabulary and the shape of a decision: an activation names its anchor, an off does not", () => {
        expect(failure(insertRule("snooze"))).toMatch(/check|does not follow/);
        expect(failure(insertRule("activate", { code: "Bad Code" }))).toContain("check");
        expect(failure(insertRule("activate", { code: "nodots" }))).toContain("check");
        expect(failure(insertRule("activate", { version: 0 }))).toContain("check");
        expect(failure(insertRule("activate", { anchor: null }))).toContain("anchor_shape");
        expect(failure(insertRule("activate", { mode: null }))).toContain("anchor_shape");
        expect(failure(insertRule("activate", { mode: "sometimes" }))).toContain("check");
        psql(insertRule("activate"));
        expect(failure(insertRule("deactivate", { anchor: FACT, mode: null }))).toContain("anchor_shape");
        psql(insertRule("deactivate"));
        expect(psql("select count(*) from public.matter_obligation_rule_events")).toBe("2");
    });

    it("binds the anchor to a fact of the same matter, and the matter to a real one", () => {
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true); ${insertFact(81, 32)}`);
        expect(failure(insertRule("activate", { anchor: 81 }))).toContain("foreign key");
        expect(failure(insertRule("activate", { anchor: 99 }))).toContain("foreign key");
        expect(failure(insertRule("activate", { matter: 99 }))).toContain("foreign key");
        psql(insertRule("activate", { matter: 32, anchor: 81 }));
        expect(failure(`delete from public.matter_profile_facts`)).toContain("insert-only");
    });

    it("keeps decisions insert-only and moves a rule on, off, on: the same state twice is refused, each rule version on its own", () => {
        psql(insertRule("activate"));
        expect(failure(`update public.matter_obligation_rule_events set action = 'deactivate'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_obligation_rule_events`)).toContain("insert-only");
        expect(failure(insertRule("activate"))).toContain("does not follow");
        // Another rule, another version and another matter are independent.
        psql(insertRule("activate", { code: "lft.ptu_reparto" }));
        psql(insertRule("activate", { version: 2 }));
        expect(failure(insertRule("deactivate", { code: "lft.repse_renovacion", anchor: null, mode: null }))).toContain("does not follow");
        psql(insertRule("deactivate"));
        expect(failure(insertRule("deactivate"))).toContain("does not follow");
        psql(insertRule("activate", { anchor: FACT, mode: "first_cycle" }));
        expect(psql(`select count(*) from public.matter_obligation_rule_events where rule_code = 'lgsm.asamblea_ordinaria_anual' and rule_version = 1`)).toBe("3");
    });

    it("enforces the vocabulary of an item action, the shape of its key and a reason for a dismissal", () => {
        expect(failure(insertAction("snooze"))).toMatch(/check|does not follow/);
        expect(failure(insertAction("ack", { key: "nonsense" }))).toContain("check");
        expect(failure(insertAction("ack", { key: `${KEY}:other` }))).toContain("check");
        expect(failure(insertAction("ack", { key: `Lgsm.X@1:${uid(FACT)}` }))).toContain("check");
        expect(failure(insertAction("dismiss"))).toContain("dismiss_reason");
        expect(failure(insertAction("dismiss", { reason: "   " }))).toContain("dismiss_reason");
        expect(failure(insertAction("done", { reason: "x".repeat(501) }))).toContain("check");
        psql(insertAction("dismiss", { reason: "No aplica" }));
        expect(psql("select count(*) from public.matter_obligation_item_events")).toBe("1");
    });

    it("moves an item one way: ack, then dismiss or done, each item on its own; actions are insert-only", () => {
        psql(insertAction("ack"));
        expect(failure(`update public.matter_obligation_item_events set reason = 'x'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_obligation_item_events`)).toContain("insert-only");
        expect(failure(insertAction("ack"))).toContain("does not follow");
        psql(insertAction("ack", { key: `lft.ptu_reparto@1:${uid(FACT)}`, due: "2027-05-30" }));
        psql(insertAction("done"));
        expect(failure(insertAction("done"))).toContain("does not follow");
        expect(failure(insertAction("dismiss", { reason: "x" }))).toContain("does not follow");
        expect(failure(insertAction("ack"))).toContain("does not follow");
        // Straight to dismiss, without an ack, and with no date, is allowed.
        psql(insertAction("dismiss", { key: `cff.efirma_vencimiento@1:${uid(FACT)}`, reason: "x", due: null }));
        expect(failure(insertAction("done", { key: `cff.efirma_vencimiento@1:${uid(FACT)}`, due: null }))).toContain("does not follow");
        expect(psql("select count(*) from public.matter_obligation_item_events")).toBe("4");
    });

    it("orders the actions of an item per date: the same item re-dated by another anchor mode can be acknowledged again", () => {
        // W1: the read model counts only the events of the item's current date, so a re-dated item reads open.
        psql(insertAction("ack", { due: "2027-04-30" }));
        expect(failure(insertAction("ack", { due: "2027-04-30" }))).toContain("does not follow");
        psql(insertAction("ack", { due: "2027-10-31" }));
        expect(failure(insertAction("ack", { due: "2027-10-31" }))).toContain("does not follow");
        psql(insertAction("done", { due: "2027-10-31" }));
        // The old date is still its own line: it can still be closed.
        psql(insertAction("dismiss", { due: "2027-04-30", reason: "x" }));
        expect(failure(insertAction("done", { due: "2027-04-30" }))).toContain("does not follow");
        // An undated item is its own line too.
        psql(insertAction("ack", { due: null }));
        expect(failure(insertAction("ack", { due: null }))).toContain("does not follow");
    });

    it("shows events to the matter's active roster only", () => {
        psql(insertRule("activate"));
        psql(insertAction("ack"));
        for (const table of RULE_TABLES) {
            const count = (user: number) => asUser(user, `select count(*) from public.${table}`);
            for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user), `${table} ${user}`).toBe("1");
            for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user), `${table} ${user}`).toBe("0");
        }
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(asUser(VIEWER, "select count(*) from public.matter_obligation_rule_events")).toBe("0");
    });

    it("gives the browser no write at all, and the backend role no change or delete", () => {
        psql(insertRule("activate"));
        psql(insertAction("ack"));
        const denied = (statement: string, user = OWNER) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(insertRule("deactivate"));
        denied(insertAction("done"));
        for (const table of RULE_TABLES) {
            denied(`update public.${table} set actor_user_id = null`);
            denied(`delete from public.${table}`);
            expect(failure(`begin; set local role service_role; update public.${table} set actor_user_id = null;`)).toContain("permission denied");
            expect(failure(`begin; set local role service_role; delete from public.${table};`)).toContain("permission denied");
        }
        psql(`begin; set local role service_role; ${insertRule("deactivate")}; ${insertAction("done")}; commit;`);
        expect(psql("select count(*) from public.matter_obligation_rule_events")).toBe("2");
    });

    it("lets the person who decided delete their account, and keeps the events", () => {
        psql(insertRule("activate"));
        psql(insertAction("ack"));
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select actor_user_id from public.matter_obligation_rule_events`)).toBe(uid(EDITOR));
        expect(psql(`select actor_user_id from public.matter_obligation_item_events`)).toBe(uid(EDITOR));
        for (const table of RULE_TABLES)
            expect(
                psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
                  where t.relname = '${table}' and c.contype = 'f' and c.confrelid = 'auth.users'::regclass`),
            ).toBe("0");
    });
});
