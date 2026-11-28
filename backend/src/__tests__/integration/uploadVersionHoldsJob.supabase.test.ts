import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Stack-level test for the functions that write a document version for an
// upload job. The job is proven held and the version written in one
// transaction, so these are properties of the Postgres functions themselves.
// Gated like dbJobs.supabase.test.ts: run a local stack, then export
//   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY
// (A second concurrent database session is not available through the REST
// layer, so the waiting behaviour is proven in psql, not here.)
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const maybeDescribe = url && serviceKey ? describe : describe.skip;

maybeDescribe("version writes for an upload job", () => {
    let db: SupabaseClient;
    let userId: string;
    const documentId = randomUUID();
    const sessionId = randomUUID();
    const fileId = randomUUID();
    const jobId = randomUUID();

    const expectNotHeld = (error: { code?: string; message?: string } | null) => {
        expect(error?.code).toBe("55000");
        expect(error?.message).toContain("upload_job_not_held");
    };
    const create = (args: { job?: string; worker?: string; id: string; path: string }) =>
        db.rpc("create_document_version_for_upload_job", {
            p_job_id: args.job ?? jobId,
            p_worker_id: args.worker ?? "w1",
            p_document_id: documentId,
            p_version: { id: args.id, storage_path: args.path, source: "user_upload", filename: "a.pdf" },
            p_activate: true,
        });
    const replace = (args: { job?: string; worker?: string; versionId: string; patch: object; expect?: object }) =>
        db.rpc("replace_document_version_for_upload_job", {
            p_job_id: args.job ?? jobId,
            p_worker_id: args.worker ?? "w1",
            p_document_id: documentId,
            p_version_id: args.versionId,
            p_patch: args.patch,
            p_expect: args.expect ?? {},
        });
    const versionIds = async () =>
        ((await db.from("document_versions").select("id").eq("document_id", documentId)).data ?? []).map((r) => r.id);
    const setJob = (row: Record<string, unknown>) =>
        db.from("upload_processing_jobs").update(row).eq("id", jobId);

    beforeAll(async () => {
        db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await db.auth.admin.createUser({
            email: `upload-job-${Date.now()}@example.test`,
            email_confirm: true,
        });
        if (error || !data.user) throw new Error(error?.message ?? "no user");
        userId = data.user.id;
        const rows: [string, Record<string, unknown>][] = [
            ["documents", { id: documentId, user_id: userId }],
            ["upload_sessions", {
                id: sessionId, user_id: userId, purpose: "document_version_create", destination: {},
                expected_file_count: 1, expected_total_bytes: 1, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            }],
            ["upload_session_files", {
                id: fileId, session_id: sessionId, resource_id: randomUUID(), client_id: "c1", filename: "a.pdf",
                file_type: "pdf", content_type: "application/pdf", expected_size_bytes: 1,
                staging_storage_path: "s", sealed_storage_path: "s2",
            }],
            ["upload_processing_jobs", {
                id: jobId, session_id: sessionId, file_id: fileId, user_id: userId,
                status: "running", locked_by: "w1", locked_at: new Date().toISOString(),
            }],
        ];
        for (const [table, row] of rows) {
            const { error: insertError } = await db.from(table).insert(row);
            if (insertError) throw new Error(`${table}: ${insertError.message}`);
        }
    });

    afterAll(async () => {
        if (!userId) return;
        await db.from("documents").delete().eq("id", documentId);
        await db.from("upload_sessions").delete().eq("id", sessionId);
        await db.auth.admin.deleteUser(userId);
    });

    it("writes the version while the job is running and held by that worker", async () => {
        const id = randomUUID();
        const { data, error } = await create({ id, path: "k/1" });
        expect(error).toBeNull();
        expect(data).toMatchObject({ id, storage_path: "k/1" });
        expect(await versionIds()).toContain(id);
        const { data: document } = await db.from("documents").select("current_version_id").eq("id", documentId).single();
        expect(document?.current_version_id).toBe(id);
    });

    it("refuses, writing nothing, when the job is held by another worker, not running, or missing", async () => {
        const before = await versionIds();
        expectNotHeld((await create({ id: randomUUID(), path: "k/x", worker: "w2" })).error);
        expectNotHeld((await create({ id: randomUUID(), path: "k/x", job: randomUUID() })).error);
        await setJob({ status: "completed", locked_by: null });
        expectNotHeld((await create({ id: randomUUID(), path: "k/x" })).error);
        expect(await versionIds()).toEqual(before);
        await setJob({ status: "running", locked_by: "w1" });
    });

    it("replaces a live version in place under the same conditions, and answers null when no row matches", async () => {
        const versionId = (await versionIds())[0];
        const replaced = await replace({
            versionId, patch: { storage_path: "k/1b", pdf_storage_path: null, content_sha256: "h2" },
            expect: { storage_path: "k/1", content_sha256: null },
        });
        expect(replaced.error).toBeNull();
        expect(replaced.data).toMatchObject({ id: versionId });
        const stale = await replace({ versionId, patch: { storage_path: "k/1c" }, expect: { storage_path: "k/1" } });
        expect(stale.error).toBeNull();
        expect(stale.data).toBeNull();
        const { data: row } = await db.from("document_versions").select("storage_path").eq("id", versionId).single();
        expect(row?.storage_path).toBe("k/1b");
    });

    it("refuses a replacement that names a column the function does not set", async () => {
        const versionId = (await versionIds())[0];
        const { data, error } = await replace({ versionId, patch: { storage_path: "k/y", source: "other" } });
        expect(data).toBeNull();
        expect(error?.code).toBe("22023");
        expect(error?.message).toContain("unsupported_version_field");
        const { data: row } = await db.from("document_versions").select("storage_path, source").eq("id", versionId).single();
        expect(row).toEqual({ storage_path: "k/1b", source: "user_upload" });
    });

    it("refuses a replacement, changing nothing, when the job is held by another worker, not running, or missing", async () => {
        const versionId = (await versionIds())[0];
        expectNotHeld((await replace({ versionId, patch: { storage_path: "k/z" }, worker: "w2" })).error);
        expectNotHeld((await replace({ versionId, patch: { storage_path: "k/z" }, job: randomUUID() })).error);
        await setJob({ status: "error", locked_by: null });
        expectNotHeld((await replace({ versionId, patch: { storage_path: "k/z" } })).error);
        const { data: row } = await db.from("document_versions").select("storage_path").eq("id", versionId).single();
        expect(row?.storage_path).toBe("k/1b");
        await setJob({ status: "running", locked_by: "w1" });
    });
});
