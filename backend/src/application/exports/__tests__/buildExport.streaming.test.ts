import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { ExportBuildRequest } from "../exportContracts";
import { createExportStorageFake, type StreamedSource } from "./exportStorageFake";

const { filenames, NonRetryable, limits } = vi.hoisted(() => ({
    filenames: new Map<string, string>(),
    limits: { bytes: 1_000 },
    NonRetryable: class NonRetryable extends Error {},
}));
let fake = createExportStorageFake(() => null);

vi.mock("../../../lib/storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/storage")>()),
    headFile: (key: string) => fake.headFile(key),
    uploadFileFromPath: (key: string, path: string, type: string) => fake.uploadFileFromPath(key, path, type),
    uploadFile: (...args: unknown[]) => (fake.uploadFile as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../lib/access", () => ({
    accountErasureRequested: async () => false,
    createDocumentAccessChecker: () => async () => ({ ok: true }),
}));
vi.mock("../../../lib/confirmedEmail", () => ({ currentConfirmedEmail: async () => "" }));
vi.mock("../../../lib/documentVersions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/documentVersions")>()),
    attachActiveVersionPaths: async (_db: unknown, docs: Array<Record<string, unknown>>) => {
        for (const doc of docs) {
            Object.assign(doc, {
                storage_path: `${doc.id}.pdf`,
                filename: filenames.get(doc.id as string) ?? `${doc.id}.pdf`,
                active_version_number: 1,
                source: "upload",
            });
        }
        return docs;
    },
}));
vi.mock("../../../lib/trainingRelease", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/trainingRelease")>()),
    assertVersionReleasable: async () => ({ ok: true }),
}));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("../../../lib/auditExport", () => ({ AUDIT_CSV_FILENAME: "audit.csv", buildAuditCsv: vi.fn() }));
vi.mock("../buildJsonExport", () => ({
    buildUserAccountExport: vi.fn(), buildUserChatsExport: vi.fn(),
    buildUserTabularReviewsExport: vi.fn(), userExportFilename: vi.fn(),
}));
vi.mock("../../../lib/memory/archive", () => ({ buildMemoryArchive: vi.fn() }));
vi.mock("../../../lib/dbq/runner", () => ({ NonRetryableJobError: NonRetryable }));
vi.mock("../../../modules/orgs/orgs.service", () => ({ memberDataActionAllowed: vi.fn() }));
// A small ceiling stands in for the 2 GB one, so no test allocates much.
vi.mock("../../../lib/zipExport", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/zipExport")>()),
    zipExportLimitDetail: (_documents: number, bytes: number) =>
        bytes > limits.bytes ? "A ZIP download can include at most 2 GB of source files." : null,
}));

import { buildExport } from "../buildExport";
import { setStorageAdapter } from "../../../lib/storage";

const job: ExportBuildRequest = {
    id: "export-1",
    payload: { userId: "u1", type: "documents-zip", document_ids: ["d1", "d2", "d3"] },
};
const db = {
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
        data: ids.map((id) => ({ id, current_version_id: `${id}-version`, user_id: "u1", project_id: null })), error: null,
    }) }) }),
};
// This file's own temporary folder, so another test file's exports are never mistaken for a leftover.
const outerTemp = process.env.TMPDIR;
const ownTemp = mkdtempSync(join(tmpdir(), "export-streaming-"));
beforeAll(() => {
    process.env.TMPDIR = ownTemp;
});
afterAll(() => {
    if (outerTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = outerTemp;
    rmSync(ownTemp, { recursive: true, force: true });
});
const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("mike-export-"));

/** An object of `size` bytes produced in pieces, never held whole. */
const streamed = (size: number, headSize: number | null = size, piece = 1024): StreamedSource => ({
    headSize,
    chunks: async function* () {
        for (let sent = 0; sent < size; sent += piece) yield new Uint8Array(Math.min(piece, size - sent)).fill(7);
    },
});

beforeEach(() => {
    limits.bytes = 1_000;
    filenames.clear();
    fake = createExportStorageFake((key) => Buffer.from(`bytes of ${key}`));
    // Entries are read through the store's own stream reader (with its time limit).
    setStorageAdapter({
        enabled: true,
        configurationHint: "test",
        headFile: (key: string) => fake.headFile(key),
        openReadStream: async (key: string) => fake.createFileReadStream(key),
        uploadFileFromPath: (key: string, path: string, type: string) => fake.uploadFileFromPath(key, path, type),
        uploadFile: (...args: unknown[]) => (fake.uploadFile as (...a: unknown[]) => unknown)(...args),
    } as never);
});

describe("queued document ZIP export", () => {
    it("writes the archive to a file, uploads it from the file, and removes the file", async () => {
        const before = leftovers();
        await buildExport(db as never, job);

        expect(fake.uploadFile).not.toHaveBeenCalled();
        expect(fake.uploads).toHaveLength(1);
        const [upload] = fake.uploads;
        expect(upload.key).toBe("exports/u1/export-1-documents.zip");
        expect(upload.contentType).toBe("application/zip");
        const zip = await JSZip.loadAsync(upload.bytes);
        expect(await zip.file("d2.pdf")!.async("string")).toBe("bytes of d2.pdf");
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    });

    it("reads one stored object at a time, as the archive consumes it", async () => {
        fake = createExportStorageFake(() => streamed(300, 300, 100));
        await buildExport(db as never, job);
        expect(fake.opened).toEqual(["d1.pdf", "d2.pdf", "d3.pdf"]);
        expect(fake.state.peakOpen).toBe(1);
    });

    it("skips an object that is no longer stored", async () => {
        fake = createExportStorageFake((key) => (key === "d2.pdf" ? null : Buffer.from(key)));
        await buildExport(db as never, job);
        const zip = await JSZip.loadAsync(fake.uploads[0]!.bytes);
        expect(Object.keys(zip.files)).toEqual(["d1.pdf", "d3.pdf"]);
    });

    it("leaves no file and publishes nothing when a stored object fails to read, and the failure may be retried", async () => {
        const before = leftovers();
        fake = createExportStorageFake((key) => {
            if (key === "d2.pdf") throw new Error("synthetic storage failure");
            return Buffer.from(key);
        });
        const failure = await buildExport(db as never, job).catch((error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(NonRetryable);
        expect(failure.message).toMatch(/synthetic storage failure/);
        expect(fake.uploads).toEqual([]);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    });

    it("leaves no file when the upload fails", async () => {
        const before = leftovers();
        fake.uploadFileFromPath.mockRejectedValueOnce(new Error("synthetic upload failure"));
        await expect(buildExport(db as never, job)).rejects.toThrow(/synthetic upload failure/);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    });

    it("refuses a selection whose recorded sizes pass the export limit, before reading any object and without retry", async () => {
        const before = leftovers();
        fake = createExportStorageFake(() => streamed(400));
        const failure = await buildExport(db as never, job).catch((error) => error);
        expect(failure).toBeInstanceOf(NonRetryable);
        expect(failure.message).toMatch(/at most 2 GB/);
        expect(fake.opened).toEqual([]);
        expect(fake.uploads).toEqual([]);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    });

    it("refuses without retry an object that turns out larger than its recorded size, and removes the partial file", async () => {
        const before = leftovers();
        fake = createExportStorageFake((key) => (key === "d2.pdf" ? streamed(1_500, 10) : streamed(10)));
        const failure = await buildExport(db as never, job).catch((error) => error);
        expect(failure).toBeInstanceOf(NonRetryable);
        expect(fake.uploads).toEqual([]);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    });

    // A failure while reading ANY entry, at any chunk, ends the job with that error
    // instead of leaving it waiting; each case must settle within the test's own limit.
    // Six entries of four chunks each, as an archive of real files is, not one-chunk objects.
    const KiB = 1024;
    // Random bytes do not compress, so the archive works on them as it does on real files.
    const block = randomBytes(256 * KiB);
    const entryOf = (size: number): StreamedSource => ({
        headSize: size,
        chunks: async function* () {
            for (let sent = 0; sent < size; sent += block.length) yield block;
        },
    });
    const manyJob: ExportBuildRequest = {
        id: "export-2",
        payload: { userId: "u1", type: "documents-zip", document_ids: ["d1", "d2", "d3", "d4", "d5", "d6"] },
    };
    const failingAt = (bad: string, after: number, how: "throw" | "stall" | "grow") =>
        createExportStorageFake((key) =>
            key !== bad
                ? entryOf(1024 * KiB)
                : {
                      headSize: how === "grow" ? 10 : 1024 * KiB,
                      // A byte stream of the store that is destroyed with an error part-way, as a socket is.
                      chunks: () => {
                          let sent = 0;
                          return new Readable({
                              read() {
                                  if (sent === after && how === "throw") return void this.destroy(new Error("synthetic read failure"));
                                  if (sent === after && how === "stall") return;
                                  this.push(block);
                                  sent += 1;
                              },
                          });
                      },
                  },
        );

    it.each([
        ["the first entry", "d1.pdf", 2],
        ["a middle entry after three chunks", "d4.pdf", 3],
        ["a middle entry on its first chunk", "d2.pdf", 0],
        ["the last entry", "d6.pdf", 2],
    ] as const)("fails the job with the read error, removing the partial file, when %s fails mid-read", async (_name, bad, after) => {
        limits.bytes = 64 * 1024 * KiB;
        const before = leftovers();
        fake = failingAt(bad, after, "throw");
        const failure = await buildExport(db as never, manyJob).catch((error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(NonRetryable);
        expect(failure.message).toMatch(/synthetic read failure|storage download failed/i);
        expect(fake.uploads).toEqual([]);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    }, 10_000);

    it("fails the job when a read stalls past the store's read time limit", async () => {
        process.env.STORAGE_DOWNLOAD_TIMEOUT_MS = "200";
        try {
            const before = leftovers();
            limits.bytes = 64 * 1024 * KiB;
            fake = failingAt("d4.pdf", 2, "stall");
            const failure = await buildExport(db as never, manyJob).catch((error) => error);
            expect(failure).toBeInstanceOf(Error);
            expect(failure.message).toMatch(/timed out|storage/i);
            expect(fake.uploads).toEqual([]);
            expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
        } finally {
            delete process.env.STORAGE_DOWNLOAD_TIMEOUT_MS;
        }
    }, 10_000);

    it("refuses without retry an entry found larger than its limit mid-read, in a middle entry, and removes the partial file", async () => {
        const before = leftovers();
        limits.bytes = 5.5 * 1024 * KiB;
        fake = failingAt("d4.pdf", 3, "grow");
        const failure = await buildExport(db as never, manyJob).catch((error) => error);
        expect(failure).toBeInstanceOf(NonRetryable);
        expect(failure.message).toMatch(/at most 2 GB/);
        expect(fake.uploads).toEqual([]);
        expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
    }, 10_000);
});
