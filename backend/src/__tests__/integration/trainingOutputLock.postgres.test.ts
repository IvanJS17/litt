import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// LiTT training, layer 1b (20261106_51_litt_training_output_lock.sql): the
// pasante seal on document_versions and the insert-only approvals. Opt in
// with MIKE_TEST_POSTGRES_CONTAINER=<a supabase/postgres container>; all
// writes target a disposable database that is dropped afterwards.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_lock_${process.pid}_${Date.now()}`;
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

const PUPIL = 1;
const LAWYER = 2;
const DOC = 10;
const SEALED = 20;
const PLAIN = 21;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const createVersion = (id: number, extra: string) =>
    psql(`select public.create_document_version(${q(DOC)}, jsonb_build_object(
        'id', ${q(id)}, 'storage_path', 'k/${id}', 'filename', 'Contrato.docx',
        'content_sha256', '${HASH_A}'${extra}), false);`);
const seal = (id: number) =>
    psql(`select coalesce(training_stage,'-') || '/' || coalesce(training_author_user_id::text,'-')
        from public.document_versions where id = ${q(id)}`);

describe.skipIf(!container)("LiTT pasante seal and approvals in PostgreSQL", () => {
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
            resolve(process.cwd(), "migrations/20261106_51_litt_training_output_lock.sql"),
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
        psql(`truncate auth.users, public.documents, public.training_version_approvals cascade;
            insert into auth.users(id,email) values
                (${q(PUPIL)},'pupil@example.test'), (${q(LAWYER)},'lawyer@example.test');
            insert into public.documents(id,user_id,status) values (${q(DOC)},${q(PUPIL)},'ready');`);
        createVersion(SEALED, `, 'training_author_user_id', ${q(PUPIL)}, 'training_stage', 'pasante'`);
        createVersion(PLAIN, "");
    });

    it("writes the seal create_document_version is given, and nothing otherwise", () => {
        expect(seal(SEALED)).toBe(`pasante/${uid(PUPIL)}`);
        expect(seal(PLAIN)).toBe("-/-");
        expect(failure(`select public.create_document_version(${q(DOC)},
            jsonb_build_object('storage_path','k/x','training_stage','junior',
                'training_author_user_id',${q(PUPIL)}), false);`))
            .toContain("document_versions_training_stage_check");
        expect(failure(`select public.create_document_version(${q(DOC)},
            jsonb_build_object('storage_path','k/y','training_stage','pasante'), false);`))
            .toContain("document_versions_training_seal_check");
    });

    it("never removes or hands over a seal, and lets a pasante seal a plain version in place", () => {
        // The approval binds HASH_A; the lawyer's in-place change leaves it behind
        // (the lookup assertReleasable makes, against the current hash).
        psql(`insert into public.training_version_approvals
            (document_version_id,content_sha256,approved_by) values (${q(SEALED)},'${HASH_A}',${q(LAWYER)});`);
        const approvedNow = () => psql(`select count(*) from public.training_version_approvals a
            join public.document_versions v on v.id = a.document_version_id
            where v.id=${q(SEALED)} and a.content_sha256 = v.content_sha256`);
        expect(approvedNow()).toBe("1");
        psql(`update public.document_versions set content_sha256='${HASH_B}', storage_path='k/new',
            training_stage=null, training_author_user_id=null where id=${q(SEALED)};
            update public.document_versions set training_author_user_id=${q(LAWYER)}
            where id=${q(SEALED)};`);
        expect(seal(SEALED)).toBe(`pasante/${uid(PUPIL)}`);
        expect(psql(`select content_sha256 from public.document_versions where id=${q(SEALED)}`))
            .toBe(HASH_B);
        expect(approvedNow()).toBe("0");
        psql(`update public.document_versions set training_stage='pasante',
            training_author_user_id=${q(PUPIL)} where id=${q(PLAIN)};`);
        expect(seal(PLAIN)).toBe(`pasante/${uid(PUPIL)}`);
    });

    it("keeps approvals insert-only, one per version and hash, away from the browser roles", () => {
        const approve = (hash: string) => `insert into public.training_version_approvals
            (document_version_id,content_sha256,approved_by) values (${q(SEALED)},'${hash}',${q(LAWYER)});`;
        psql(approve(HASH_A));
        expect(failure(approve(HASH_A))).toContain("training_version_approvals_version_hash_key");
        psql(approve(HASH_B));
        expect(failure("update public.training_version_approvals set approved_by = null;"))
            .toContain("training_version_approvals is insert-only");
        expect(failure("delete from public.training_version_approvals;"))
            .toContain("training_version_approvals is insert-only");
        expect(failure(`insert into public.training_version_approvals
            (document_version_id,content_sha256,approved_by) values (${q(SEALED)},'nope',${q(LAWYER)});`))
            .toContain("training_version_approvals_sha256_check");
        expect(psql(`select relrowsecurity from pg_class where relname='training_version_approvals'`)).toBe("t");
        expect(psql(`select count(*) from pg_policies where tablename='training_version_approvals'`)).toBe("0");
        expect(psql(`select has_table_privilege('authenticated','public.training_version_approvals','select')
            or has_table_privilege('anon','public.training_version_approvals','select')
            or has_table_privilege('authenticated','public.training_version_approvals','insert')`)).toBe("f");
        expect(psql(`select has_table_privilege('service_role','public.training_version_approvals','select')
            and has_table_privilege('service_role','public.training_version_approvals','insert')
            and not has_table_privilege('service_role','public.training_version_approvals','update')
            and not has_table_privilege('service_role','public.training_version_approvals','delete')`)).toBe("t");
    });

    it("lets a document be deleted while its approvals stay as evidence", () => {
        psql(`insert into public.training_version_approvals
            (document_version_id,content_sha256,approved_by) values (${q(SEALED)},'${HASH_A}',${q(LAWYER)});
            delete from public.documents where id=${q(DOC)};
            delete from auth.users where id=${q(LAWYER)};`);
        expect(psql("select count(*) from public.document_versions")).toBe("0");
        expect(psql("select count(*) from public.training_version_approvals")).toBe("1");
    });

    it("lets append_ai_review_export accept only the pasante seal in its artifact", () => {
        const artifact = (extra: string) => `jsonb_build_object(
            'idempotency_key','k1','review_id',${q(40)},'review_revision',1,'execution_id',${q(41)},
            'organization_id',${q(42)},'matter_id',${q(43)},'project_id',${q(44)},'document_id',${q(45)},
            'document_version_id',${q(46)},'source_document_sha256','${HASH_A}',
            'evidence_receipt_sha256','${HASH_A}','filename','Informe de revision humana.docx',
            'mime_type','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'artifact_sha256','${HASH_B}','artifact_document_id',${q(47)},
            'artifact_document_version_id',${q(48)},
            'storage_path','orgs/${uid(42)}/matters/${uid(43)}/projects/${uid(44)}/documents/${uid(47)}/${HASH_B}.docx',
            'size_bytes',10${extra})`;
        const call = (extra: string) =>
            failure(`select public.append_ai_review_export(${q(LAWYER)},${q(42)},1,${artifact(extra)});`);
        // A valid contract gets past the shape check to the (absent) review.
        expect(call("")).toContain("AI review export scope is invalid");
        expect(call(",'training_stage','pasante'")).toContain("AI review export scope is invalid");
        expect(call(",'training_stage','junior'")).toContain("Invalid AI review export contract");
        expect(call(",'other','x'")).toContain("Invalid AI review export contract");
    });
});
