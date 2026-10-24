/**
 * Storage port for approved artifacts, built on the `lib/storage.ts` facade.
 *
 * Approved artifacts need two behaviors the mutable-document helpers do not
 * have: a create-only write and a read that never turns a dependency failure
 * into "not stored". The facade exposes `headFile` (throws on a real store
 * error, `null` only when the object or the store is absent) and `uploadFile`,
 * which is enough to build both without reaching past the facade:
 *
 * - create-only: HEAD first, upload only when absent. Keys are content
 *   addressed (`…/<sha256>.docx`), so losing a create race writes identical
 *   bytes; the caller verifies the stored hash afterwards either way.
 * - strict read: a `null` from `downloadFile` is only "absent" when HEAD also
 *   finds nothing. A HEAD that throws (store down, credentials rejected) is
 *   rethrown, so an outage is a 500 and never a false 404.
 *
 * LiTT kept these two helpers inside `lib/storage.ts`; with the upstream
 * facade they live here until the documents lane decides whether to move them
 * back into the kernel.
 */

import { downloadFile, headFile, uploadFile } from "../../lib/storage";
import type { ApprovedArtifactStorage } from "../../lib/recovery/persistence/approvedArtifactPersistence";

export function createApprovedArtifactStorage(): ApprovedArtifactStorage {
  return {
    async putIfAbsent(key, bytes, mimeType) {
      const existing = await headFile(key);
      if (existing) return "exists";
      const body = bytes.slice().buffer;
      await uploadFile(key, body, mimeType);
      return "created";
    },

    async getStrict(key) {
      const downloaded = await downloadFile(key);
      if (downloaded) return new Uint8Array(downloaded);
      // `downloadFile` folds "absent" and "failed" into `null`; HEAD tells
      // them apart and throws for the second one.
      const existing = await headFile(key);
      if (!existing) return null;
      throw new Error("Artifact storage read failed");
    },
  };
}
