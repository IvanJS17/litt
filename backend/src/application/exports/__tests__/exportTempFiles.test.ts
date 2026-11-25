import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXPORT_TEMP_PREFIX, removeStaleExportDirectories } from "../exportTempFiles";

let temp: string;
beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), "export-temp-test-"));
});
afterEach(() => rm(temp, { recursive: true, force: true }));

const ago = (ms: number) => new Date(Date.now() - ms);
async function directory(name: string, age: number, withArchive = true) {
    const path = join(temp, name);
    await mkdir(path);
    if (withArchive) await writeFile(join(path, "documents.zip"), "partial");
    const when = ago(age);
    if (withArchive) await utimes(join(path, "documents.zip"), when, when);
    await utimes(path, when, when);
    return path;
}

describe("start-up cleanup of abandoned export archives", () => {
    it("removes only the export directories that have not been written to for the grace period", async () => {
        const HOUR = 60 * 60_000;
        await directory(`${EXPORT_TEMP_PREFIX}dead1`, HOUR);
        await directory(`${EXPORT_TEMP_PREFIX}dead2`, HOUR, false);
        await directory(`${EXPORT_TEMP_PREFIX}live`, 1_000);
        // An old archive file keeps a directory whose own entry list is old but whose file is being written.
        const writing = await directory(`${EXPORT_TEMP_PREFIX}writing`, HOUR);
        await utimes(join(writing, "documents.zip"), new Date(), new Date());
        await directory("somebody-elses-old-directory", HOUR);
        await directory(`not-${EXPORT_TEMP_PREFIX}old`, HOUR);
        await writeFile(join(temp, `${EXPORT_TEMP_PREFIX}a-plain-file`), "x");
        await utimes(join(temp, `${EXPORT_TEMP_PREFIX}a-plain-file`), ago(HOUR), ago(HOUR));
        const outside = await mkdtemp(join(tmpdir(), "export-temp-outside-"));
        await utimes(outside, ago(HOUR), ago(HOUR));
        await symlink(outside, join(temp, `${EXPORT_TEMP_PREFIX}link`));
        await utimes(join(temp, `${EXPORT_TEMP_PREFIX}link`), ago(HOUR), ago(HOUR));

        try {
            const removed = await removeStaleExportDirectories({ directory: temp, graceMs: 10 * 60_000 });
            expect(removed.sort()).toEqual([`${EXPORT_TEMP_PREFIX}dead1`, `${EXPORT_TEMP_PREFIX}dead2`]);
            expect((await readdir(temp)).sort()).toEqual(
                [
                    `${EXPORT_TEMP_PREFIX}a-plain-file`,
                    `${EXPORT_TEMP_PREFIX}link`,
                    `${EXPORT_TEMP_PREFIX}live`,
                    `${EXPORT_TEMP_PREFIX}writing`,
                    `not-${EXPORT_TEMP_PREFIX}old`,
                    "somebody-elses-old-directory",
                ].sort(),
            );
            expect(await readdir(outside)).toEqual([]);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it("does not fail when the temporary folder cannot be read", async () => {
        await expect(removeStaleExportDirectories({ directory: join(temp, "missing") })).resolves.toEqual([]);
    });
});
