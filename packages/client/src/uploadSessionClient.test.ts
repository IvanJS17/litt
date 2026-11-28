/**
 * The storage-PUT reporting rule shared by the web app and the Word add-in
 * (MIKE-FRONTEND-28, 3D, 2Z; MIKE-WORD-ADDIN-9). The end-to-end path (three
 * attempts, then one report) is pinned in
 * `frontend/src/app/lib/mikeApi.uploadSessions.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { classifyStorageTarget, storageFailureReport, uploadFilesWithSessionCore } from "./uploadSessionClient";

type UploadSessionTransport = Parameters<typeof uploadFilesWithSessionCore>[0]["transport"];

describe("classifyStorageTarget", () => {
    it.each([
        // The compose default R2_PUBLIC_ENDPOINT_URL opened from a real host.
        ["http://localhost:9000/mike/k?X-Amz-Signature=s", "https://mike.firm.example/projects", "loopback"],
        ["http://127.0.0.1:9000/mike/k", "http://192.168.1.20:3000/", "loopback"],
        // An https front end signing against an http public endpoint.
        ["http://storage.firm.example:9000/mike/k", "https://mike.firm.example/", "mixed_content"],
        ["https://bucket.r2.example/mike/k", "https://mike.firm.example/", "cross_origin"],
        // Local development: both on the developer's machine is not the fault.
        ["http://localhost:9000/mike/k", "http://localhost:3000/", "cross_origin"],
        ["/mike/k", "https://localhost:3200/taskpane.html", "same_origin"],
    ])("classifies %s from %s as %s", (uploadUrl, pageUrl, expected) => {
        expect(classifyStorageTarget(uploadUrl, pageUrl)).toBe(expected);
    });

    it("says nothing without a page or with an unparsable URL", () => {
        expect(classifyStorageTarget("http://localhost:9000/k", undefined)).toBeUndefined();
        expect(classifyStorageTarget("http://[bad", "https://mike.firm.example/")).toBeUndefined();
    });
});

describe("storageFailureReport", () => {
    it("pins every exhausted PUT to one issue and carries the target enum", () => {
        const network = storageFailureReport({ error: new TypeError("Failed to fetch"), network: true, target: "loopback" });
        const status = storageFailureReport({ error: new Error("Object storage returned 503"), status: 503, target: "cross_origin" });
        expect(network).toEqual({
            level: "warning",
            tags: {
                component: "mike-api",
                operation: "upload_session.storage",
                http_method: "PUT",
                network: true,
                storage_target: "loopback",
            },
            fingerprint: ["upload-storage-put"],
        });
        expect(status?.fingerprint).toEqual(network?.fingerprint);
        expect(status?.tags).toMatchObject({ http_status: 503, storage_target: "cross_origin" });
    });

    // A signed PUT for a file the backend already accepted fails only
    // because of the deployment: 403 a refused signature, 404 a missing bucket
    // or proxy route, 405 a proxy sending it to the web app, 413 a proxy body
    // limit. Nothing else reports them, so none may be dropped.
    it.each([403, 404, 405, 413])("reports a %i with its status", (code) => {
        expect(storageFailureReport({ error: new Error(), status: code })).toMatchObject({
            tags: { http_status: code },
            fingerprint: ["upload-storage-put"],
        });
    });
});

describe("the almost-full notice of an upload batch", () => {
    const file = (name: string) => new File(["x"], name, { type: "application/pdf" });

    function setup(sessions: Array<Record<string, unknown>>) {
        let opened = 0;
        const noticeStorageAlmostFull = vi.fn();
        const puts: string[] = [];
        const transport = {
            apiRequest: (async (path: string, init?: RequestInit) => {
                if (path === "/upload-sessions" && init?.method === "POST") {
                    const extra = sessions[opened++] ?? {};
                    const body = JSON.parse(String(init.body)) as { files: Array<{ client_id: string; filename: string }> };
                    return {
                        session: { id: `s${opened}`, status: "completed" },
                        files: body.files.map((f) => ({
                            id: `f-${f.client_id}`,
                            client_id: f.client_id,
                            filename: f.filename,
                            status: "completed",
                            error_code: null,
                            result: { ok: true },
                            upload: { method: "PUT", url: `https://store.example/${f.client_id}`, headers: {} },
                        })),
                        ...extra,
                    };
                }
                return { session: { id: "s", status: "completed" }, files: [] };
            }) as unknown as UploadSessionTransport["apiRequest"],
            fetchStorage: (async (url: string) => {
                puts.push(url);
                return new Response(null, { status: 200 });
            }) as unknown as typeof fetch,
            shouldRetryControlRequest: () => false,
            noticeStorageAlmostFull,
        };
        return { transport, noticeStorageAlmostFull, puts };
    }
    const run = (transport: UploadSessionTransport, count: number) =>
        uploadFilesWithSessionCore({
            purpose: "document_create",
            destination: { scope: "standalone" },
            files: Array.from({ length: count }, (_, i) => ({ file: file(`f${i}.pdf`) })),
            transport,
        });
    const almostFull = { storageLevel: "almostFull", storageSpace: { kind: "firm", id: "firm-1" } };

    it("says it once for a batch of ten files, and the files still upload", async () => {
        const { transport, noticeStorageAlmostFull, puts } = setup([almostFull]);
        const outcomes = await run(transport, 10);
        expect(noticeStorageAlmostFull).toHaveBeenCalledTimes(1);
        expect(noticeStorageAlmostFull).toHaveBeenCalledWith({ kind: "firm", id: "firm-1" });
        expect(puts).toHaveLength(10);
        expect(outcomes.every((o) => o.status === "completed")).toBe(true);
    });

    it("says it once for a batch that needs several sessions for the same space", async () => {
        const { transport, noticeStorageAlmostFull } = setup([almostFull, almostFull]);
        await run(transport, 51);
        expect(noticeStorageAlmostFull).toHaveBeenCalledTimes(1);
    });

    it("says nothing when the space is ok, when the answer carries no level, or when the host shows nothing", async () => {
        const ok = setup([{ storageLevel: "ok", storageSpace: { kind: "personal", id: "u" } }]);
        await run(ok.transport, 2);
        const none = setup([{}]);
        await run(none.transport, 2);
        const silent = setup([almostFull]);
        const { noticeStorageAlmostFull: _unused, ...withoutHook } = silent.transport;
        void _unused;
        await run(withoutHook, 1);
        expect(ok.noticeStorageAlmostFull).not.toHaveBeenCalled();
        expect(none.noticeStorageAlmostFull).not.toHaveBeenCalled();
    });

    it("does not let a failing notice stop the upload", async () => {
        const { transport, noticeStorageAlmostFull, puts } = setup([almostFull]);
        noticeStorageAlmostFull.mockImplementation(() => {
            throw new Error("boom");
        });
        await run(transport, 1);
        expect(puts).toHaveLength(1);
    });
});
