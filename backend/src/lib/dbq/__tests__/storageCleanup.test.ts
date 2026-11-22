// The storage.cleanup job used to throw a fresh Error on any failed delete,
// so the runner reported "deletes failed" with no kind, no operation and no
// SDK code. The first failure now travels as the cause, and the job names
// its operation so its events group under storage.cleanup.
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    deleteFile: vi.fn(),
    listFiles: vi.fn(),
    assertStorageConfigured: vi.fn(),
}));
vi.mock("../../storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../storage")>()),
    ...storage,
}));
const reports = vi.hoisted(() => ({ setOperation: vi.fn() }));
vi.mock("../../observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../observability/report")>()),
    setOperation: reports.setOperation,
}));

import { diagnosticErrorTags } from "../../observability/diagnostics";
import { StorageOperationError } from "../../storage";
import { handleStorageCleanup } from "../storageCleanup";
import type { DbJob } from "../types";

const JOB = (payload: Record<string, unknown>): DbJob => ({
    id: "job-1",
    kind: "storage.cleanup",
    payload,
    status: "running",
    attempts: 1,
    max_attempts: 8,
    run_at: "",
    claimed_at: null,
    finished_at: null,
    last_error: null,
    dedupe_key: null,
    result: null,
    created_at: "",
});

beforeEach(() => {
    vi.clearAllMocks();
    storage.deleteFile.mockResolvedValue(undefined);
    storage.listFiles.mockResolvedValue([]);
});

describe("handleStorageCleanup", () => {
    it("names its operation for every event the job produces", async () => {
        await handleStorageCleanup({} as never, JOB({ keys: ["a.pdf"] }));
        expect(reports.setOperation).toHaveBeenCalledWith("storage.cleanup");
    });

    it("keeps the first delete failure as the cause of the retry error", async () => {
        const sdkError = Object.assign(new Error("access denied"), {
            name: "AccessDenied",
        });
        storage.deleteFile
            .mockRejectedValueOnce(new StorageOperationError("delete", { cause: sdkError }))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("second failure"));

        const thrown = await handleStorageCleanup(
            {} as never,
            JOB({ keys: ["a.pdf", "b.pdf", "c.pdf"] }),
        ).catch((error: unknown) => error);

        // Every key was attempted; the summary message still counts them.
        expect(storage.deleteFile).toHaveBeenCalledTimes(3);
        expect(thrown).toMatchObject({ message: "[storage.cleanup] 2/3 deletes failed" });
        expect(diagnosticErrorTags(thrown)).toEqual({
            error_kind: "storage.delete_failed",
            storage_operation: "delete",
            failure_code: "AccessDenied",
        });
        // The keys stay out of the error that reaches the runner's report.
        expect(JSON.stringify(diagnosticErrorTags(thrown))).not.toContain("a.pdf");
    });

    describe("a cleanup that yields to stored versions", () => {
        // A db whose document_versions rows are `rows`; `failing` makes the
        // lookup answer with an error.
        const versionsDb = (rows: Array<Record<string, unknown>>, failing = false) => {
            const selects: string[] = [];
            return {
                selects,
                db: {
                    from: (table: string) => {
                        expect(table).toBe("document_versions");
                        return {
                            select: (columns: string) => {
                                selects.push(columns);
                                return {
                                    in: async (column: string, values: string[]) =>
                                        failing
                                            ? { data: null, error: { message: "db down" } }
                                            : {
                                                  data: rows
                                                      .filter((row) => values.includes(row[column] as string))
                                                      .map((row) => ({ [column]: row[column] })),
                                                  error: null,
                                              },
                                };
                            },
                        };
                    },
                } as never,
            };
        };
        const marked = { keys: ["a.pdf", "b.pdf"], prefixes: [], unlessUsedByVersion: true };
        const deleted = () => storage.deleteFile.mock.calls.map((call) => call[0]);

        it("keeps the keys a version's source or rendition points at, and removes the rest", async () => {
            const { db } = versionsDb([{ storage_path: "a.pdf" }]);
            await handleStorageCleanup(db, JOB(marked));
            expect(deleted()).toEqual(["b.pdf"]);
        });

        it("keeps a key that is referenced only as a rendition", async () => {
            const { db } = versionsDb([{ storage_path: "x.docx", pdf_storage_path: "b.pdf" }]);
            await handleStorageCleanup(db, JOB(marked));
            expect(deleted()).toEqual(["a.pdf"]);
        });

        it("deletes nothing and fails, to be retried, when the lookup fails", async () => {
            const { db } = versionsDb([], true);
            await expect(handleStorageCleanup(db, JOB(marked))).rejects.toThrow();
            expect(storage.deleteFile).not.toHaveBeenCalled();
        });

        it("also keeps referenced keys found through a prefix", async () => {
            storage.listFiles.mockResolvedValue(["p/1", "p/2"]);
            const { db } = versionsDb([{ storage_path: "p/1" }]);
            await handleStorageCleanup(db, JOB({ keys: [], prefixes: ["p/"], unlessUsedByVersion: true }));
            expect(deleted()).toEqual(["p/2"]);
        });

        it("a cleanup without the marker deletes every key and does not look at versions", async () => {
            const { db, selects } = versionsDb([{ storage_path: "a.pdf" }, { pdf_storage_path: "b.pdf" }]);
            await handleStorageCleanup(db, JOB({ keys: ["a.pdf", "b.pdf"], prefixes: [] }));
            expect(deleted()).toEqual(["a.pdf", "b.pdf"]);
            expect(selects).toEqual([]);
        });
    });
});
