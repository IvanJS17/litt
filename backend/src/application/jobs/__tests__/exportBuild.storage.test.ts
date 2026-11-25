import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { setStorageAdapter, StorageOperationError } from "../../../lib/storage";
import type { DbJob } from "../../../lib/dbq/types";
import { createExportStorageFake } from "../../exports/__tests__/exportStorageFake";

vi.mock("../../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access")>()),
  createDocumentAccessChecker: () => async () => ({ ok: true }),
}));
vi.mock("../../../lib/documentVersions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/documentVersions")>()),
  attachActiveVersionPaths: async (_db: unknown, docs: Array<Record<string, unknown>>) => {
    for (const doc of docs) Object.assign(doc, { storage_path: `${doc.id}.docx`, filename: `${doc.id}.docx`, active_version_number: 1, source: "upload", training_stage: null, content_sha256: null });
    return docs;
  },
}));
import { handleExportBuild } from "../exportBuild";

let fake = createExportStorageFake(() => new Uint8Array([1, 2, 3]));
const job: DbJob = {
  id: "export-1", kind: "export.build",
  payload: { userId: "u1", type: "documents-zip", document_ids: ["d1", "d2"] },
  status: "running", attempts: 1, max_attempts: 3, run_at: "", claimed_at: null,
  finished_at: null, last_error: null, dedupe_key: null, result: null, created_at: "",
};
const db = {
  from: () => ({ select: () => ({ in: async () => ({ data: ["d1", "d2"].map(id => ({ id, user_id: "u1", project_id: null, current_version_id: `${id}-v1` })), error: null }) }) }),
};

beforeEach(() => {
  fake = createExportStorageFake(() => new Uint8Array([1, 2, 3]));
  setStorageAdapter(fake.adapter());
});

describe("required document export reads", () => {
  it.each(["ECONNRESET", "AccessDenied"])("fails before publishing a partial ZIP when a selected document read fails with %s", async code => {
    let reads = 0;
    fake = createExportStorageFake(() => {
      if (++reads === 3) throw Object.assign(new Error("storage failure"), { code });
      return new Uint8Array([1]);
    });
    setStorageAdapter(fake.adapter());
    await expect(handleExportBuild(db as never, job)).rejects.toBeInstanceOf(StorageOperationError);
    expect(fake.uploads).toEqual([]);
  });

  it("publishes both selected files when their reads succeed", async () => {
    await expect(handleExportBuild(db as never, job)).resolves.toMatchObject({ filename: "documents.zip" });
    expect(fake.uploads).toHaveLength(1);
    const zip = await JSZip.loadAsync(fake.uploads[0]!.bytes);
    expect(Object.keys(zip.files)).toEqual(["d1.docx", "d2.docx"]);
  });
});
