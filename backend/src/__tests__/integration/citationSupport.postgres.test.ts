import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Citation support check (20261114_20_litt_citation_support.sql and its wider
// scope, 20261116_10_litt_citation_support_scope.sql): the personal opt-out
// column and the table of results, which go with the row they belong to: a
// chat or Word answer, a tabular cell, a tabular chat answer or a playbook draft. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres
// container>; all writes target a disposable database dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_citation_support_${process.pid}_${Date.now()}`;
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

const USER = 1;
const ORG = 2;
const CHAT = 3;
const MESSAGE = 4;
const WORD_DOC = 5;
const WORD_CHAT = 6;
const WORD_MESSAGE = 7;
const insert = (ref: number, extra: Record<string, string> = {}) => {
    const row: Record<string, string> = {
        organization_id: q(ORG), message_id: q(MESSAGE),
        citation_ref: String(ref), probability: "0.73", band: "'supported'", model: "'jev-1.14.0'",
        question_version: "'noul-rico-v2'", latency_ms: "130",
        ...extra,
    };
    for (const [k, v] of Object.entries(row)) if (v === "null") delete row[k];
    return `insert into public.citation_support_checks (${Object.keys(row).join(",")}) values (${Object.values(row).join(",")});`;
};
const REVIEW = 8;
const ROW = 9;
const CELL = 10;
const REVIEW_CHAT = 11;
const REVIEW_MESSAGE = 12;
const PLAYBOOK = 13;
const OWNERS = {
    cell: { column: "tabular_cell_id", id: CELL },
    chat: { column: "tabular_chat_message_id", id: REVIEW_MESSAGE },
    playbook: { column: "playbook_id", id: PLAYBOOK },
} as const;
const insertFor = (owner: keyof typeof OWNERS, ref: number) =>
    insert(ref, { message_id: "null", [OWNERS[owner].column]: q(OWNERS[owner].id) });
const insertWord = (ref: number) => insert(ref, { message_id: "null", word_message_id: q(WORD_MESSAGE) });

describe.skipIf(!container)("citation support checks in PostgreSQL", () => {
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
        for (const file of ["20261114_20_litt_citation_support.sql", "20261116_10_litt_citation_support_scope.sql"]) {
            const migration = readFileSync(resolve(process.cwd(), "migrations", file), "utf8");
            psql(migration);
            psql(migration);
        }
    }, 180_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    const seed = () =>
        psql(`insert into auth.users(id,email) values (${q(USER)},'u@example.test') on conflict do nothing;
            insert into public.chats(id, user_id) values (${q(CHAT)}, ${q(USER)});
            insert into public.chat_messages(id, chat_id, role) values (${q(MESSAGE)}, ${q(CHAT)}, 'assistant');
            insert into public.word_documents(id, user_id, client_document_id) values (${q(WORD_DOC)}, ${q(USER)}, ${q(WORD_DOC + 100)})
              on conflict do nothing;
            insert into public.word_chats(id, word_document_id, user_id) values (${q(WORD_CHAT)}, ${q(WORD_DOC)}, ${q(USER)});
            insert into public.word_chat_messages(id, chat_id, role) values (${q(WORD_MESSAGE)}, ${q(WORD_CHAT)}, 'assistant');
            insert into public.tabular_reviews(id, user_id, title) values (${q(REVIEW)}, ${q(USER)}, 'r');
            insert into public.tabular_review_rows(id, review_id, label, row_type) values (${q(ROW)}, ${q(REVIEW)}, 'row', 'document');
            insert into public.tabular_cells(id, review_id, row_id, column_index) values (${q(CELL)}, ${q(REVIEW)}, ${q(ROW)}, 0);
            insert into public.tabular_review_chats(id, review_id, user_id) values (${q(REVIEW_CHAT)}, ${q(REVIEW)}, ${q(USER)});
            insert into public.tabular_review_chat_messages(id, chat_id, role) values (${q(REVIEW_MESSAGE)}, ${q(REVIEW_CHAT)}, 'assistant');
            insert into public.playbooks(id, user_id, name, content_json, status) values (${q(PLAYBOOK)}, ${q(USER)}, 'p', '{}', 'draft');`);

    beforeEach(() => {
        psql(`delete from public.chats; delete from public.word_chats; delete from public.tabular_reviews;
            delete from public.playbooks; truncate public.citation_support_checks;`);
        seed();
    });

    it("gives every profile the opt-out, on by default", () => {
        expect(
            psql(`select column_default, is_nullable from information_schema.columns
              where table_name = 'user_profiles' and column_name = 'citation_check'`),
        ).toBe("true|NO");
        // The account's profile exists from sign-up (a trigger on auth.users).
        expect(psql(`select citation_check from public.user_profiles where user_id = ${q(USER)}`)).toBe("t");
        psql(`update public.user_profiles set citation_check = false where user_id = ${q(USER)}`);
        expect(psql(`select citation_check from public.user_profiles where user_id = ${q(USER)}`)).toBe("f");
    });

    it("stores a check and refuses to change it", () => {
        psql(insert(1));
        expect(psql("select band, model from public.citation_support_checks")).toBe("supported|jev-1.14.0");
        expect(failure("update public.citation_support_checks set band = 'review'")).toContain("never updated");
    });

    it("goes with its answer: deleting the message, or the chat, deletes the checks", () => {
        psql(insert(1));
        psql(insert(2));
        psql(`delete from public.chat_messages where id = ${q(MESSAGE)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
        psql(`insert into public.chat_messages(id, chat_id, role) values (${q(MESSAGE)}, ${q(CHAT)}, 'assistant')`);
        psql(insert(1));
        psql(`delete from public.chats where id = ${q(CHAT)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
    });

    it("does the same for a Word answer, and when its chat goes", () => {
        psql(insertWord(1));
        psql(`delete from public.word_chat_messages where id = ${q(WORD_MESSAGE)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
        psql(`insert into public.word_chat_messages(id, chat_id, role) values (${q(WORD_MESSAGE)}, ${q(WORD_CHAT)}, 'assistant')`);
        psql(insertWord(1));
        psql(`delete from public.word_chats where id = ${q(WORD_CHAT)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
    });

    it("belongs to exactly one owner, which must exist", () => {
        expect(failure(insert(1, { message_id: q(99) }))).toContain("citation_support_checks_message_id_fkey");
        expect(failure(insert(1, { message_id: "null" }))).toContain("citation_support_checks_one_owner");
        expect(failure(insert(1, { word_message_id: q(WORD_MESSAGE) }))).toContain("citation_support_checks_one_owner");
        expect(failure(insert(1, { tabular_cell_id: q(CELL) }))).toContain("citation_support_checks_one_owner");
        expect(failure(insertFor("cell", 1).replace(q(CELL), q(99)))).toContain("citation_support_checks_tabular_cell_id_fkey");
        expect(failure(insertFor("chat", 1).replace(q(REVIEW_MESSAGE), q(99)))).toContain("citation_support_checks_tabular_chat_message_id_fkey");
        expect(failure(insertFor("playbook", 1).replace(q(PLAYBOOK), q(99)))).toContain("citation_support_checks_playbook_id_fkey");
    });

    it("goes with a tabular cell: deleting the cell, its row or its review deletes the checks", () => {
        psql(insertFor("cell", 1));
        psql(`delete from public.tabular_cells where id = ${q(CELL)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
        psql(`insert into public.tabular_cells(id, review_id, row_id, column_index) values (${q(CELL)}, ${q(REVIEW)}, ${q(ROW)}, 0)`);
        psql(insertFor("cell", 1));
        psql(`delete from public.tabular_reviews where id = ${q(REVIEW)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
    });

    it("goes with a tabular chat answer: deleting the message or the chat deletes the checks", () => {
        psql(insertFor("chat", 1));
        psql(`delete from public.tabular_review_chat_messages where id = ${q(REVIEW_MESSAGE)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
        psql(`insert into public.tabular_review_chat_messages(id, chat_id, role) values (${q(REVIEW_MESSAGE)}, ${q(REVIEW_CHAT)}, 'assistant')`);
        psql(insertFor("chat", 1));
        psql(`delete from public.tabular_review_chats where id = ${q(REVIEW_CHAT)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
    });

    it("goes with a playbook draft: deleting the playbook deletes the checks", () => {
        psql(insertFor("playbook", 1));
        psql(`delete from public.playbooks where id = ${q(PLAYBOOK)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
    });

    it("checks each citation of a cell, a tabular answer and a playbook once per question version", () => {
        for (const owner of ["cell", "chat", "playbook"] as const) {
            psql(insertFor(owner, 1));
            expect(failure(insertFor(owner, 1))).toContain("duplicate key");
            psql(insertFor(owner, 2));
            psql(insert(1, { message_id: "null", [OWNERS[owner].column]: q(OWNERS[owner].id), question_version: "'noul-rico-v3'" }));
        }
    });

    it("lets the server remove the check of a cell's previous content, and still refuses to change one", () => {
        psql(insertFor("cell", 1));
        psql(`delete from public.citation_support_checks where tabular_cell_id = ${q(CELL)}`);
        expect(psql("select count(*) from public.citation_support_checks")).toBe("0");
        psql(insertFor("cell", 1));
        expect(failure("update public.citation_support_checks set band = 'review'")).toContain("never updated");
        expect(
            psql(`select has_table_privilege('service_role', 'public.citation_support_checks', 'delete')`),
        ).toBe("t");
    });

    it("checks each citation of a message once per question version", () => {
        psql(insert(1));
        expect(failure(insert(1))).toContain("citation_support_checks_chat_once");
        psql(insertWord(1));
        expect(failure(insertWord(1))).toContain("citation_support_checks_word_once");
        psql(insert(2));
        psql(insert(1, { question_version: "'noul-rico-v3'" }));
    });

    it("keeps the values in range", () => {
        expect(failure(insert(9, { probability: "1.2" }))).toContain("probability");
        expect(failure(insert(9, { band: "'yes'" }))).toContain("band");
        expect(failure(insert(9, { latency_ms: "-1" }))).toContain("latency_ms");
    });

    it("has no column that could hold the text, a key or name a person", () => {
        const columns = psql(`select string_agg(column_name, ',' order by ordinal_position)
            from information_schema.columns where table_name = 'citation_support_checks'`);
        expect(columns).not.toMatch(/quote|claim|text|context|content|afirmacion|cita\b|user|email|name|key/);
    });

    it("is server-only: RLS on, and no grant to the browser roles", () => {
        expect(psql("select relrowsecurity from pg_class where oid = 'public.citation_support_checks'::regclass")).toBe("t");
        for (const role of ["anon", "authenticated"]) {
            const exists = psql(`select count(*) from pg_roles where rolname = '${role}'`) === "1";
            if (!exists) continue;
            expect(
                psql(`select has_table_privilege('${role}', 'public.citation_support_checks', 'select')
                    or has_table_privilege('${role}', 'public.citation_support_checks', 'insert')`),
            ).toBe("f");
        }
    });
});
