import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { ExportBuildRequest } from "../exportContracts";
import { createExportStorageFake } from "./exportStorageFake";

const { filenames, deniedIds } = vi.hoisted(() => ({
    filenames: new Map<string, { filename: string | null; version_number?: number; source?: string }>(),
    deniedIds: new Set<string>(),
}));
let fake = createExportStorageFake(() => null);

// Keep the queued ZIP builder real; replace its I/O and unrelated export paths.
vi.mock("../../../lib/storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/storage")>()),
    headFile: (key: string) => fake.headFile(key),
    openFileStream: async (key: string) => fake.createFileReadStream(key),
    uploadFileFromPath: (key: string, path: string, type: string) => fake.uploadFileFromPath(key, path, type),
    uploadFile: (...args: unknown[]) => (fake.uploadFile as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../lib/access", () => ({
    accountErasureRequested: async () => false,
    createDocumentAccessChecker: () => async (doc: { id: string }) => ({ ok: !deniedIds.has(doc.id) }),
}));
vi.mock("../../../lib/confirmedEmail", () => ({ currentConfirmedEmail: async () => "" }));
vi.mock("../../../lib/documentVersions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/documentVersions")>()),
    attachActiveVersionPaths: async (_db: unknown, docs: Array<Record<string, unknown>>) => {
        for (const doc of docs) {
            const id = doc.id as string;
            const version = filenames.get(id);
            Object.assign(doc, {
                storage_path: `${id}.docx`,
                filename: version ? version.filename : `${id}.docx`,
                active_version_number: version?.version_number ?? 1,
                source: version?.source ?? "upload",
            });
        }
        return docs;
    },
}));
// LiTT: a version leaves the firm only when no training seal holds it
// (exportBuild.trainingLock.test.ts covers the gate itself).
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
vi.mock("../../../lib/dbq/runner", () => ({ NonRetryableJobError: class extends Error {} }));
vi.mock("../../../modules/orgs/orgs.service", () => ({ memberDataActionAllowed: vi.fn() }));

import { buildExport } from "../buildExport";

const job: ExportBuildRequest = {
    id: "export-1",
    payload: { userId: "u1", type: "documents-zip", document_ids: ["d1", "d2"] },
};
const db = {
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
        data: ids.map(id => ({ id, current_version_id: `${id}-version`, user_id: "u1", project_id: null })), error: null,
    }) }) }),
};

beforeEach(() => {
    filenames.clear();
    deniedIds.clear();
    fake = createExportStorageFake(key => Buffer.from(`original bytes for ${key}`));
});

async function expectArchive(names: string[], ids: string[], attempt = 0) {
    const zip = await JSZip.loadAsync(fake.uploads[attempt]!.bytes);
    expect(Object.keys(zip.files)).toEqual(names);
    for (const [index, name] of names.entries()) {
        expect(await zip.file(name)!.async("string")).toBe(`original bytes for ${ids[index]}.docx`);
    }
}

describe("queued document ZIP filenames", () => {
    it("preserves all eleven documents and exact bytes when two share a filename", async () => {
        const ids = Array.from({ length: 11 }, (_, index) => `document-${index}`);
        filenames.set(ids[0]!, { filename: "Agreement.pdf" });
        filenames.set(ids[1]!, { filename: "Agreement.pdf" });

        await buildExport(db as never, { ...job, payload: { ...job.payload, document_ids: ids } });

        await expectArchive(["Agreement.pdf", "Agreement (2).pdf", ...ids.slice(2).map(id => `${id}.docx`)], ids);
    });

    it("avoids existing suffixes and collisions from edited versions or missing filenames on every retry", async () => {
        const entries = [
            { filename: "Agreement (2).pdf" },
            { filename: "Agreement.pdf" },
            { filename: "Agreement.pdf" },
            { filename: "Agreement.pdf", version_number: 3, source: "assistant_edit" },
            { filename: "Agreement.pdf", version_number: 3, source: "assistant_edit" },
            { filename: null },
            { filename: null },
        ];
        const ids = entries.map((entry, index) => {
            const id = `document-${index}`;
            filenames.set(id, entry);
            return id;
        });
        const selectedJob = { ...job, payload: { ...job.payload, document_ids: ids } };
        for (let attempt = 0; attempt < 2; attempt++) {
            await buildExport(db as never, selectedJob);
            await expectArchive([
                "Agreement (2).pdf", "Agreement.pdf", "Agreement (3).pdf",
                "Agreement [Edited V3].pdf", "Agreement [Edited V3] (2).pdf",
                "Untitled document", "Untitled document (2)",
            ], ids, attempt);
        }
        expect(fake.uploads[0]!.key).toBe(fake.uploads[1]!.key);
    });

    it("keeps unique source filenames and their bytes unchanged", async () => {
        await buildExport(db as never, job);
        await expectArchive(["d1.docx", "d2.docx"], ["d1", "d2"]);
    });

    it("does not read or reserve a name for a document that is no longer accessible", async () => {
        filenames.set("d1", { filename: "Agreement.pdf" });
        filenames.set("d2", { filename: "Agreement.pdf" });
        deniedIds.add("d1");

        await buildExport(db as never, job);

        expect(fake.opened).toEqual(["d2.docx"]);
        await expectArchive(["Agreement.pdf"], ["d2"]);
    });

    it("does not publish a partial archive when an accessible source read fails", async () => {
        fake = createExportStorageFake(key => {
            if (key === "d2.docx") throw new Error("synthetic storage failure");
            return Buffer.from(key);
        });

        await expect(buildExport(db as never, job)).rejects.toThrow("synthetic storage failure");
        expect(fake.uploads).toEqual([]);
    });
});
