import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Rule proposals (20261119_30_litt_rule_proposals.sql, S8b): the closed draft,
// the shape per flow, the firm-project-without-a-matter guard, insert-only
// drafts, the ORDER of events enforced by the trigger (implemented needs
// sent_to_legal, a person and a catalog code), and row-level security that
// keeps drafts out of the browser. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_rule_proposals_${process.pid}_${Date.now()}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const psql = (query: string) =>
    execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-XqAt"], {
        input: query,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();
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
const OUTSIDER = 7;
const ORG = 10;
const OTHER_ORG = 11;
const WORKSPACE = 20;
const MATTER = 30;
const MATTER_PROJECT = 40;
const LAW_PROJECT = 41;
const PERSONAL_PROJECT = 42;
const DOC = 50;
const VERSION = 60;
const SHA = "a".repeat(64);
const GOOD = { law: "LGSM", article: "Art. 181", obligation: "Celebrar la asamblea.", anchor_name: "Cierre del ejercicio", plazo_propuesto: "+4 meses" };

const draft = (
    n: number,
    extra: { draft?: unknown; project?: number; org?: number; matter?: number | null; start?: number; end?: number; provider?: string | null; model?: string | null; code?: string; reason?: string } = {},
) => {
    const body = "draft" in extra ? extra.draft : GOOD;
    return `insert into public.obligation_rule_suggestions(id, flow, org_id, matter_id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, page, rule_code, rule_version, ai_reason, draft, ai_provider, ai_model, created_by)
     values (${q(n)}, 'new_rule_draft', ${q(extra.org ?? ORG)}, ${extra.matter == null ? "null" : q(extra.matter)}, ${q(extra.project ?? LAW_PROJECT)}, ${q(DOC)}, ${q(VERSION)}, '${SHA}',
             ${extra.start ?? 10}, ${extra.end ?? 20}, 'una cita', null, ${extra.code ? `'${extra.code}'` : "null"}, ${extra.code ? 1 : "null"}, ${extra.reason ? `'${extra.reason}'` : "null"},
             ${body === null ? "null" : `'${JSON.stringify(body).replace(/'/g, "''")}'::jsonb`},
             ${extra.provider === null ? "null" : `'${extra.provider ?? "claude"}'`}, ${extra.model === null ? "null" : `'${extra.model ?? "claude-sonnet-5-5"}'`}, ${q(EDITOR)})`;
};
const match = (n: number) =>
    `insert into public.obligation_rule_suggestions(id, flow, org_id, matter_id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, rule_code, rule_version, ai_reason, created_by)
     values (${q(n)}, 'catalog_match', ${q(ORG)}, ${q(MATTER)}, ${q(MATTER_PROJECT)}, ${q(DOC)}, ${q(VERSION)}, '${SHA}', 1, 5, 'cita', 'lgsm.asamblea_ordinaria_anual', 1, 'porque', ${q(EDITOR)})`;
const event = (suggestion: number, action: string, extra: { matter?: number | null; code?: string | null; actor?: number | null } = {}) =>
    `insert into public.obligation_rule_suggestion_events(suggestion_id, matter_id, action, actor_user_id, catalog_code)
     values (${q(suggestion)}, ${extra.matter == null ? "null" : q(extra.matter)}, '${action}', ${extra.actor === null ? "null" : q(extra.actor ?? EDITOR)}, ${extra.code ? `'${extra.code}'` : "null"})`;
const TABLES = ["obligation_rule_suggestions", "obligation_rule_suggestion_events"];

describe.skipIf(!container)("rule proposals in PostgreSQL", () => {
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
        // Re-running the migrations over the final shape must be a no-op (in ledger order).
        for (const name of ["20261119_20_litt_rule_suggestions.sql", "20261119_30_litt_rule_proposals.sql", "20261119_30_litt_rule_proposals.sql"])
            psql(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    }, 180_000);

    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`set session_replication_role = replica;
            truncate public.obligation_rule_suggestion_events, public.obligation_rule_suggestions cascade;
            delete from public.document_versions; delete from public.documents; delete from public.projects;
            delete from public.matter_memberships; delete from public.matters;
            delete from public.workspaces; delete from public.org_members;
            delete from public.organizations; delete from auth.users;`);
        psql(`insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
            insert into public.organizations(id, name, kind) values (${q(ORG)}, 'Firm', 'team'), (${q(OTHER_ORG)}, 'Other', 'team');
            insert into public.org_members(org_id, user_id, role) values (${q(ORG)}, ${q(OWNER)}, 'owner'), (${q(ORG)}, ${q(EDITOR)}, 'member'), (${q(OTHER_ORG)}, ${q(OUTSIDER)}, 'owner');
            insert into public.workspaces(id, organization_id, name) values (${q(WORKSPACE)}, ${q(ORG)}, 'W');
            insert into public.projects(id, name, org_id) values (${q(MATTER_PROJECT)}, 'Iguala', ${q(ORG)}), (${q(LAW_PROJECT)}, 'Leyes', ${q(ORG)}), (${q(PERSONAL_PROJECT)}, 'Mío', null);
            insert into public.matters(id, workspace_id, name, is_retainer, project_id) values (${q(MATTER)}, ${q(WORKSPACE)}, 'Iguala', true, ${q(MATTER_PROJECT)});
            insert into public.matter_memberships(matter_id, user_id, role, status) values (${q(MATTER)}, ${q(OWNER)}, 'matter_owner', 'active'), (${q(MATTER)}, ${q(EDITOR)}, 'editor', 'active');
            insert into public.documents(id, project_id) values (${q(DOC)}, ${q(LAW_PROJECT)});
            insert into public.document_versions(id, document_id, version_number) values (${q(VERSION)}, ${q(DOC)}, 1);`);
    });

    it("is recorded in the ledger and leaves the matter suggestions of S8a working", () => {
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261119_30_litt_rule_proposals.sql'`)).toBe("1");
        psql(match(90));
        psql(event(90, "accepted", { matter: MATTER }));
        expect(failure(event(90, "sent_to_legal", { matter: MATTER }))).toContain("does not follow");
        expect(failure(event(90, "implemented", { matter: MATTER, code: "lft.ptu_reparto" }))).toContain("does not follow");
    });

    it("keeps a draft closed: these keys and no others, within their lengths, with no date or operation", () => {
        psql(draft(91));
        psql(draft(92, { draft: { ...GOOD, plazo_propuesto: null }, start: 30, end: 40 }));
        const { plazo_propuesto: _term, ...noTerm } = GOOD;
        psql(draft(93, { draft: noTerm, start: 50, end: 60 }));
        for (const bad of [
            { ...GOOD, fecha: "2027-04-30" },
            { ...GOOD, operacion: "+4 meses" },
            { ...GOOD, law: "" },
            { ...GOOD, article: "x".repeat(101) },
            { ...GOOD, obligation: "x".repeat(301) },
            { ...GOOD, anchor_name: "x".repeat(121) },
            { ...GOOD, plazo_propuesto: "x".repeat(81) },
            { ...GOOD, plazo_propuesto: "" },
            { ...GOOD, plazo_propuesto: 4 },
            { ...GOOD, law: 5 },
            { law: "a", article: "b", obligation: "c" },
            [GOOD],
            "texto",
        ])
            expect(failure(draft(94, { draft: bad, start: 70, end: 80 })), JSON.stringify(bad)).toMatch(/draft_shape|flow_shape/);
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("3");
    });

    it("holds each flow to its own shape", () => {
        expect(failure(draft(91, { draft: null }))).toContain("flow_shape");
        expect(failure(draft(91, { matter: MATTER }))).toContain("flow_shape");
        expect(failure(draft(91, { code: "lgsm.asamblea_ordinaria_anual", reason: "x" }))).toContain("flow_shape");
        expect(failure(draft(91, { provider: null }))).toContain("flow_shape");
        expect(failure(draft(91, { model: null }))).toContain("flow_shape");
        expect(failure(draft(91, { provider: "" }))).toContain("flow_shape");
        expect(failure(match(91).replace("created_by)", "created_by, draft)").replace(/\)$/, ", '{}'::jsonb)"))).toMatch(/draft_shape|flow_shape/);
    });

    it("writes a draft only into a project of the organization that no matter is bound to", () => {
        expect(failure(draft(91, { project: MATTER_PROJECT }))).toContain("firm project that is not a matter");
        expect(failure(draft(91, { project: PERSONAL_PROJECT }))).toContain("firm project that is not a matter");
        expect(failure(draft(91, { org: OTHER_ORG }))).toContain("firm project that is not a matter");
        expect(failure(draft(91, { project: 99 }))).toContain("firm project that is not a matter");
        psql(draft(91));
        // A project that later becomes a matter's does not take new drafts.
        psql(`insert into public.matters(id, workspace_id, name, is_retainer, project_id) values (${q(32)}, ${q(WORKSPACE)}, 'Nueva', true, ${q(LAW_PROJECT)})`);
        expect(failure(draft(92, { start: 30, end: 40 }))).toContain("firm project that is not a matter");
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("1");
    });

    it("keeps one draft per passage of a text, and drafts and matches independent", () => {
        psql(draft(91));
        expect(failure(draft(92))).toContain("draft_once_idx");
        psql(draft(92, { start: 11, end: 21 }));
        psql(match(93));
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("3");
    });

    it("keeps drafts insert-only: update and delete fail in SQL", () => {
        psql(draft(91));
        expect(failure(`update public.obligation_rule_suggestions set quote = 'otra'`)).toContain("insert-only");
        expect(failure(`update public.obligation_rule_suggestions set draft = '{}'::jsonb`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_suggestions`)).toContain("insert-only");
        expect(psql("select draft ->> 'article' from public.obligation_rule_suggestions")).toBe("Art. 181");
    });

    it("enforces the order of a draft's events: sent_to_legal, then implemented; discarded and implemented end it", () => {
        for (const n of [91, 92, 93, 94]) psql(draft(n, { start: n, end: n + 5 }));
        // Nothing may skip sent_to_legal.
        expect(failure(event(91, "implemented", { code: "lgsm.asamblea_ordinaria_anual" }))).toContain("does not follow nothing");
        expect(failure(event(91, "accepted"))).toContain("does not follow nothing");
        expect(failure(event(91, "snooze"))).toMatch(/check|does not follow/);
        psql(event(91, "sent_to_legal"));
        expect(failure(event(91, "sent_to_legal"))).toContain("does not follow sent_to_legal");
        expect(failure(event(91, "accepted"))).toContain("does not follow");
        psql(event(91, "implemented", { code: "lgsm.asamblea_ordinaria_anual" }));
        for (const action of ["sent_to_legal", "discarded"]) expect(failure(event(91, action))).toContain("does not follow implemented");
        expect(failure(event(91, "implemented", { code: "lft.ptu_reparto" }))).toContain("does not follow implemented");
        // A discarded draft is final, and a sent one may still be discarded.
        psql(event(92, "discarded"));
        for (const action of ["sent_to_legal", "discarded"]) expect(failure(event(92, action))).toContain("does not follow discarded");
        expect(failure(event(92, "implemented", { code: "lft.ptu_reparto" }))).toContain("does not follow discarded");
        psql(event(93, "sent_to_legal"));
        psql(event(93, "discarded"));
        expect(failure(event(93, "implemented", { code: "lft.ptu_reparto" }))).toContain("does not follow discarded");
        expect(failure(`update public.obligation_rule_suggestion_events set reason = 'x'`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_suggestion_events`)).toContain("insert-only");
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("5");
    });

    it("needs a catalog code, in the catalog's form, for implemented and for nothing else, and a person who wrote it", () => {
        psql(draft(91));
        psql(event(91, "sent_to_legal"));
        expect(failure(event(91, "implemented"))).toContain("catalog_code_shape");
        expect(failure(event(91, "implemented", { code: "Bad Code" }))).toContain("catalog_code_shape");
        expect(failure(event(91, "implemented", { code: "nodots" }))).toContain("catalog_code_shape");
        expect(failure(event(91, "implemented", { code: "a.b", actor: null }))).toContain("implemented_actor");
        expect(failure(event(91, "discarded", { code: "lft.ptu_reparto" }))).toContain("catalog_code_shape");
        expect(failure(event(91, "sent_to_legal", { code: "lft.ptu_reparto" }))).toMatch(/catalog_code_shape|does not follow/);
        psql(event(91, "implemented", { code: "lgsm.asamblea_ordinaria_anual" }));
        expect(psql("select catalog_code from public.obligation_rule_suggestion_events where action = 'implemented'")).toBe("lgsm.asamblea_ordinaria_anual");
    });

    it("binds an event to its suggestion", () => {
        psql(draft(91));
        expect(failure(event(91, "sent_to_legal", { matter: MATTER }))).toMatch(/foreign key|another matter/);
        expect(failure(event(99, "sent_to_legal"))).toContain("foreign key");
        psql(match(92));
        expect(failure(event(92, "accepted", { matter: null }))).toContain("another matter");
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("0");
    });

    it("never writes a rule activation or touches the catalog tables", () => {
        psql(draft(91));
        psql(event(91, "sent_to_legal"));
        psql(event(91, "implemented", { code: "lgsm.asamblea_ordinaria_anual" }));
        expect(psql("select count(*) from public.matter_obligation_rule_events")).toBe("0");
    });

    it("keeps drafts out of the browser: only the matter roster reads matter suggestions", () => {
        psql(match(90));
        psql(event(90, "accepted", { matter: MATTER }));
        psql(draft(91));
        psql(event(91, "sent_to_legal"));
        for (const user of [OWNER, EDITOR]) {
            expect(asUser(user, "select count(*) from public.obligation_rule_suggestions"), `${user}`).toBe("1");
            expect(asUser(user, "select count(*) from public.obligation_rule_suggestions where flow = 'new_rule_draft'")).toBe("0");
            expect(asUser(user, "select count(*) from public.obligation_rule_suggestion_events")).toBe("1");
        }
        for (const table of TABLES) expect(asUser(OUTSIDER, `select count(*) from public.${table}`)).toBe("0");
    });

    it("gives the browser no write, and the backend role insert and select only", () => {
        const denied = (statement: string) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(OWNER)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(draft(91));
        psql(draft(91));
        denied(event(91, "sent_to_legal"));
        for (const table of TABLES) {
            expect(failure(`begin; set local role service_role; update public.${table} set created_at = now();`)).toContain("permission denied");
            expect(failure(`begin; set local role service_role; delete from public.${table};`)).toContain("permission denied");
        }
        psql(`begin; set local role service_role; ${event(91, "sent_to_legal")}; commit;`);
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("1");
    });

    it("lets the person who proposed or decided delete their account, and keeps the records", () => {
        psql(draft(91));
        psql(event(91, "sent_to_legal"));
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql("select created_by from public.obligation_rule_suggestions")).toBe(uid(EDITOR));
        expect(psql("select actor_user_id from public.obligation_rule_suggestion_events")).toBe(uid(EDITOR));
    });
});
