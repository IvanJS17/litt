import { lstat, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Every directory the queued ZIP export creates for its archive starts with this. */
export const EXPORT_TEMP_PREFIX = "mike-export-";

/** The archive's file name inside such a directory. */
export const ARCHIVE_FILENAME = "documents.zip";

/** How long a directory must have gone unwritten before it is taken for abandoned. */
const EXPORT_TEMP_GRACE_MS = 10 * 60_000;

/**
 * Remove the archive directories a process that died mid-export left behind.
 * Only directories with the export prefix are looked at, and only those not
 * written to for `graceMs`, so an export another process is writing now is
 * never touched.
 */
export async function removeStaleExportDirectories(
    options: { directory?: string; now?: number; graceMs?: number } = {},
): Promise<string[]> {
    const directory = options.directory ?? tmpdir();
    const now = options.now ?? Date.now();
    const graceMs = options.graceMs ?? EXPORT_TEMP_GRACE_MS;
    let names: string[];
    try {
        names = await readdir(directory);
    } catch {
        return [];
    }
    const removed: string[] = [];
    for (const name of names) {
        if (!name.startsWith(EXPORT_TEMP_PREFIX)) continue;
        const path = join(directory, name);
        try {
            // lstat: a link with this name is not ours and is never followed.
            const entry = await lstat(path);
            if (!entry.isDirectory()) continue;
            let newest = entry.mtimeMs;
            try {
                newest = Math.max(newest, (await stat(join(path, ARCHIVE_FILENAME))).mtimeMs);
            } catch {
                /* the archive file was not created yet, or is gone */
            }
            if (now - newest < graceMs) continue;
            await rm(path, { recursive: true, force: true });
            removed.push(name);
        } catch {
            /* one directory that cannot be removed must not stop the others */
        }
    }
    return removed;
}
