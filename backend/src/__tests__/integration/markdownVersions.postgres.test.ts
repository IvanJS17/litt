import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Markdown versions (20261111_10_litt_markdown_versions.sql): the 'user_edit'
// source, the 'md' upload type, numbering of edited versions and the base
// check under the document lock. Opt in with
// MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all writes
// target a disposable database that is dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_markdown_versions_${process.pid}_${Date.now()}`;
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
const DOC = 10;
const V1 = 20;
const V2 = 21;
const V3 = 22;
const create = (id: number, source: string, extra = "") =>
    psql(`select (public.create_document_version(${q(DOC)}, jsonb_build_object(
        'id', ${q(id)}, 'storage_path', 'k/${id}', 'filename', 'notes.md',
        'file_type', 'md', 'source', '${source}'${extra}), true))->>'version_number';`);

describe.skipIf(!container)("Markdown versions in PostgreSQL", () => {
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
        const migration = readFileSync(
            resolve(process.cwd(), "migrations", "20261111_10_litt_markdown_versions.sql"),
            "utf8",
        );
        psql(migration);
        psql(migration);
    }, 120_000);

    afterAll(() => {
        if (created)
            execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    beforeEach(() => {
        psql(`truncate auth.users, public.documents cascade;
            insert into auth.users(id,email) values (${q(USER)},'u@example.test');
            insert into public.documents(id,user_id,status) values (${q(DOC)},${q(USER)},'ready');`);
    });

    it("accepts the user_edit source and still refuses an unknown one", () => {
        expect(create(V1, "upload")).toBe("2");
        expect(create(V2, "user_edit")).toBe("3");
        expect(failure(`select public.create_document_version(${q(DOC)},
            jsonb_build_object('id', ${q(V3)}, 'storage_path', 'k', 'source', 'made_up'), true);`))
            .toContain("document_versions_source_check");
    });

    it("numbers user edits with the other numbered sources, so no number repeats", () => {
        expect(create(V1, "upload")).toBe("2");
        expect(create(V2, "user_edit")).toBe("3");
        expect(create(V3, "user_edit")).toBe("4");
        expect(psql(`select count(distinct version_number) from public.document_versions
            where document_id = ${q(DOC)}`)).toBe("3");
    });

    it("accepts the md upload type in an upload session and still refuses others", () => {
        const file = (type: string) => `jsonb_build_array(jsonb_build_object(
            'id', ${q(40)}, 'resource_id', ${q(41)}, 'client_id', 'c', 'filename', 'notes.${type}',
            'file_type', '${type}', 'content_type', 'text/markdown; charset=utf-8',
            'expected_size_bytes', 5, 'staging_storage_path', 's', 'sealed_storage_path', 'z'))`;
        const open = (type: string, session: number) =>
            `select public.create_upload_session(${q(session)}, ${q(USER)}, 'document_create',
                '{"scope":"standalone"}'::jsonb, now() + interval '20 minutes', ${file(type)}, 50);`;
        psql(open("md", 50));
        expect(psql(`select file_type from public.upload_session_files`)).toBe("md");
        expect(failure(open("exe", 51))).toContain("invalid_upload_manifest");
    });

    it("refuses a stale base under the document lock, and accepts the current one", () => {
        expect(create(V1, "upload")).toBe("2");
        psql(`select public.create_document_version(${q(DOC)}, jsonb_build_object(
            'id', ${q(V2)}, 'storage_path', 'k', 'source', 'user_edit',
            'base_version_id', '${uid(V1)}'), true);`);
        expect(psql(`select current_version_id from public.documents where id = ${q(DOC)}`)).toBe(uid(V2));
        // A second edit made on V1 is now stale: nothing is written.
        const stale = failure(`select public.create_document_version(${q(DOC)}, jsonb_build_object(
            'id', ${q(V3)}, 'storage_path', 'k', 'source', 'user_edit',
            'base_version_id', '${uid(V1)}'), true);`);
        expect(stale).toContain("document_version_conflict");
        expect(psql(`select count(*) from public.document_versions where id = ${q(V3)}`)).toBe("0");
        expect(psql(`select current_version_id from public.documents where id = ${q(DOC)}`)).toBe(uid(V2));
    });

    it("lets a retry of the winning save through, and ignores a base for other callers", () => {
        expect(create(V1, "upload")).toBe("2");
        // No base named: the original behaviour, whatever the current version.
        expect(create(V2, "user_upload")).toBe("3");
        // An idempotent retry returns the existing row before any base check.
        psql(`select public.create_document_version(${q(DOC)}, jsonb_build_object(
            'id', ${q(V2)}, 'storage_path', 'k', 'source', 'user_edit',
            'base_version_id', '${uid(V1)}'), true);`);
    });
});
