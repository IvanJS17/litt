import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// S8c (20261119_40_litt_rule_questions.sql): the insert-only questions and
// answers, the 'lawyer_answer' suggestion (evidence is the answer: no document,
// no passage), the shape check that keeps every earlier row valid, the guards,
// row-level security, the explicit grants and the migration re-run. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes target
// a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_rule_questions_${process.pid}_${Date.now()}`;
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
const VIEWER = 3;
const REVOKED = 5;
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
const PTU = "lft.ptu_reparto";

const question = (n: number, extra: { matter?: number; code?: string; version?: number; run?: string } = {}) =>
    `insert into public.obligation_rule_questions(id, org_id, matter_id, project_id, rule_code, rule_version, run_id, created_by)
     values (${q(n)}, ${q(ORG)}, ${q(extra.matter ?? MATTER)}, ${q(PROJECT)}, '${extra.code ?? PTU}', ${extra.version ?? 1},
             ${extra.run ? `'${extra.run}'` : "null"}, ${q(EDITOR)})`;
const answerSql = (n: number, questionId: number, value: string, extra: { matter?: number } = {}) =>
    `insert into public.obligation_rule_question_answers(id, question_id, matter_id, actor_user_id, answer)
     values (${q(n)}, ${q(questionId)}, ${q(extra.matter ?? MATTER)}, ${q(EDITOR)}, '${value}')`;
/** A suggestion that cites a document (the S8a shape). */
const docSug = (n: number, extra: { code?: string; run?: string; question?: number; quote?: string | null } = {}) =>
    `insert into public.obligation_rule_suggestions(id, flow, org_id, matter_id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, rule_code, rule_version, ai_reason, run_id, question_id, created_by)
     values (${q(n)}, 'catalog_match', ${q(ORG)}, ${q(MATTER)}, ${q(PROJECT)}, ${q(DOC)}, ${q(VERSION)}, '${SHA}', 10, 20,
             ${extra.quote === null ? "null" : `'${extra.quote ?? "una cita"}'`}, '${extra.code ?? "lgsm.asamblea_ordinaria_anual"}', 1, 'Porque el acta lo dice.',
             ${extra.run ? `'${extra.run}'` : "null"}, ${extra.question ? q(extra.question) : "null"}, ${q(EDITOR)})`;
/** A suggestion whose evidence is the lawyer's answer. */
const answerSug = (n: number, questionId: number | null, extra: { matter?: number; code?: string; document?: boolean; flow?: string } = {}) =>
    `insert into public.obligation_rule_suggestions(id, flow, org_id, matter_id, project_id, ${extra.document ? "document_id, version_id, text_sha256, start_char, end_char, quote, " : ""}question_id, rule_code, rule_version, ai_reason, created_by)
     values (${q(n)}, '${extra.flow ?? "lawyer_answer"}', ${q(ORG)}, ${q(extra.matter ?? MATTER)}, ${q(PROJECT)}, ${extra.document ? `${q(DOC)}, ${q(VERSION)}, '${SHA}', 1, 5, 'x', ` : ""}${questionId === null ? "null" : q(questionId)}, '${extra.code ?? PTU}', 1, ${extra.flow === "other" ? "'x'" : "null"}, ${q(EDITOR)})`;
const event = (suggestion: number, action: string, extra: { actor?: number | null; matter?: number } = {}) =>
    `insert into public.obligation_rule_suggestion_events(suggestion_id, matter_id, action, reason, actor_user_id)
     values (${q(suggestion)}, ${q(extra.matter ?? MATTER)}, '${action}', null, ${extra.actor === null ? "null" : q(extra.actor ?? EDITOR)})`;
const NEW_TABLES = ["obligation_rule_questions", "obligation_rule_question_answers"];

describe.skipIf(!container)("rule questions and answers in PostgreSQL", () => {
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
        // Re-running the migration over the final shape must be a no-op, twice.
        const migration = readFileSync(resolve(process.cwd(), "migrations", "20261119_40_litt_rule_questions.sql"), "utf8");
        psql(migration);
        psql(migration);
    }, 180_000);

    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`set session_replication_role = replica;
            truncate public.obligation_rule_question_answers, public.obligation_rule_questions,
              public.obligation_rule_suggestion_events, public.obligation_rule_suggestions cascade;
            delete from public.document_versions; delete from public.documents; delete from public.projects;
            delete from public.matter_memberships; delete from public.matters;
            delete from public.workspaces; delete from public.org_members;
            delete from public.organizations; delete from auth.users;`);
        psql(`insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
            insert into public.organizations(id, name, kind) values (${q(ORG)}, 'Firm', 'team'), (${q(OTHER_ORG)}, 'Other', 'team');
            insert into public.org_members(org_id, user_id, role) values
              (${q(ORG)}, ${q(OWNER)}, 'owner'), (${q(ORG)}, ${q(EDITOR)}, 'member'), (${q(ORG)}, ${q(VIEWER)}, 'member'),
              (${q(ORG)}, ${q(REVOKED)}, 'member'), (${q(OTHER_ORG)}, ${q(OUTSIDER)}, 'owner');
            insert into public.workspaces(id, organization_id, name) values (${q(WORKSPACE)}, ${q(ORG)}, 'W');
            insert into public.matters(id, workspace_id, name, is_retainer) values
              (${q(MATTER)}, ${q(WORKSPACE)}, 'Iguala', true), (${q(PLAIN_MATTER)}, ${q(WORKSPACE)}, 'Juicio', false);
            insert into public.matter_memberships(matter_id, user_id, role, status) values
              (${q(MATTER)}, ${q(OWNER)}, 'matter_owner', 'active'), (${q(MATTER)}, ${q(EDITOR)}, 'editor', 'active'),
              (${q(MATTER)}, ${q(VIEWER)}, 'viewer', 'active'), (${q(MATTER)}, ${q(REVOKED)}, 'editor', 'revoked');
            insert into public.projects(id, name, org_id) values (${q(PROJECT)}, 'P', ${q(ORG)});
            insert into public.documents(id, project_id) values (${q(DOC)}, ${q(PROJECT)});
            insert into public.document_versions(id, document_id, version_number) values (${q(VERSION)}, ${q(DOC)}, 1);`);
    });

    it("is recorded in the ledger, and the schema file ends with it", () => {
        expect(psql(`select count(*) from public.schema_migrations where filename = '20261119_40_litt_rule_questions.sql'`)).toBe("1");
        for (const table of NEW_TABLES)
            expect(psql(`select count(*) from pg_trigger where tgrelid = 'public.${table}'::regclass and not tgisinternal`)).toBe("1");
    });

    it("has a column for no hours, minutes, dates of a deadline or estimates", () => {
        for (const table of [...NEW_TABLES, "obligation_rule_suggestions"])
            expect(
                psql(`select count(*) from information_schema.columns where table_schema = 'public'
                  and table_name = '${table}' and column_name ~* '(hour|minute|estimate|duration|time_spent|due|deadline|date_on)'`),
            ).toBe("0");
    });

    it("enforces the shape of a question and keeps one per rule, version and matter", () => {
        psql(question(80, { run: uid(700) }));
        expect(failure(question(81, { code: "Bad Code" }))).toContain("check");
        expect(failure(question(81, { code: "nodots" }))).toContain("check");
        expect(failure(question(81, { version: 0 }))).toContain("check");
        // The question has no text column: the code builds it from the catalog.
        expect(psql(`select count(*) from information_schema.columns where table_name = 'obligation_rule_questions' and column_name = 'question'`)).toBe("0");
        expect(failure(question(81))).toContain("once_idx");
        psql(question(81, { code: "lfppi.marca_renovacion" }));
        psql(question(82, { version: 2 }));
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true)`);
        psql(question(83, { matter: 32 }));
        expect(psql("select count(*) from public.obligation_rule_questions")).toBe("4");
    });

    it("writes a question only into a private retainer matter", () => {
        expect(failure(question(81, { matter: 31 }))).toContain("private retainer matter");
        psql(`insert into public.matters(id, workspace_id, name, is_retainer, visibility) values (${q(33)}, ${q(WORKSPACE)}, 'Pública', true, 'public')`);
        expect(failure(question(82, { matter: 33 }))).toContain("private retainer matter");
        expect(failure(question(83, { matter: 99 }))).toContain("private retainer matter");
    });

    it("keeps questions and answers insert-only: update and delete fail in SQL", () => {
        psql(question(80));
        psql(answerSql(90, 80, "no"));
        expect(failure(`update public.obligation_rule_questions set rule_version = 2`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_questions`)).toContain("insert-only");
        expect(failure(`update public.obligation_rule_question_answers set answer = 'yes'`)).toContain("insert-only");
        expect(failure(`delete from public.obligation_rule_question_answers`)).toContain("insert-only");
        expect(psql("select answer from public.obligation_rule_question_answers")).toBe("no");
    });

    it("takes one answer, yes or no, per question, from the question's own matter", () => {
        psql(question(80));
        expect(failure(answerSql(90, 80, "maybe"))).toContain("check");
        expect(failure(answerSql(90, 80, ""))).toContain("check");
        expect(failure(answerSql(90, 99, "yes"))).toContain("foreign key");
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true)`);
        expect(failure(answerSql(90, 80, "yes", { matter: 32 }))).toContain("foreign key");
        psql(answerSql(90, 80, "yes"));
        expect(failure(answerSql(91, 80, "no"))).toContain("once_idx");
        expect(psql("select count(*) from public.obligation_rule_question_answers")).toBe("1");
    });

    it("saves a 'lawyer_answer' suggestion with no document and no passage, pointing at its question, once", () => {
        psql(question(80));
        psql(answerSug(91, 80));
        expect(psql(`select flow || ' ' || coalesce(document_id::text, 'none') || ' ' || coalesce(quote, 'none') from public.obligation_rule_suggestions`)).toBe("lawyer_answer none none");
        // One suggestion per question, whichever rule it names.
        expect(failure(answerSug(92, 80))).toContain("question_once_idx");
        // It needs a question, of the same matter, and may not carry a document or a passage.
        expect(failure(answerSug(92, null))).toContain("flow_shape");
        expect(failure(answerSug(92, 99))).toContain("foreign key");
        psql(question(81, { code: "lfppi.marca_renovacion" }));
        expect(failure(answerSug(92, 81, { document: true, code: "lfppi.marca_renovacion" }))).toContain("flow_shape");
        psql(`insert into public.matters(id, workspace_id, name, is_retainer) values (${q(32)}, ${q(WORKSPACE)}, 'Otra', true)`);
        expect(failure(answerSug(92, 81, { matter: 32, code: "lfppi.marca_renovacion" }))).toContain("foreign key");
    });

    it("keeps every earlier shape valid and strict: a document suggestion still needs its passage and no question", () => {
        psql(docSug(95));
        expect(psql(`select count(*) from public.obligation_rule_suggestions where flow = 'catalog_match'`)).toBe("1");
        expect(failure(docSug(96, { quote: null, code: PTU }))).toContain("flow_shape");
        psql(question(80));
        expect(failure(docSug(96, { question: 80, code: PTU }))).toContain("flow_shape");
        // A run id is just a label.
        psql(docSug(97, { run: uid(700), code: "lfppi.marca_renovacion" }));
        expect(psql(`select count(*) from public.obligation_rule_suggestions where run_id = ${q(700)}`)).toBe("1");
        expect(failure(answerSug(98, null, { flow: "other" }))).toContain("check");
    });

    it("writes a 'lawyer_answer' suggestion only into a private retainer matter", () => {
        psql(question(80));
        psql(`insert into public.matters(id, workspace_id, name, is_retainer, visibility) values (${q(33)}, ${q(WORKSPACE)}, 'Pública', true, 'public')`);
        expect(failure(answerSug(91, 80, { matter: 33 }))).toMatch(/private retainer matter|foreign key/);
        expect(failure(answerSug(91, 80, { matter: 31 }))).toMatch(/private retainer matter|foreign key/);
        expect(psql("select count(*) from public.obligation_rule_suggestions")).toBe("0");
    });

    it("decides a 'lawyer_answer' suggestion the same one-way way: accepted, or discarded, and accepted may be discarded", () => {
        psql(question(80));
        psql(answerSug(91, 80));
        expect(failure(event(91, "sent_to_legal"))).toMatch(/does not follow|check/);
        psql(event(91, "accepted"));
        expect(failure(event(91, "accepted"))).toContain("does not follow");
        psql(event(91, "discarded"));
        expect(failure(event(91, "discarded"))).toContain("does not follow");
        expect(psql("select count(*) from public.obligation_rule_suggestion_events")).toBe("3".replace("3", "2"));
        expect(psql("select count(*) from public.matter_obligation_rule_events")).toBe("0");
    });

    it("lets a better citation replace an earlier one by an event with no actor, never by an update", () => {
        psql(docSug(95, { run: uid(700) }));
        psql(event(95, "discarded", { actor: null }));
        expect(psql("select count(*) from public.obligation_rule_suggestion_events where actor_user_id is null")).toBe("1");
        expect(failure(`update public.obligation_rule_suggestions set quote = 'otra'`)).toContain("insert-only");
    });

    it("shows questions and answers to the matter's active roster only, and gives the browser no write", () => {
        psql(question(80));
        psql(answerSql(90, 80, "yes"));
        for (const table of NEW_TABLES) {
            const count = (user: number) => asUser(user, `select count(*) from public.${table}`);
            for (const user of [OWNER, EDITOR, VIEWER]) expect(count(user), `${table} ${user}`).toBe("1");
            for (const user of [REVOKED, OUTSIDER]) expect(count(user), `${table} ${user}`).toBe("0");
        }
        const denied = (statement: string) =>
            expect(failure(`begin; set local role authenticated;
                select set_config('request.jwt.claim.sub', ${q(OWNER)}, true) \\g /dev/null
                ${statement};`)).toContain("permission denied");
        denied(question(81, { code: "lfppi.marca_renovacion" }));
        denied(answerSql(91, 80, "no"));
    });

    it("grants the backend role select and insert on the new tables, nothing to change or delete", () => {
        for (const table of NEW_TABLES) {
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'select') and has_table_privilege('service_role', 'public.${table}', 'insert')`)).toBe("t");
            expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'update') or has_table_privilege('service_role', 'public.${table}', 'delete')`)).toBe("f");
            expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'insert') or has_table_privilege('anon', 'public.${table}', 'select')`)).toBe("f");
        }
        psql(`begin; set local role service_role; ${question(80)}; ${answerSql(90, 80, "yes")}; ${answerSug(91, 80)}; commit;`);
        expect(psql("select count(*) from public.obligation_rule_questions")).toBe("1");
    });

    it("lets the person who asked or answered delete their account, and keeps the records", () => {
        psql(question(80));
        psql(answerSql(90, 80, "yes"));
        psql(`delete from auth.users where id = ${q(EDITOR)}`);
        expect(psql(`select created_by from public.obligation_rule_questions`)).toBe(uid(EDITOR));
        expect(psql(`select actor_user_id from public.obligation_rule_question_answers`)).toBe(uid(EDITOR));
        for (const table of NEW_TABLES)
            expect(
                psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
                  where t.relname = '${table}' and c.contype = 'f' and c.confrelid = 'auth.users'::regclass`),
            ).toBe("0");
    });
});
