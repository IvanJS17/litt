import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The retainer report's "sent" record (20261117_40_litt_matter_report_sent.sql):
// the constraints, insert-only, private retainer matters only, row-level
// security (read by the matter's active roster only, no browser write), the
// backend role's insert-only grant and account erasure (no actor foreign key).
// Opt in with MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all
// writes target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_report_${process.pid}_${Date.now()}`;
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
const PUBLIC_MATTER = 32;

const PERIOD = { start: "2026-08-20", end: "2026-11-17", days: 90 };
const insertSent = (extra: { matter?: number; start?: string; end?: string; days?: number; note?: string | null } = {}) =>
    `insert into public.matter_report_sent_events(matter_id, period_start, period_end, period_days, note, actor_user_id)
     values (${q(extra.matter ?? MATTER)}, '${extra.start ?? PERIOD.start}', '${extra.end ?? PERIOD.end}', ${extra.days ?? PERIOD.days},
             ${extra.note == null ? "null" : `'${extra.note}'`}, ${q(EDITOR)})`;

describe.skipIf(!container)("retainer report sent records in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261117_40_litt_matter_report_sent.sql"), "utf8");
        psql(migration);
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    }, 60_000);

    beforeEach(() => {
        // Replica mode skips the guard triggers (insert-only) for the cleanup only.
        psql(`set session_replication_role = replica;
            truncate public.matter_report_sent_events cascade;
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
            insert into public.matters(id, workspace_id, name, is_retainer, visibility) values
              (${q(PUBLIC_MATTER)}, ${q(WORKSPACE)}, 'Pública', true, 'public');
            insert into public.matter_memberships(matter_id, user_id, role, status) values
              (${q(MATTER)}, ${q(OWNER)}, 'matter_owner', 'active'), (${q(MATTER)}, ${q(EDITOR)}, 'editor', 'active'),
              (${q(MATTER)}, ${q(VIEWER)}, 'viewer', 'active'), (${q(MATTER)}, ${q(REVOKED)}, 'editor', 'revoked'),
              (${q(MATTER)}, ${q(LEFT_FIRM)}, 'editor', 'active');`);
    });

    it("has a column for no hours, minutes or estimates", () => {
        expect(
            psql(`select count(*) from information_schema.columns where table_schema = 'public'
              and table_name = 'matter_report_sent_events' and column_name ~* '(hour|minute|estimate|duration|time_spent)'`),
        ).toBe("0");
    });

    it("is created by the migration over the final schema without changing it (re-run twice in setup)", () => {
        expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.matter_report_sent_events'::regclass and not tgisinternal`)).toBe("1");
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261117_40_litt_matter_report_sent.sql'`)).toBe("1");
    });

    it("accepts a period of 30, 60 or 90 whole calendar days, with or without a note", () => {
        psql(insertSent());
        psql(insertSent({ days: 30, start: "2026-10-19", note: "Enviado por correo" }));
        psql(insertSent({ days: 60, start: "2026-09-19" }));
        expect(psql("select count(*) from public.matter_report_sent_events")).toBe("3");
    });

    it("refuses a period that is not its length, a length outside the menu and a long note", () => {
        expect(failure(insertSent({ days: 45, start: "2026-10-04" }))).toContain("check");
        expect(failure(insertSent({ days: 90, start: "2026-08-21" }))).toContain("matter_report_sent_events_period");
        expect(failure(insertSent({ start: "2026-12-01" }))).toContain("matter_report_sent_events_period");
        expect(failure(insertSent({ note: "x".repeat(501) }))).toContain("check");
        expect(psql("select count(*) from public.matter_report_sent_events")).toBe("0");
    });

    it("belongs to a private retainer matter only", () => {
        expect(failure(insertSent({ matter: PLAIN_MATTER }))).toContain("private retainer");
        expect(failure(insertSent({ matter: PUBLIC_MATTER }))).toContain("private retainer");
        expect(failure(insertSent({ matter: 99 }))).toMatch(/private retainer|foreign key/);
    });

    it("is insert-only", () => {
        psql(insertSent());
        expect(failure(`update public.matter_report_sent_events set note = 'x'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_report_sent_events`)).toContain("insert-only");
        expect(psql("select count(*) from public.matter_report_sent_events")).toBe("1");
    });

    it("shows records to the matter's active roster only", () => {
        psql(insertSent());
        const count = (user: number) => asUser(user, "select count(*) from public.matter_report_sent_events");
        for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user), String(user)).toBe("1");
        for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user), String(user)).toBe("0");
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(count(VIEWER)).toBe("0");
    });

    it("gives the browser no write at all, and the backend role insert and read only", () => {
        psql(insertSent());
        const denied = (statement: string, user = OWNER) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(insertSent());
        denied(`update public.matter_report_sent_events set note = 'x'`);
        denied(`delete from public.matter_report_sent_events`);
        psql(`begin; set local role service_role; ${insertSent()}; select count(*) from public.matter_report_sent_events; commit;`);
        expect(failure(`begin; set local role service_role; update public.matter_report_sent_events set note = 'x';`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; delete from public.matter_report_sent_events;`)).toContain("permission denied");
    });

    it("lets the person who marked it delete their account, and keeps the record", () => {
        psql(insertSent());
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select actor_user_id from public.matter_report_sent_events`)).toBe(uid(EDITOR));
        expect(
            psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
              where t.relname = 'matter_report_sent_events' and c.contype = 'f' and c.confrelid = 'auth.users'::regclass`),
        ).toBe("0");
    });

    it("never lets a matter with records be deleted", () => {
        psql(insertSent());
        expect(failure(`delete from public.matters where id = ${q(MATTER)}`)).toMatch(/foreign key|restrict|violates/);
    });
});
