import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// replicate_document is a chat-tool LibreOffice call site: when the copied
// source has no PDF rendition, the sync path converts inline on the request
// thread. These tests pin the ASYNC_DOCUMENT_CONVERSION contract there:
//   - flag off → inline docxToPdf, one shared rendition uploaded per copy,
//     no queue involved (the historical behavior)
//   - flag on  → no LibreOffice in-band; copies are inserted without a
//     rendition and one conversion job per copy fills it in

const { downloadFile, uploadFile, docxToPdf, enqueueConversion, loadActiveVersion } = vi.hoisted(
    () => ({
        loadActiveVersion: vi.fn(),
        downloadFile: vi.fn(),
        uploadFile: vi.fn(),
        docxToPdf: vi.fn(),
        enqueueConversion: vi.fn(),
    }),
);

vi.mock("../../../../lib/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../lib/storage")>();
    return {
        ...actual,
        downloadFile: (...args: unknown[]) => downloadFile(...args),
        uploadFile: (...args: unknown[]) => uploadFile(...args),
    };
});

vi.mock("../../../../lib/documentVersions", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../lib/documentVersions")>();
    return {
        ...actual,
        loadActiveVersion: (...args: unknown[]) => loadActiveVersion(...args),
    };
});

vi.mock("../../../../lib/convert", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../lib/convert")>();
    return {
        ...actual,
        docxToPdf: (...args: unknown[]) => docxToPdf(...args),
    };
});

vi.mock("../../../../lib/queue/conversionQueue", () => ({
    enqueueConversion: (...args: unknown[]) => enqueueConversion(...args),
}));

vi.mock("../../../../lib/downloadTokens", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../lib/downloadTokens")>();
    return {
        ...actual,
        buildDownloadUrl: (_storagePath: string, filename: string) =>
            `/download/${encodeURIComponent(filename)}`,
    };
});

import { runToolCalls } from "../tools/toolDispatcher";
import type { DocIndex, DocStore } from "../types";

// Same double as workflowAssetReplication.test.ts: documents echo their
// client-generated ids; versions get deterministic new-version-N ids.
// `sealRows` answers the facade's read of the copy source's pasante seal; a
// sealed copy then reads its new document's organization back.
const UNSEALED = { training_author_user_id: null, training_stage: null };
function replicationDb(sealRows: unknown[] = [UNSEALED]) {
    const documents = new Map<string, Record<string, unknown>>();
    const versionRows: Record<string, unknown>[][] = [];
    const sealReads: Array<[string, unknown]> = [];
    const db = {
        rpc: vi.fn(async (name: string, args: { p_versions: Record<string, unknown>[] }) => {
            expect(name).toBe("create_document_versions");
            versionRows.push(args.p_versions);
            return { data: args.p_versions.map((row, index) => ({ ...row, id: `new-version-${index + 1}` })), error: null };
        }),
        from(table: string) {
            if (table === "documents") {
                return {
                    select: () => ({
                        eq: (_column: string, id: string) => ({
                            maybeSingle: async () => ({ data: documents.get(id) ?? null, error: null }),
                        }),
                    }),
                    insert(rows: Record<string, unknown>[]) {
                        for (const row of rows) documents.set(row.id as string, row);
                        return {
                            select: async () => ({
                                data: rows.map((row) => ({ id: row.id })),
                                error: null,
                            }),
                        };
                    },
                    update: () => ({
                        eq: async () => ({ data: null, error: null }),
                    }),
                    delete: () => ({
                        in: async () => ({ data: null, error: null }),
                    }),
                };
            }
            if (table === "document_versions") {
                return {
                    select: () => ({
                        eq: async (column: string, value: unknown) => {
                            sealReads.push([column, value]);
                            return { data: sealRows, error: null };
                        },
                    }),
                    insert(rows: Record<string, unknown>[]) {
                        versionRows.push(rows);
                        return {
                            select: async () => ({
                                data: rows.map((row, index) => ({
                                    id: `new-version-${index + 1}`,
                                    document_id: row.document_id,
                                })),
                                error: null,
                            }),
                        };
                    },
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    };
    return { db, versionRows, sealReads };
}

// A DOCX workflow asset with no rendition — the exact case that pays for
// LibreOffice inside replicate_document.
const SOURCE_LABEL = "workflow-ref-workflow-1-1";
function makeStore(): DocStore {
    return new Map([
        [
            SOURCE_LABEL,
            {
                filename: "Precedent.docx",
                file_type: "docx",
                storage_path: "workflow-assets/precedent.docx",
                source_kind: "workflow_asset" as const,
            },
        ],
    ]);
}

async function replicate(db: unknown, index: DocIndex, count?: number, orgId: string | null = "org") {
    return runToolCalls(
        [
            {
                id: "replicate-1",
                function: {
                    name: "replicate_document",
                    arguments: JSON.stringify({
                        doc_id: SOURCE_LABEL,
                        new_filename: "Client precedent.docx",
                        ...(count ? { count } : {}),
                    }),
                },
            },
        ],
        makeStore(),
        "user-1",
        db as never,
        () => undefined,
        undefined,
        undefined,
        index,
        undefined,
        undefined,
        null,
        undefined,
        { orgId },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    loadActiveVersion.mockResolvedValue(null);
    downloadFile.mockResolvedValue(new TextEncoder().encode("docx").buffer);
    uploadFile.mockResolvedValue(undefined);
    docxToPdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    enqueueConversion.mockResolvedValue({});
});

afterEach(() => {
    delete process.env.ASYNC_DOCUMENT_CONVERSION;
});

describe("replicate_document rendition path", () => {
    it("flag off: converts inline once and stores a rendition per copy", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "false";
        const { db, versionRows } = replicationDb();

        await replicate(db, {});

        expect(docxToPdf).toHaveBeenCalledTimes(1);
        expect(enqueueConversion).not.toHaveBeenCalled();
        expect(versionRows[0][0].pdf_storage_path).toMatch(/^converted-pdfs\//);
    });

    it("flag on: no in-band LibreOffice; one conversion job per copy", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        const { db, versionRows } = replicationDb();

        await replicate(db, {}, 2);

        expect(docxToPdf).not.toHaveBeenCalled();
        // Copies are inserted rendition-less; the queue fills them in.
        expect(versionRows[0].map((r) => r.pdf_storage_path)).toEqual([
            null,
            null,
        ]);
        expect(enqueueConversion).toHaveBeenCalledTimes(2);
        for (const [call, versionId] of [
            [enqueueConversion.mock.calls[0][0], "new-version-1"],
            [enqueueConversion.mock.calls[1][0], "new-version-2"],
        ] as [Record<string, unknown>, string][]) {
            expect(call).toMatchObject({
                versionId,
                userId: "user-1",
                fileType: "docx",
                // Copies are inserted "ready" and usable from raw bytes; a
                // rendition failure must never flip them to "error".
                finalizeDocumentStatus: false,
            });
            expect(call.pdfKey).toBe(
                `converted-pdfs/user-1/${call.documentId as string}.pdf`,
            );
        }
    });

    it("flag on: a failed enqueue still returns usable copies (no rendition)", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        enqueueConversion.mockRejectedValue(new Error("redis down"));
        const { db } = replicationDb();
        const index: DocIndex = {};

        const result = await replicate(db, index);

        const content = JSON.parse(
            (result.toolResults[0] as { content: string }).content,
        );
        expect(content.ok).toBe(true);
        expect(content.copies).toHaveLength(1);
        expect(index["doc-0"]).toBeDefined();
    });

    it.each([
        ["a pasante's workflow-asset source keeps its author", [{ training_author_user_id: "pasante-1", training_stage: "pasante" }]],
        ["an unsealed source stays unsealed", [UNSEALED]],
    ])("%s", async (_name, sealRows) => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        const { db, versionRows, sealReads } = replicationDb(sealRows);

        await replicate(db, {});

        expect(sealReads).toEqual([["storage_path", "workflow-assets/precedent.docx"]]);
        const row = versionRows[0][0];
        expect(row).not.toHaveProperty("authorship");
        if (sealRows[0].training_stage) expect(row).toMatchObject({ training_author_user_id: "pasante-1", training_stage: "pasante" });
        else {
            expect(row).not.toHaveProperty("training_author_user_id");
            expect(row).not.toHaveProperty("training_stage");
        }
    });

    it("a pasante's source document version keeps its author, read by version id", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        loadActiveVersion.mockResolvedValue({
            id: "source-version",
            storage_path: "documents/source.docx",
            pdf_storage_path: null,
        });
        const { db, versionRows, sealReads } = replicationDb([
            { training_author_user_id: "pasante-1", training_stage: "pasante" },
        ]);

        await replicate(db, { [SOURCE_LABEL]: { document_id: "source-doc", filename: "Precedent.docx" } });

        expect(sealReads).toEqual([["id", "source-version"]]);
        expect(versionRows[0][0]).toMatchObject({ training_author_user_id: "pasante-1", training_stage: "pasante" });
    });

    // A5: outside a project the copy takes the conversation's organization;
    // with none, nobody could approve a pasante's copy, so none is made.
    it("refuses a pasante's copy in a chat without an organization", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        const { db, versionRows } = replicationDb([
            { training_author_user_id: "pasante-1", training_stage: "pasante" },
        ]);

        const result = await replicate(db, {}, undefined, null);

        expect(JSON.parse((result.toolResults[0] as { content: string }).content)).toMatchObject({
            ok: false,
        });
        expect(versionRows).toEqual([]);
    });
});
