import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /single-documents/:documentId/display: a stored object is streamed from
// the store as the client takes it, keeps its validator, and a busy converter
// is a retry-later answer. The real storage facade runs over a fake store.

const { active, auth, docxToPdf, reportError } = vi.hoisted(() => ({
    active: { current: null as Record<string, unknown> | null },
    // A test can make the session check wait, and see how many requests wait on it.
    auth: { gate: null as Promise<void> | null, waiting: 0 },
    docxToPdf: vi.fn(),
    reportError: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({})) }));
vi.mock("../../middleware/auth", () => ({
    requireAuth: async (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
        if (auth.gate) {
            auth.waiting += 1;
            await auth.gate;
        }
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

    it("answers a source over the bound with the convert surface's code, not 500, and reads and converts nothing", async () => {
        const reads = fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null, headSize: 25 * 1024 * 1024 + 1 } });
        active.current = { ...active.current, pdf_storage_path: null };
        const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("convert_source_too_large");
        expect(reads.whole).toEqual([]);
        expect(docxToPdf).not.toHaveBeenCalled();
        expect(reportError).not.toHaveBeenCalled();
    });

    it("still displays a small Word file with no stored rendition", async () => {
        fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null } });
        active.current = { ...active.current, pdf_storage_path: null };
        docxToPdf.mockResolvedValue(PDF);
        const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("application/pdf");
    });

    it("gives a converted display's place back when its response ends: twelve in a row are all served", async () => {
        fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null } });
        active.current = { ...active.current, pdf_storage_path: null };
        docxToPdf.mockResolvedValue(PDF);
        for (let display = 0; display < 12; display++) {
            const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
            expect(res.status).toBe(200);
        }
        expect(docxToPdf).toHaveBeenCalledTimes(12);
    });

    it("holds no place for a client that left while its session was being checked: the next display is served", async () => {
        fakeStore({ "u/Contract.docx": { bytes: Buffer.from("docx bytes"), etag: null } });
        active.current = { ...active.current, pdf_storage_path: null };
        docxToPdf.mockResolvedValue(PDF);
        const server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        const { port } = server.address() as AddressInfo;
        let gone = 0;
        server.on("connection", (socket) => socket.once("close", () => (gone += 1)));
        let open: () => void = () => undefined;
        auth.waiting = 0;
        auth.gate = new Promise<void>((resolve) => (open = resolve));
        try {
            // Ten clients ask for the display and leave before their session is known.
            for (let client = 0; client < 10; client++) {
                const socket = connect(port, "127.0.0.1", () =>
                    socket.write(
                        `GET /single-documents/${DOC}/display HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test\r\n\r\n`,
                        () => socket.destroy(),
                    ),
                );
                socket.on("error", () => {});
            }
            await vi.waitFor(() => expect([auth.waiting, gone]).toEqual([10, 10]), { timeout: 5_000 });
        } finally {
            auth.gate = null;
            open();
        }
        try {
            // Their requests go on with nobody to answer.
            await new Promise((resolve) => setTimeout(resolve, 200));
            const res = await request(app).get(`/single-documents/${DOC}/display`).set(...AUTH);
            expect(res.status).toBe(200);
            // Nothing was converted for those who left.
            expect(docxToPdf).toHaveBeenCalledTimes(1);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    }, 20_000);

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
