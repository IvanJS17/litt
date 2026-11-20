import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Donna's triage of requests (20261119_80_litt_donna_triage.sql): the project
// switch (on by default, also for projects that already existed), the insert-only
// runs, items and decisions (no update, delete or truncate), the shape of an item,
// the new event actions, row-level security (read by the matter's roster, no
// browser write) and that no column of a run holds text. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes target
// a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_donna_triage_${process.pid}_${Date.now()}`;
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

const OWNER = 1;
const EDITOR = 2;
const OUTSIDER = 3;
const ORG = 10;
const OTHER_ORG = 11;
const WORKSPACE = 20;
const MATTER = 30;
const PROJECT = 40;
const TYPE = 70;
const REQUEST = 80;
const RUN = 90;
const ITEM_TYPE = 91;
const ITEM_STEP = 92;

const run = (extra = "") =>
    `insert into public.matter_request_triage_runs(id, org_id, project_id, matter_id, request_id, trigger, started_by, classify_status, generative_status${extra ? ", " + extra.split("|")[0] : ""})
     values (${q(RUN)}, ${q(ORG)}, ${q(PROJECT)}, ${q(MATTER)}, ${q(REQUEST)}, 'auto', ${q(EDITOR)}, 'ok', 'ok'${extra ? ", " + extra.split("|")[1] : ""})`;
const item = (id: number, kind: string, columns: string, values: string) =>
    `insert into public.matter_request_triage_items(id, run_id, request_id, matter_id, org_id, kind, ${columns})
     values (${q(id)}, ${q(RUN)}, ${q(REQUEST)}, ${q(MATTER)}, ${q(ORG)}, '${kind}', ${values})`;

describe.skipIf(!container)("Donna triage in PostgreSQL", () => {
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
        // An existing deployment: the column is not there yet, a project already is.
        psql(`alter table public.projects drop column donna_enabled;
            insert into public.projects(id, name) values ('00000000-0000-4000-8000-0000000000aa', 'Antes de Donna');`);
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261119_80_litt_donna_triage.sql"), "utf8");
        psql(migration);
        // Re-running the migration over the final shape must be a no-op.
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`set session_replication_role = replica;
            truncate public.matter_request_triage_decisions, public.matter_request_triage_items,
                public.matter_request_triage_runs, public.matter_request_events,
                public.matter_requests, public.matter_request_types cascade;
            delete from public.projects where id <> '00000000-0000-4000-8000-0000000000aa';
            delete from public.matter_memberships; delete from public.matters;
            delete from public.workspaces; delete from public.org_members;
            delete from public.organizations; delete from auth.users;`);
        psql(`insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 3) n;
            insert into public.organizations(id, name, kind) values (${q(ORG)}, 'Firm', 'team'), (${q(OTHER_ORG)}, 'Other', 'team');
            insert into public.org_members(org_id, user_id, role) values
              (${q(ORG)}, ${q(OWNER)}, 'owner'), (${q(ORG)}, ${q(EDITOR)}, 'member'), (${q(OTHER_ORG)}, ${q(OUTSIDER)}, 'owner');
            insert into public.workspaces(id, organization_id, name) values (${q(WORKSPACE)}, ${q(ORG)}, 'W');
            insert into public.matters(id, workspace_id, name, is_retainer) values (${q(MATTER)}, ${q(WORKSPACE)}, 'Iguala', true);
            insert into public.matter_memberships(matter_id, user_id, role, status) values
              (${q(MATTER)}, ${q(OWNER)}, 'matter_owner', 'active'), (${q(MATTER)}, ${q(EDITOR)}, 'editor', 'active');
            insert into public.projects(id, name, org_id) values (${q(PROJECT)}, 'P', ${q(ORG)});
            insert into public.matter_request_types(id, organization_id, seed_key) values (${q(TYPE)}, ${q(ORG)}, 'contracts_clients');
            insert into public.matter_requests(id, matter_id, type_id, title, complexity, created_by)
              values (${q(REQUEST)}, ${q(MATTER)}, ${q(TYPE)}, 'Contrato', 'standard', ${q(EDITOR)});`);
    });

    it("turns the switch on for a project that already existed, and for a new one", () => {
        expect(psql("select donna_enabled from public.projects where id = '00000000-0000-4000-8000-0000000000aa'")).toBe("t");
        expect(psql(`select donna_enabled from public.projects where id = ${q(PROJECT)}`)).toBe("t");
        expect(psql("select is_nullable, column_default from information_schema.columns where table_name = 'projects' and column_name = 'donna_enabled'")).toBe("NO|true");
    });

    it("keeps a run, its items and a decision, and never lets one be updated, deleted or truncated", () => {
        psql(run("jev_model, jev_input_tokens, jev_output_tokens, jev_cost_usd|'jev-1.14.0', 2000, 40, 0.000084"));
        psql(item(ITEM_TYPE, "type", "value_type_id, confidence", `${q(TYPE)}, 0.91`));
        psql(item(ITEM_STEP, "strategy", "draft_text, position", "'Revisar la clausula', 0"));
        psql(`insert into public.matter_request_triage_decisions(item_id, request_id, matter_id, org_id, actor_user_id, action)
            values (${q(ITEM_TYPE)}, ${q(REQUEST)}, ${q(MATTER)}, ${q(ORG)}, ${q(EDITOR)}, 'accepted')`);
        expect(psql("select jev_cost_usd from public.matter_request_triage_runs")).toBe("0.00008400");
        for (const table of ["runs", "items", "decisions"]) {
            const name = `public.matter_request_triage_${table}`;
            expect(failure(`update ${name} set created_at = now()`)).toContain("insert-only");
            expect(failure(`delete from ${name}`)).toContain("insert-only");
            expect(failure(`truncate ${name} cascade`)).toContain("insert-only");
        }
        expect(psql("select count(*) from public.matter_request_triage_items")).toBe("2");
    });

    it("refuses an item that does not fit its kind, an unknown kind, trigger or action, and a negative count", () => {
        psql(run());
        // type needs its id and no text; a draft needs its text and no id.
        expect(failure(item(93, "type", "draft_text", "'x'"))).toContain("matter_request_triage_items_shape");
        expect(failure(item(93, "strategy", "value_type_id", q(TYPE)))).toContain("matter_request_triage_items_shape");
        expect(failure(item(93, "complexity", "value_enum", "'enorme'"))).toContain("matter_request_triage_items_shape");
        expect(failure(item(93, "urgency", "value_enum", "'enorme'"))).toContain("matter_request_triage_items_shape");
        expect(failure(item(93, "candidate", "value_enum", "'low'"))).toContain("matter_request_triage_items_shape");
        expect(failure(item(93, "horas", "draft_text", "'x'"))).toContain("kind_check");
        expect(failure(item(93, "strategy", "draft_text", `'${"x".repeat(401)}'`))).toContain("draft_text");
        psql(item(93, "urgency", "value_enum, forced_by_alarm", "'urgent', true"));
        expect(failure(`insert into public.matter_request_triage_runs(org_id, project_id, matter_id, request_id, trigger, classify_status, generative_status)
            values (${q(ORG)}, ${q(PROJECT)}, ${q(MATTER)}, ${q(REQUEST)}, 'sometimes', 'ok', 'ok')`)).toContain("trigger");
        expect(failure(`insert into public.matter_request_triage_runs(org_id, project_id, matter_id, request_id, trigger, classify_status, generative_status, quotes_rejected)
            values (${q(ORG)}, ${q(PROJECT)}, ${q(MATTER)}, ${q(REQUEST)}, 'auto', 'ok', 'ok', -1)`)).toContain("quotes_rejected");
        expect(failure(`insert into public.matter_request_triage_decisions(item_id, request_id, matter_id, org_id, action)
            values (${q(93)}, ${q(REQUEST)}, ${q(MATTER)}, ${q(ORG)}, 'ignored')`)).toContain("action");
    });

    it("ties a run to a request of its own matter, and an item to a run of its own request", () => {
        expect(failure(`insert into public.matter_request_triage_runs(org_id, project_id, matter_id, request_id, trigger, classify_status, generative_status)
            values (${q(ORG)}, ${q(PROJECT)}, ${q(PLAIN())}, ${q(REQUEST)}, 'auto', 'ok', 'ok')`)).toContain("foreign key");
        psql(run());
        expect(failure(`insert into public.matter_request_triage_items(run_id, request_id, matter_id, org_id, kind, draft_text)
            values (${q(RUN)}, ${q(81)}, ${q(MATTER)}, ${q(ORG)}, 'question', 'x')`)).toContain("foreign key");
    });

    it("takes the four triage actions in the request's events and still refuses an unknown one", () => {
        for (const action of ["triage_proposed", "triage_accepted", "triage_edited", "triage_discarded"])
            psql(`insert into public.matter_request_events(request_id, matter_id, actor_user_id, action) values (${q(REQUEST)}, ${q(MATTER)}, ${q(EDITOR)}, '${action}')`);
        expect(failure(`insert into public.matter_request_events(request_id, matter_id, action) values (${q(REQUEST)}, ${q(MATTER)}, 'hours_worked')`)).toContain("action_check");
    });

    it("holds no text of a document or a title in a run: its only text columns are codes, hashes and model names", () => {
        const columns = psql(`select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'matter_request_triage_runs' and data_type = 'text' order by 1`).split("\n");
        expect(columns).toEqual(["classify_error", "classify_status", "generative_provider", "generative_model", "generative_status", "input_sha256", "jev_model", "trigger"].sort());
        const itemText = psql(`select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'matter_request_triage_items' and data_type = 'text' order by 1`).split("\n");
        // A citation is a position and a hash; the only words are the model's drafts.
        expect(itemText).toEqual(["draft_purpose", "draft_text", "kind", "text_sha256", "value_enum"]);
        expect(itemText).not.toContain("quote");
        expect(itemText).not.toContain("title");
    });

    it("is read by the matter's roster only, and written by nobody in the browser", () => {
        psql(run());
        psql(item(ITEM_STEP, "strategy", "draft_text", "'Revisar'"));
        for (const table of ["runs", "items"])
            expect(asUser(EDITOR, `select count(*) from public.matter_request_triage_${table}`)).toBe("1");
        expect(asUser(OUTSIDER, "select count(*) from public.matter_request_triage_runs")).toBe("0");
        expect(asUser(OUTSIDER, "select count(*) from public.matter_request_triage_items")).toBe("0");
        expect(failure(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', ${q(EDITOR)}, true) \\g /dev/null
            insert into public.matter_request_triage_items(run_id, request_id, matter_id, org_id, kind, draft_text) values (${q(RUN)}, ${q(REQUEST)}, ${q(MATTER)}, ${q(ORG)}, 'question', 'x'); commit;`)).toMatch(/permission denied|row-level security/);
        expect(psql("select has_table_privilege('service_role', 'public.matter_request_triage_decisions', 'insert')")).toBe("t");
        expect(psql("select has_table_privilege('service_role', 'public.matter_request_triage_runs', 'update')")).toBe("f");
        expect(psql("select has_table_privilege('service_role', 'public.matter_request_triage_runs', 'delete')")).toBe("f");
    });

    it("lets an account be erased: no actor column has a foreign key to auth.users", () => {
        psql(run());
        psql(item(ITEM_STEP, "strategy", "draft_text", "'Revisar'"));
        psql(`insert into public.matter_request_triage_decisions(item_id, request_id, matter_id, org_id, actor_user_id, action)
            values (${q(ITEM_STEP)}, ${q(REQUEST)}, ${q(MATTER)}, ${q(ORG)}, ${q(EDITOR)}, 'discarded')`);
        expect(psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
            where c.contype = 'f' and t.relname like 'matter_request_triage_%' and c.confrelid = 'auth.users'::regclass`)).toBe("0");
    });
});

function PLAIN() {
    return 31;
}
