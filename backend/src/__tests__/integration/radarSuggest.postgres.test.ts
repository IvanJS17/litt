import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The rule suggestions of the radar (20261119_20_litt_rule_suggestions.sql): the
// constraints, the insert-only suggestions and decisions, the one-way order
// (accepted, then possibly discarded), the private-retainer guard, row-level
// security (read by the matter's active roster only, no browser write), the
// explicit grants to the backend role and account erasure. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_rule_suggestions_${process.pid}_${Date.now()}`;
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
const SHA = "a".repeat(64);

const SUGGESTION = 90;
const sug = (n: number, extra: { matter?: number; code?: string; version?: number; quote?: string; reason?: string; start?: number; end?: number; sha?: string; flow?: string; page?: string } = {}) =>
    `insert into public.obligation_rule_suggestions(id, flow, org_id, matter_id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, page, rule_code, rule_version, ai_reason, created_by)
     values (${q(n)}, '${extra.flow ?? "catalog_match"}', ${q(ORG)}, ${q(extra.matter ?? MATTER)}, ${q(PROJECT)}, ${q(DOC)}, ${q(VERSION)}, '${extra.sha ?? SHA}',
             ${extra.start ?? 10}, ${extra.end ?? 20}, '${extra.quote ?? "una cita"}', ${extra.page ?? "null"}, '${extra.code ?? "lgsm.asamblea_ordinaria_anual"}', ${extra.version ?? 1},
             '${extra.reason ?? "Porque el acta lo dice."}', ${q(EDITOR)})`;
const event = (suggestion: number, action: string, extra: { matter?: number; reason?: string | null } = {}) =>
    `insert into public.obligation_rule_suggestion_events(suggestion_id, matter_id, action, reason, actor_user_id)
     values (${q(suggestion)}, ${q(extra.matter ?? MATTER)}, '${action}', ${extra.reason == null ? "null" : `'${extra.reason}'`}, ${q(EDITOR)})`;
const TABLES = ["obligation_rule_suggestions", "obligation_rule_suggestion_events"];

describe.skipIf(!container)("rule suggestions in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261119_20_litt_rule_suggestions.sql"), "utf8");
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
            truncate public.obligation_rule_suggestion_events, public.obligation_rule_suggestions cascade;
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
            `);
    });

    it("has a column for no hours, minutes, dates of a deadline or estimates", () => {
        for (const table of TABLES)
            expect(
                psql(`select count(*) from information_schema.columns where table_schema = 'public'
                  and table_name = '${table}' and column_name ~* '(hour|minute|estimate|duration|time_spent|due|deadline|date_on)'`),
            ).toBe("0");
    });

    it("is created by the migration over the final schema (re-run twice in setup) and recorded in the ledger", () => {
        for (const table of TABLES)
            expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.${table}'::regclass and not tgisinternal`)).toBe("1");
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261119_20_litt_rule_suggestions.sql'`)).toBe("1");
    });

    it("grants the backend role explicitly: select and insert, nothing to change or delete", () => {
        for (const table of TABLES) {
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'select') and has_table_privilege('service_role', 'public.${table}', 'insert')`)).toBe("t");
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'update') or has_table_privilege('service_role', 'public.${table}', 'delete')`)).toBe("f");
            expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'insert') or has_table_privilege('anon', 'public.${table}', 'select')`)).toBe("f");
        }
    });

    it("enforces the shape of a suggestion: a rule code, a quote of up to 500 characters, an explanation of up to 200, a span", () => {
        psql(sug(SUGGESTION));
        expect(failure(sug(91, { code: "Bad Code" }))).toContain("check");
        expect(failure(sug(91, { code: "nodots" }))).toContain("check");
        expect(failure(sug(91, { version: 0 }))).toContain("check");
        expect(failure(sug(91, { quote: "x".repeat(501) }))).toContain("check");
        expect(failure(sug(91, { quote: "" }))).toContain("check");
        expect(failure(sug(91, { reason: "x".repeat(201) }))).toContain("check");
        expect(failure(sug(91, { reason: "" }))).toContain("check");
        expect(failure(sug(91, { sha: "nope" }))).toContain("check");
        expect(failure(sug(91, { start: 20, end: 20 }))).toContain("span");
        expect(failure(sug(91, { page: "0" }))).toContain("check");
        expect(failure(sug(91, { flow: "law_draft" }))).toContain("check");
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("1");
    });

    it("keeps a rule once per version of a document, per matter, and the matter must be a real one", () => {
        psql(sug(SUGGESTION));
        expect(failure(sug(91))).toContain("once_idx");
        // Another rule, another rule version and another matter are independent.
        psql(sug(91, { code: "lft.ptu_reparto" }));
        psql(sug(92, { version: 2 }));
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true)`);
        psql(sug(93, { matter: 32 }));
        // A matter that does not exist is not a private retainer matter either.
        expect(failure(sug(94, { matter: 99 }))).toContain("private retainer matter");
    });

    it("writes a suggestion only into a private retainer matter", () => {
        expect(failure(sug(91, { matter: 31 }))).toContain("private retainer matter");
        psql(`insert into public.matters(id, workspace_id, name, is_retainer, visibility) values (${q(33)}, ${q(WORKSPACE)}, 'Pública', true, 'public')`);
        expect(failure(sug(92, { matter: 33 }))).toContain("private retainer matter");
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("0");
    });

    it("keeps suggestions insert-only: update and delete fail in SQL", () => {
        psql(sug(SUGGESTION));
        expect(failure(`update public.obligation_rule_suggestions set ai_reason = 'otra'`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_suggestions`)).toContain("insert-only");
        expect(psql("select ai_reason from public.obligation_rule_suggestions")).toBe("Porque el acta lo dice.");
    });

    it("keeps decisions insert-only and one way: accepted, or discarded, and an accepted one may still be discarded", () => {
        psql(sug(SUGGESTION));
        psql(sug(91, { code: "lft.ptu_reparto" }));
        expect(failure(event(SUGGESTION, "snooze"))).toMatch(/check|does not follow/);
        expect(failure(event(SUGGESTION, "sent_to_legal"))).toMatch(/check|does not follow/);
        expect(failure(event(SUGGESTION, "accepted", { reason: "x".repeat(501) }))).toContain("check");
        psql(event(SUGGESTION, "accepted", { reason: "Aplica." }));
        expect(failure(event(SUGGESTION, "accepted"))).toContain("does not follow");
        expect(failure(`update public.obligation_rule_suggestion_events set reason = 'x'`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_suggestion_events`)).toContain("insert-only");
        psql(event(SUGGESTION, "discarded"));
        expect(failure(event(SUGGESTION, "discarded"))).toContain("does not follow");
        expect(failure(event(SUGGESTION, "accepted"))).toContain("does not follow");
        // Another suggestion starts on its own, and can go straight to discarded.
        psql(event(91, "discarded"));
        expect(failure(event(91, "accepted"))).toContain("does not follow");
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("3");
    });

    it("binds a decision to a suggestion of the same matter", () => {
        psql(sug(SUGGESTION));
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true)`);
        expect(failure(event(SUGGESTION, "accepted", { matter: 32 }))).toContain("foreign key");
        expect(failure(event(99, "accepted"))).toContain("foreign key");
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("0");
    });

    it("never writes a rule activation: accepting leaves the obligation rule events untouched", () => {
        psql(sug(SUGGESTION));
        psql(event(SUGGESTION, "accepted"));
        expect(psql("select count(*) from public.matter_obligation_rule_events")).toBe("0");
    });

    it("shows suggestions and decisions to the matter's active roster only", () => {
        psql(sug(SUGGESTION));
        psql(event(SUGGESTION, "accepted"));
        for (const table of TABLES) {
            const count = (user: number) => asUser(user, `select count(*) from public.${table}`);
            for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user), `${table} ${user}`).toBe("1");
            for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user), `${table} ${user}`).toBe("0");
        }
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(asUser(VIEWER, "select count(*) from public.obligation_rule_suggestions")).toBe("0");
    });

    it("gives the browser no write at all, and the backend role no change or delete", () => {
        psql(sug(SUGGESTION));
        const denied = (statement: string, user = OWNER) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(sug(91, { code: "lft.ptu_reparto" }));
        denied(event(SUGGESTION, "accepted"));
        for (const table of TABLES) {
            denied(`update public.${table} set created_at = now()`);
            denied(`delete from public.${table}`);
            expect(failure(`begin; set local role service_role; update public.${table} set created_at = now();`)).toContain("permission denied");
            expect(failure(`begin; set local role service_role; delete from public.${table};`)).toContain("permission denied");
        }
        psql(`begin; set local role service_role; ${sug(91, { code: "lft.ptu_reparto" })}; ${event(SUGGESTION, "accepted")}; commit;`);
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("1");
    });

    it("lets the person who suggested or decided delete their account, and keeps the records", () => {
        psql(sug(SUGGESTION));
        psql(event(SUGGESTION, "accepted"));
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select created_by from public.obligation_rule_suggestions`)).toBe(uid(EDITOR));
        expect(psql(`select actor_user_id from public.obligation_rule_suggestion_events`)).toBe(uid(EDITOR));
        for (const table of TABLES)
            expect(
                psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
                  where t.relname = '${table}' and c.contype = 'f' and c.confrelid = 'auth.users'::regclass`),
            ).toBe("0");
    });
});
