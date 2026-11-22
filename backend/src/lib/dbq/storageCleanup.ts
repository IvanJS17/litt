// storageCleanup — implementation behind the module facade.
import { setOperation } from "../observability/report";
import { assertStorageConfigured, deleteFile, listFiles } from "../storage";
import { type Db, type DbJob } from "./types";

/**
 * Of these storage keys, the ones no document version points at. A lookup
 * that fails is thrown, never answered: bytes left over cost space, bytes
 * removed under a stored version cost the document.
 */
async function keysNoVersionUses(db: Db, keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const [bySource, byPdf] = await Promise.all([
        db.from("document_versions").select("storage_path").in("storage_path", keys),
        db.from("document_versions").select("pdf_storage_path").in("pdf_storage_path", keys),
    ]);
    const failure = bySource.error ?? byPdf.error;
    if (failure) throw new Error("[storage.cleanup] version lookup failed", { cause: failure });
    const used = new Set<unknown>([
        ...(bySource.data ?? []).map((row: { storage_path?: unknown }) => row.storage_path),
        ...(byPdf.data ?? []).map((row: { pdf_storage_path?: unknown }) => row.pdf_storage_path),
    ]);
    return keys.filter((key) => !used.has(key));
}

export async function handleStorageCleanup(db: Db, job: DbJob): Promise<void> {
    setOperation("storage.cleanup");
    const keys = (job.payload.keys as string[] | undefined) ?? [];
    const prefixes = (job.payload.prefixes as string[] | undefined) ?? [];

    if (keys.length > 0 || prefixes.length > 0) assertStorageConfigured();

    const targets = new Set(keys.filter((k) => typeof k === "string" && k));
    for (const prefix of prefixes) {
        if (typeof prefix !== "string" || !prefix) continue;
        for (const key of await listFiles(prefix)) targets.add(key);
    }

    // A cleanup enqueued because an upload was refused may be racing a retry
    // that stored a version under the same keys: the answer is decided now,
    // at the moment of deletion, not when the cleanup was enqueued.
    if (job.payload.unlessUsedByVersion === true) {
        const keep = await keysNoVersionUses(db, [...targets]);
        for (const key of [...targets]) if (!keep.includes(key)) targets.delete(key);
    }

    // Delete everything we can this attempt; throw at the end if anything
    // failed so the retry re-runs the (idempotent) remainder. The first
    // failure travels as the cause: it is a StorageOperationError whose kind,
    // operation and SDK code are what the report boundary reads, and a fresh
    // Error without it reported only "deletes failed".
    let failures = 0;
    let firstFailure: unknown;
    for (const key of targets) {
        try {
            await deleteFile(key);
        } catch (error) {
            failures++;
            firstFailure ??= error;
        }
    }
    if (failures > 0) {
        throw new Error(
            `[storage.cleanup] ${failures}/${targets.size} deletes failed`,
            { cause: firstFailure },
        );
    }
}
