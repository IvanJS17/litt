import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The client profile of a retainer matter (20261116_60_litt_matter_profile_facts.sql):
// the retainer guard, the constraints, the insert-only facts and events, the
// one-way decision order, row-level security (read by the matter's active
// roster only, no browser write) and account erasure (no actor column blocks
// deleting an account). Opt in with MIKE_TEST_POSTGRES_CONTAINER=<a
// supabase/postgres container>; all writes target a disposable database
// dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_client_profile_${process.pid}_${Date.now()}`;
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
const insertEvent = (action: string, extra = "", fact = FACT, matter = MATTER, actor = EDITOR) =>
    `insert into public.matter_profile_fact_events(fact_id, matter_id, actor_user_id, action${extra ? ", text_sha256" : ""})
     values (${q(fact)}, ${q(matter)}, ${q(actor)}, '${action}'${extra ? `, '${SHA}'` : ""})`;

describe.skipIf(!container)("client profile in PostgreSQL", () => {
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
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261116_60_litt_matter_profile_facts.sql"), "utf8");
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
            truncate public.matter_profile_fact_events, public.matter_profile_facts cascade;
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
            ${insertEvent("created")};`);
    });

    it("has a column for no hours, minutes or estimates", () => {
        expect(
            psql(`select count(*) from information_schema.columns where table_schema = 'public'
              and table_name like 'matter_profile%' and column_name ~* '(hour|minute|estimate|duration|time_spent)'`),
        ).toBe("0");
    });

    it("takes facts only in a private retainer matter", () => {
        expect(failure(insertFact({ matter: PLAIN_MATTER, id: 81 }))).toContain("private retainer matter");
        psql(`update public.matters set visibility = 'public' where id = ${q(MATTER)}`);
        expect(failure(insertFact({ id: 82 }))).toContain("private retainer matter");
    });

    it("enforces the vocabulary and the citation columns", () => {
        const bad = (extra: Parameters<typeof insertFact>[0]) => failure(insertFact({ id: 90, ...extra }));
        expect(bad({ kind: "mortgage" })).toContain("check");
        expect(bad({ label: "   " })).toContain("check");
        expect(bad({ quote: "" })).toContain("check");
        expect(bad({ start: 20, end: 20 })).toContain("matter_profile_facts_span");
        expect(bad({ start: -1 })).toContain("check");
        expect(bad({ sha: "abc" })).toContain("check");
        expect(bad({ data: "[1]" })).toContain("check");
    });

    it("keeps facts insert-only", () => {
        expect(failure(`update public.matter_profile_facts set label = 'otro'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_profile_facts`)).toContain("insert-only");
        expect(psql("select count(*) from public.matter_profile_facts")).toBe("1");
    });

    it("keeps events insert-only and bound to the fact's matter", () => {
        expect(failure(`update public.matter_profile_fact_events set action = 'rejected'`)).toContain("insert-only");
        expect(failure(`delete from public.matter_profile_fact_events`)).toContain("insert-only");
        expect(failure(`insert into public.matter_profile_fact_events(fact_id, matter_id, action)
            values (${q(FACT)}, ${q(MATTER)}, 'deleted')`)).toContain("does not follow");
        // An event cannot name a fact of another matter.
        expect(failure(insertEvent("confirmed", "hash", FACT, PLAIN_MATTER))).toContain("foreign key");
        expect(psql("select count(*) from public.matter_profile_fact_events")).toBe("1");
    });

    it("moves a fact one way: created, confirmed or rejected, and confirmed may still be rejected", () => {
        expect(failure(insertEvent("created"))).toContain("does not follow");
        expect(failure(insertEvent("confirmed"))).toContain("confirmed_hash");
        psql(insertEvent("confirmed", "hash"));
        expect(failure(insertEvent("confirmed", "hash"))).toContain("does not follow");
        expect(failure(insertEvent("created"))).toContain("does not follow");
        psql(insertEvent("rejected"));
        expect(failure(insertEvent("confirmed", "hash"))).toContain("does not follow");
        expect(failure(insertEvent("rejected"))).toContain("does not follow");
        expect(psql(`select string_agg(action, ',' order by created_at, id) from public.matter_profile_fact_events`).split(",").sort())
            .toEqual(["confirmed", "created", "rejected"]);
    });

    it("lets a decision follow a lost 'created' row", () => {
        psql(`set session_replication_role = replica; delete from public.matter_profile_fact_events;`);
        psql(insertEvent("confirmed", "hash"));
        expect(psql("select count(*) from public.matter_profile_fact_events")).toBe("1");
    });

    it("never deletes a fact, so its history stays when a document goes", () => {
        psql(`delete from public.documents where id = ${q(DOC)}`);
        expect(psql("select count(*) from public.matter_profile_facts")).toBe("1");
        expect(psql("select count(*) from public.matter_profile_fact_events")).toBe("1");
    });

    it("shows a fact to the matter's active roster only", () => {
        const count = (user: number, table = "matter_profile_facts") => asUser(user, `select count(*) from public.${table}`);
        for (const table of ["matter_profile_facts", "matter_profile_fact_events"]) {
            for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user, table), `${table} ${user}`).toBe("1");
            // Org admin without a membership, a revoked member, a member who left the
            // firm (no org_members row), and another firm's owner see nothing.
            for (const user of [ORG_ADMIN, REVOKED, LEFT_FIRM, OUTSIDER]) expect(count(user, table), `${table} ${user}`).toBe("0");
        }
        psql(`update public.matter_memberships set status = 'revoked' where user_id = ${q(VIEWER)}`);
        expect(count(VIEWER)).toBe("0");
        psql(`delete from public.org_members where org_id = ${q(ORG)} and user_id = ${q(EDITOR)}`);
        expect(count(EDITOR)).toBe("0");
    });

    it("gives the browser no write at all", () => {
        const denied = (statement: string, user = OWNER) => {
            const message = failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(user)}, true) \\g /dev/null
                ${statement};`);
            expect(message).toContain("permission denied");
        };
        denied(insertFact({ id: 91 }));
        denied(`update public.matter_profile_facts set label = 'x'`);
        denied(`delete from public.matter_profile_facts`);
        denied(insertEvent("confirmed", "hash"));
        expect(psql("select label from public.matter_profile_facts")).toBe("Arrendamiento");
    });

    it("lets the backend role write facts and events, but never change or delete them", () => {
        const asBackend = (statement: string) => psql(`begin; set local role service_role; ${statement}; commit;`);
        asBackend(insertFact({ id: 92 }));
        asBackend(insertEvent("confirmed", "hash"));
        expect(failure(`begin; set local role service_role; update public.matter_profile_fact_events set reason = 'x';`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; delete from public.matter_profile_fact_events;`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; update public.matter_profile_facts set label = 'x';`)).toContain("permission denied");
        expect(failure(`begin; set local role service_role; delete from public.matter_profile_facts;`)).toContain("permission denied");
    });

    it("lets the people named on a fact delete their account, and keeps the fact", () => {
        // Creator and event actor both point at EDITOR, with no foreign key.
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select created_by from public.matter_profile_facts`)).toBe(uid(EDITOR));
        expect(psql(`select actor_user_id from public.matter_profile_fact_events`)).toBe(uid(EDITOR));
        expect(
            psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
              where t.relname like 'matter_profile%' and c.contype = 'f'
                and c.confrelid = 'auth.users'::regclass`),
        ).toBe("0");
    });
});
