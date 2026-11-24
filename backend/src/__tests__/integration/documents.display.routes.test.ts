import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /single-documents/:documentId/display: a stored object is streamed from
// the store as the client takes it, keeps its validator, and a busy converter
// is a retry-later answer. The real storage facade runs over a fake store.

const { active, docxToPdf, reportError } = vi.hoisted(() => ({
    active: { current: null as Record<string, unknown> | null },
    docxToPdf: vi.fn(),
    reportError: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({})) }));
vi.mock("../../middleware/auth", () => ({
    requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../modules/documents/documents.access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/documents/documents.access")>()),
    ensureDocumentAccess: async () => ({ ok: true }),
}));
vi.mock("../../lib/documentVersions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/documentVersions")>()),
    loadActiveVersion: async () => active.current,
}));
vi.mock("../../lib/trainingRelease", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/trainingRelease")>()),
    assertVersionReleasable: async () => ({ ok: true }),
}));
vi.mock("../../lib/convert", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/convert")>()),
    docxToPdf: (...args: unknown[]) => docxToPdf(...args),
}));
vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError: (...args: unknown[]) => reportError(...args),
}));

import { app } from "../../app";
import { ExtractionBusyError } from "../../lib/extraction/limits";
import { setStorageAdapter } from "../../lib/storage";

const AUTH = ["Authorization", "Bearer test"] as const;
const DOC = "11111111-1111-4111-8111-111111111111";

/** A store holding `objects`; every read is recorded. */
function fakeStore(objects: Record<string, { bytes: Buffer; etag: string | null; headSize?: number }>) {
    const reads = { opened: [] as string[], whole: [] as string[] };
    setStorageAdapter({
        enabled: true,
        configurationHint: "test",
        headFile: async (key: string) => {
            const object = objects[key];
            return object ? { size: object.headSize ?? object.bytes.length, etag: object.etag, contentType: null } : null;
        },
        openReadStream: async (key: string) => {
            reads.opened.push(key);
            const object = objects[key];
            return object ? Readable.from([object.bytes]) : null;
        },
        downloadFile: async (key: string) => {
            reads.whole.push(key);
            const object = objects[key];
            return object ? object.bytes.buffer.slice(object.bytes.byteOffset, object.bytes.byteOffset + object.bytes.length) : null;
        },
    } as never);
    return reads;
}

/**
 * One keep-alive request over a raw socket, to see what is really on the wire:
 * a client library hides a body that does not match its length. Resolves when
 * the server closes the connection or after `waitMs`.
 */
async function rawGet(path: string, extraHeaders: string[] = [], waitMs = 1_500) {
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        return await new Promise<{ status: number; contentLength: number | null; bodyBytes: number; closed: boolean }>((resolve) => {
            const socket = connect(port, "127.0.0.1");
            const received: Buffer[] = [];
            let closed = false;
            const finish = () => {
                const all = Buffer.concat(received);
                const end = all.indexOf("\r\n\r\n");
                const head = all.subarray(0, end < 0 ? all.length : end).toString("latin1");
                const length = /content-length: (\d+)/i.exec(head);
                socket.destroy();
                resolve({
                    status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0),
                    contentLength: length ? Number(length[1]) : null,
                    bodyBytes: end < 0 ? 0 : all.length - end - 4,
                    closed,
                });
            };
            const timer = setTimeout(finish, waitMs);
            socket.on("data", (chunk: Buffer) => received.push(chunk));
            socket.on("close", () => {
                closed = true;
                clearTimeout(timer);
                finish();
            });
            socket.on("error", () => {});
            socket.write([`GET ${path} HTTP/1.1`, "Host: localhost", "Authorization: Bearer test", ...extraHeaders, "", ""].join("\r\n"));
        });
    } finally {
        server.close();
    }
}

const PDF = Buffer.from("%PDF-1.7 stored rendition bytes");

beforeEach(() => {
    docxToPdf.mockReset();
    reportError.mockReset();
    active.current = {
        id: "v1", filename: "Contract.docx", version_number: 1, source: "upload",
        file_type: "docx", storage_path: "u/Contract.docx", pdf_storage_path: "u/Contract.pdf",
    };
});

describe("GET /single-documents/:documentId/display", () => {
    it("streams a stored rendition with its length, reading it from the store as it is sent", async () => {
        const reads = fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"' } });
        const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/pdf/);
        expect(Number(res.headers["content-length"])).toBe(PDF.length);
        expect(Buffer.from(res.body).equals(PDF)).toBe(true);
        expect(reads.opened).toEqual(["u/Contract.pdf"]);
        expect(reads.whole).toEqual([]);
    });

    it("sends the store's validator and answers a matching conditional request with 304 without reading the object", async () => {
        const reads = fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"' } });
        const first = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(first.headers.etag).toBe('"abc123"');
        reads.opened.length = 0;

        const second = await request(app)
            .get(`/single-documents/${DOC}/display`)
            .set(...AUTH)
            .set("If-None-Match", '"abc123"');
        expect(second.status).toBe(304);
        expect(reads.opened).toEqual([]);
    });

    it("answers a HEAD request without reading the object", async () => {
        const reads = fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"' } });
        const res = await request(app).head(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(res.status).toBe(200);
        expect(Number(res.headers["content-length"])).toBe(PDF.length);
        expect(reads.opened).toEqual([]);
    });

    it.each([
        ["grew", PDF.length - 5],
        ["shrank", PDF.length + 5],
    ])("breaks the download instead of sending a body that does not match its length when the object %s since it was measured", async (_what, headSize) => {
        fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"', headSize } });
        const outcome = await request(app)
            .get(`/single-documents/${DOC}/display`)
            .set(...AUTH)
            .then(
                (res) => ({ complete: Buffer.from(res.body).equals(PDF) && Number(res.headers["content-length"]) === PDF.length }),
                () => ({ complete: false }),
            );
        expect(outcome.complete).toBe(false);
    });

    it("answers 503 with Retry-After, and reports nothing, when the converter is busy", async () => {
        fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null } });
        active.current = { ...active.current, pdf_storage_path: null };
        docxToPdf.mockRejectedValue(new ExtractionBusyError());
        const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(res.status).toBe(503);
        expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
        expect(reportError).not.toHaveBeenCalled();
    });

    it("hands the request's abort to the conversion queue", async () => {
        fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null } });
        active.current = { ...active.current, pdf_storage_path: null };
        let signal: AbortSignal | undefined;
        docxToPdf.mockImplementation((_bytes: Buffer, options?: { signal?: AbortSignal }) => {
            signal = options?.signal;
            return new Promise(() => {});
        });
        const pending = request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        const settled = pending.then(() => null, () => null);
        await vi.waitFor(() => expect(signal).toBeDefined());
        expect(signal!.aborted).toBe(false);
        pending.abort();
        await settled;
        await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    });

    it("never writes more bytes than the length it announced when the object grew since it was measured", async () => {
        fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"', headSize: PDF.length - 5 } });
        const wire = await rawGet(`/single-documents/${DOC}/display`);
        // An error answer is fine; a 200 whose body is longer than its announced length is not.
        if (wire.status === 200) expect(wire.bodyBytes).toBeLessThanOrEqual(wire.contentLength ?? 0);
        expect(wire.status).not.toBe(0);
    });

    it("drops the connection instead of leaving the client waiting when the object shrank since it was measured", async () => {
        fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"', headSize: PDF.length + 5 } });
        const wire = await rawGet(`/single-documents/${DOC}/display`);
        expect(wire.closed).toBe(true);
    });

    it("answers a conditional request whose validator does not match with the full object, not 304", async () => {
        const reads = fakeStore({ "u/Contract.pdf": { bytes: PDF, etag: '"abc123"' } });
        const res = await request(app)
            .get(`/single-documents/${DOC}/display`)
            .set(...AUTH)
            .set("If-None-Match", '"an-older-version"');
        expect(res.status).toBe(200);
        expect(Buffer.from(res.body).equals(PDF)).toBe(true);
        expect(reads.opened).toEqual(["u/Contract.pdf"]);
    });
});
