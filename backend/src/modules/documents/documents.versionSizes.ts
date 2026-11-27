// Storage quota: fills in the recorded size of document versions that have none, by asking
// storage for the real size of each stored file. Until it runs, a version with
// no size counts as zero in the storage quota. It is run by hand at deploy time
// (`node dist/jobs/fillVersionSizes.js`), never automatically, and changes
// nothing unless asked to write: it only sets a size that is still empty, and
// deletes and changes nothing else.

import { headFile } from "../../lib/storage";
import type { Db } from "../../lib/supabase";

export type FillCounts = {
  /** Versions with a stored file and no recorded size. */
  found: number;
  /** Of those, the ones whose object exists and whose size could be read. */
  wouldFill: number;
  /** Sizes written (always 0 unless asked to write). */
  filled: number;
  /** Versions whose object does not exist in storage. */
  missing: number;
  /** Versions whose object could not be read now (storage failed). */
  failed: number;
};

// document_versions.size_bytes is a 32-bit integer; no stored file comes near it.
const MAX_SIZE_BYTES = 2_147_483_647;

export async function fillMissingVersionSizes(
  db: Db,
  options: {
    write: boolean;
    batchSize?: number;
    log?: (line: string) => void;
  },
): Promise<FillCounts> {
  const log = options.log ?? console.log;
  const batchSize = options.batchSize ?? 500;
  const counts: FillCounts = { found: 0, wouldFill: 0, filled: 0, missing: 0, failed: 0 };
  let after = "";

  for (;;) {
    // Keyset pages by id: a row written in this run stops matching, and the
    // page after it is found by position, so a rerun and a retry are safe.
    const { data, error } = await db
      .from("document_versions")
      .select("id, storage_path")
      .is("size_bytes", null)
      .not("storage_path", "is", null)
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(batchSize);
    if (error) throw new Error("Failed to read document versions without a size", { cause: error });
    const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      counts.found += 1;
      let size: number | null;
      try {
        size = (await headFile(row.storage_path))?.size ?? null;
      } catch {
        counts.failed += 1;
        continue;
      }
      if (size === null) {
        counts.missing += 1;
        continue;
      }
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SIZE_BYTES) {
        counts.failed += 1;
        continue;
      }
      counts.wouldFill += 1;
      if (!options.write) continue;
      const { error: updateError } = await db
        .from("document_versions")
        .update({ size_bytes: size })
        .eq("id", row.id)
        .is("size_bytes", null);
      if (updateError) {
        counts.wouldFill -= 1;
        counts.failed += 1;
      } else counts.filled += 1;
    }
    after = rows[rows.length - 1].id;
  }

  log(
    `${options.write ? "Write run" : "Dry run (nothing was changed; pass --write to fill the sizes)"}: ` +
      `found ${counts.found} versions without a size; ` +
      `${options.write ? `filled ${counts.filled}` : `${counts.wouldFill} can be filled`}; ` +
      `object missing ${counts.missing}; could not read ${counts.failed}.`,
  );
  return counts;
}
