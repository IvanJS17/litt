import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Requests of a retainer matter (20261116_30_litt_matter_requests.sql): the
// retainer guard, the constraints, the insert-only events, row-level security
// (read by the matter's active roster only, no browser write) and account
// erasure (no actor column blocks deleting an account). Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_matter_requests_${process.pid}_${Date.now()}`;
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
const OTHER_MATTER = 32;
const PROJECT = 40;
const DOC = 50;
const VERSION = 60;
const VERSION_2 = 61;
const TYPE = 70;
const REQUEST = 80;

describe.skipIf(!container)("matter requests in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261116_30_litt_matter_requests.sql"), "utf8");
        psql(migration);
        psql(migration);
        const counts = readFileSync(resolve(process.cwd(), "migrations", "20261116_50_litt_matter_request_counts.sql"), "utf8");
        psql(counts);
        psql(counts);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        // Replica mode skips the guard triggers (last owner, insert-only) for the cleanup only.
        psql(`set session_replication_role = replica;
            truncate public.matter_request_rounds, public.matter_request_events,
                public.matter_requests, public.matter_request_types cascade;
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
            insert into public.document_versions(id, document_id, version_number) values
              (${q(VERSION)}, ${q(DOC)}, 1), (${q(VERSION_2)}, ${q(DOC)}, 2);
            insert into public.matter_request_types(id, organization_id, seed_key) values (${q(TYPE)}, ${q(ORG)}, 'contracts_clients');
            insert into public.matter_requests(id, matter_id, type_id, title, complexity, created_by, assignee_user_id, assignee_level)
              values (${q(REQUEST)}, ${q(MATTER)}, ${q(TYPE)}, 'Contrato', 'standard', ${q(EDITOR)}, ${q(EDITOR)}, 'junior');
            insert into public.matter_request_events(request_id, matter_id, actor_user_id, action)
              values (${q(REQUEST)}, ${q(MATTER)}, ${q(EDITOR)}, 'created');`);
    });

    it("has a column for no hours, minutes or estimates", () => {
        expect(
            psql(`select count(*) from information_schema.columns where table_schema = 'public'
              and table_name like 'matter_request%' and column_name ~* '(hour|minute|estimate|duration|time_spent)'`),
        ).toBe("0");
    });

    it("takes requests only in a retainer matter, and never moves one", () => {
        expect(failure(`insert into public.matter_requests(matter_id, type_id, title, complexity)
            values (${q(PLAIN_MATTER)}, ${q(TYPE)}, 'x', 'routine')`)).toContain("private retainer matter");
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(OTHER_MATTER)}, ${q(WORKSPACE)}, 'Otra', true)`);
        // A public matter takes none, even marked as a retainer.
        psql(`update public.matters set visibility = 'public' where id = ${q(OTHER_MATTER)}`);
        expect(failure(`insert into public.matter_requests(matter_id, type_id, title, complexity)
            values (${q(OTHER_MATTER)}, ${q(TYPE)}, 'x', 'routine')`)).toContain("private retainer matter");
        psql(`update public.matters set visibility = 'private' where id = ${q(OTHER_MATTER)}`);
        expect(failure(`update public.matter_requests set matter_id = ${q(OTHER_MATTER)}`)).toContain("never changed");
    });

    it("enforces the vocabulary and the paired columns", () => {
        const bad = (set: string) => failure(`update public.matter_requests set ${set}`);
        expect(bad(`status = 'finished'`)).toContain("check");
        expect(bad(`complexity = 'huge'`)).toContain("check");
        expect(bad(`assignee_level = 'boss'`)).toContain("check");
        expect(bad(`assignee_level = null`)).toContain("assignee_level");
        expect(bad(`title = '   '`)).toContain("check");
        expect(bad(`status = 'closed'`)).toContain("closed_on");
        expect(bad(`closed_on = current_date`)).toContain("closed_on");
        expect(bad(`status = 'closed', closed_on = received_on - 1`)).toContain("check");
        psql(`update public.matter_requests set status = 'closed', closed_on = current_date`);
        expect(failure(`insert into public.matter_request_types(organization_id) values (${q(ORG)})`)).toContain("named");
        expect(failure(`insert into public.matter_request_types(organization_id, seed_key) values (${q(ORG)}, 'contracts_clients')`)).toContain("duplicate");
    });

    it("keeps events insert-only", () => {
        expect(failure(`update public.matter_request_events set action = 'edited'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_request_events`)).toContain("insert-only");
        expect(failure(`insert into public.matter_request_events(request_id, matter_id, action)
            values (${q(REQUEST)}, ${q(MATTER)}, 'deleted')`)).toContain("check");
        // An event cannot name a request of another matter.
        expect(failure(`insert into public.matter_request_events(request_id, matter_id, action)
            values (${q(REQUEST)}, ${q(PLAIN_MATTER)}, 'edited')`)).toContain("foreign key");
        expect(psql("select count(*) from public.matter_request_events")).toBe("1");
    });

    it("never deletes a request, and keeps the history when a document goes", () => {
        expect(failure(`delete from public.matter_requests`)).toContain("matter_request_events");
        psql(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(MATTER)}, 1, current_date, ${q(DOC)}, ${q(VERSION)})`);
        expect(failure(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(MATTER)}, 2, current_date, ${q(DOC)}, ${q(VERSION)})`)).toContain("duplicate");
        expect(failure(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(MATTER)}, 100, current_date, ${q(DOC)}, ${q(VERSION_2)})`)).toContain("check");
        // A round of another matter's request is refused by the composite key.
        expect(failure(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(PLAIN_MATTER)}, 2, current_date, ${q(DOC)}, ${q(VERSION_2)})`)).toContain("foreign key");
        psql(`delete from public.documents where id = ${q(DOC)}`);
        expect(psql("select count(*) from public.matter_request_rounds")).toBe("0");
        expect(psql("select count(*) from public.matter_requests")).toBe("1");
        expect(psql("select count(*) from public.matter_request_events")).toBe("1");
    });

    it("shows a request to the matter's active roster only", () => {
        const count = (user: number, table = "matter_requests") => asUser(user, `select count(*) from public.${table}`);
        for (const table of ["matter_requests", "matter_request_events"]) {
            for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user, table), `${table} ${user}`).toBe("1");
            // Org admin without a membership, a revoked member, a member who left the
            // firm (no org_members row), and another firm's owner see nothing.
            for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user, table), `${table} ${user}`).toBe("0");
        }
        // Removing the member ends the read in the same request.
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(count(VIEWER)).toBe("0");
        psql(`delete from public.org_members where org_id = ${q(ORG)} and user_id = ${q(EDITOR)}`);
        expect(count(EDITOR)).toBe("0");
    });

    it("shows rounds to the roster and the catalog to the firm", () => {
        psql(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(MATTER)}, 1, current_date, ${q(DOC)}, ${q(VERSION)})`);
        expect(asUser(VIEWER, "select count(*) from public.matter_request_rounds")).toBe("1");
        expect(asUser(ORG_ADMIN, "select count(*) from public.matter_request_rounds")).toBe("0");
        expect(asUser(ORG_ADMIN, "select count(*) from public.matter_request_types")).toBe("1");
        expect(asUser(OUTSIDER, "select count(*) from public.matter_request_types")).toBe("0");
    });

    it("gives the browser no write at all", () => {
        const denied = (statement: string, user = OWNER) => {
            const message = failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`);
            expect(message).toContain("permission denied");
        };
        denied(`insert into public.matter_requests(matter_id, type_id, title, complexity) values (${q(MATTER)}, ${q(TYPE)}, 'x', 'routine')`);
        denied(`update public.matter_requests set title = 'x'`);
        denied(`delete from public.matter_requests`);
        denied(`insert into public.matter_request_events(request_id, matter_id, action) values (${q(REQUEST)}, ${q(MATTER)}, 'edited')`);
        denied(`insert into public.matter_request_types(organization_id, name) values (${q(ORG)}, 'x')`);
        denied(`insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id)
            values (${q(REQUEST)}, ${q(MATTER)}, 1, current_date, ${q(DOC)}, ${q(VERSION)})`);
        expect(psql("select title from public.matter_requests")).toBe("Contrato");
    });

    it("lets the backend role write requests and events, but never change or delete an event", () => {
        const asBackend = (statement: string) => psql(`begin; set local role service_role; ${statement}; commit;`);
        asBackend(`update public.matter_requests set title = 'Nuevo'`);
        asBackend(`insert into public.matter_request_events(request_id, matter_id, action) values (${q(REQUEST)}, ${q(MATTER)}, 'edited')`);
        expect(failure(`begin; set local role service_role; delete from public.matter_request_events;`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; delete from public.matter_requests;`)).toContain("permission denied");
    });

    it("lets the people named on a request delete their account, and keeps the request", () => {
        // Creator, assignee and event actor all point at EDITOR, with no foreign key.
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select created_by, assignee_user_id from public.matter_requests`)).toBe(`${uid(EDITOR)}|${uid(EDITOR)}`);
        expect(psql(`select actor_user_id from public.matter_request_events`)).toBe(uid(EDITOR));
        expect(
            psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
              where t.relname like 'matter_request%' and c.contype = 'f'
                and c.confrelid = 'auth.users'::regclass`),
        ).toBe("0");
    });

    describe("firm counts (20261116_50)", () => {
        const SECOND_MATTER = 33;
        const TYPE_2 = 71;
        const counts = (user: number, start = "2026-11-01", end = "2026-11-30", role = "service_role") =>
            JSON.parse(
                psql(`begin; set local role ${role};
                    select public.matter_request_counts(${q(ORG)}, ${q(user)}, '${start}', '${end}');
                    commit;`).split("\n").pop()!,
            );
        const seed = () => {
            psql(`set session_replication_role = replica;
                update public.matters set created_at = '2026-01-01' where id = ${q(MATTER)};
                insert into public.matters(id, workspace_id, name, is_retainer, created_at)
                  values (${q(SECOND_MATTER)}, ${q(WORKSPACE)}, 'Iguala secreta Patito', true, '2026-02-01');
                insert into public.matter_request_types(id, organization_id, name, sort_order) values (${q(TYPE_2)}, ${q(ORG)}, 'Tipo propio', 20);
                delete from public.matter_request_events; delete from public.matter_requests;
                insert into public.matter_requests(id, matter_id, type_id, title, complexity, status, assignee_user_id, assignee_level, received_on, closed_on) values
                  (${q(80)}, ${q(MATTER)}, ${q(TYPE)}, 'Titulo secreto uno', 'routine', 'closed', ${q(EDITOR)}, 'junior', '2026-11-01', '2026-11-05'),
                  (${q(81)}, ${q(MATTER)}, ${q(TYPE)}, 'Titulo secreto dos', 'complex', 'closed', ${q(EDITOR)}, 'senior', '2026-10-20', '2026-11-10'),
                  (${q(82)}, ${q(MATTER)}, ${q(TYPE_2)}, 'Titulo secreto tres', 'standard', 'in_review', null, null, '2026-11-15', null),
                  (${q(83)}, ${q(SECOND_MATTER)}, ${q(TYPE_2)}, 'Titulo secreto cuatro', 'standard', 'cancelled', null, null, '2026-11-02', '2026-11-03'),
                  (${q(84)}, ${q(SECOND_MATTER)}, ${q(TYPE)}, 'Titulo secreto cinco', 'routine', 'received', null, null, '2026-09-30', null);
                insert into public.matter_request_rounds(request_id, matter_id, round_number, round_date, document_id, version_id) values
                  (${q(80)}, ${q(MATTER)}, 1, '2026-11-01', ${q(DOC)}, ${q(VERSION)}),
                  (${q(80)}, ${q(MATTER)}, 2, '2026-11-03', ${q(DOC)}, ${q(VERSION_2)});`);
        };

        it("counts the period, with opaque matter labels and a median in calendar days", () => {
            seed();
            const result = counts(ORG_ADMIN);
            expect(result.totals).toEqual({
                received: 3, open: 1, closed: 1, cancelled: 1,
                open_at_end: 2, closed_in_period: 2, cancelled_in_period: 1,
                rounds: 2, median_days: 12.5,
            });
            expect(result.by_matter).toEqual([
                { ordinal: 1, total: 2, open: 1, closed: 1, cancelled: 0, rounds: 2, median_days: 12.5 },
                { ordinal: 2, total: 1, open: 0, closed: 0, cancelled: 1, rounds: 0, median_days: null },
            ]);
            expect(result.by_type.map((row: Record<string, unknown>) => [row.seed_key, row.name, row.total])).toEqual([
                ["contracts_clients", null, 1],
                [null, "Tipo propio", 2],
            ]);
            expect(result.by_complexity.map((row: Record<string, unknown>) => [row.key, row.total])).toEqual([
                ["routine", 1], ["standard", 2], ["complex", 0],
            ]);
            expect(result.by_level.map((row: Record<string, unknown>) => [row.key, row.total])).toEqual([
                ["apprentice", 0], ["junior", 1], ["senior", 0], ["partner", 0], ["unassigned", 2],
            ]);
            expect(result.by_status.map((row: Record<string, unknown>) => [row.key, row.total])).toEqual([
                ["received", 0], ["in_review", 1], ["with_client", 0], ["with_counterparty", 0], ["closed", 1], ["cancelled", 1],
            ]);
        });

        it("counts a quarter and an empty period", () => {
            seed();
            expect(counts(OWNER, "2026-10-01", "2026-12-31").totals).toMatchObject({ received: 4, closed_in_period: 2, median_days: 12.5 });
            const empty = counts(OWNER, "2025-01-01", "2025-01-31");
            expect(empty.totals).toMatchObject({ received: 0, closed_in_period: 0, median_days: null, rounds: 0 });
            expect(empty.by_matter).toHaveLength(2);
        });

        it("returns numbers and labels only: no title, matter name, person or id of a request", () => {
            seed();
            const text = JSON.stringify(counts(ORG_ADMIN, "2026-01-01", "2026-12-31"));
            for (const secret of ["Titulo secreto", "Iguala secreta", "Patito", "Contrato", uid(MATTER), uid(80), uid(EDITOR), "title", "name\":\"Iguala"])
                expect(text).not.toContain(secret);
        });

        it("answers an owner or admin of the firm and nobody else", () => {
            seed();
            expect(counts(OWNER).totals.received).toBe(3);
            for (const user of [EDITOR, VIEWER, REVOKED, OUTSIDER])
                expect(failure(`select public.matter_request_counts(${q(ORG)}, ${q(user)}, '2026-11-01', '2026-11-30')`)).toContain("owner or admin");
            expect(failure(`select public.matter_request_counts(${q(OTHER_ORG)}, ${q(OWNER)}, '2026-11-01', '2026-11-30')`)).toContain("owner or admin");
            expect(failure(`select public.matter_request_counts(${q(ORG)}, ${q(OWNER)}, '2026-11-30', '2026-11-01')`)).toContain("invalid period");
        });

        it("is executable by service_role alone", () => {
            seed();
            for (const role of ["authenticated", "anon"])
                expect(failure(`set role ${role}; select public.matter_request_counts(${q(ORG)}, ${q(OWNER)}, '2026-11-01', '2026-11-30')`)).toContain("permission denied");
            expect(
                psql(`select prosecdef, proconfig::text from pg_proc where proname = 'matter_request_counts'`),
            ).toBe("t|{\"search_path=public, pg_temp\"}");
        });
    });
});
