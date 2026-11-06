// LiTT training 1b (docs/training.md): the "documents-zip" export leaves a
// pasante's unapproved version out and names it in OMITIDOS.txt.

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setStorageAdapter } from "../../../lib/storage";
import type { DbJob } from "../../../lib/dbq/types";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";

vi.mock("../../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access")>()),
  ensureDocAccess: async () => ({ ok: true }),
}));

import { handleExportBuild } from "../user.exportJobs";

const HASH = "a".repeat(64);
const download = vi.fn<(key: string) => Promise<ArrayBuffer | null>>();
const upload = vi.fn<(key: string, bytes: ArrayBuffer, contentType: string) => Promise<void>>();
const job: DbJob = {
  id: "export-1", kind: "export.build",
  payload: { userId: "u1", type: "documents-zip", document_ids: ["d1", "d2"] },
  status: "running", attempts: 1, max_attempts: 3, run_at: "", claimed_at: null,
  finished_at: null, last_error: null, dedupe_key: null, result: null, created_at: "",
};

let tables: Record<string, Row[]>;

function versionRow(id: string, doc: string, filename: string, stage: string | null): Row {
  return {
    id, document_id: doc, storage_path: `${doc}.docx`, filename, version_number: 1,
    source: "upload", content_sha256: HASH, training_stage: stage, deleted_at: null,
  };
}

beforeEach(() => {
  tables = {
    documents: [
      { id: "d1", current_version_id: "v1", user_id: "u1", project_id: null },
      { id: "d2", current_version_id: "v2", user_id: "u1", project_id: null },
    ],
    document_versions: [
      versionRow("v1", "d1", "Contrato.docx", null),
      versionRow("v2", "d2", "Demanda borrador.docx", "pasante"),
    ],
    training_version_approvals: [],
  };
  download.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  upload.mockReset().mockResolvedValue(undefined);
  setStorageAdapter({ enabled: true, configurationHint: "test", downloadFile: download, uploadFile: upload } as never);
});

async function exportedZip() {
  await handleExportBuild(memoryDb(tables).db, job);
  expect(upload).toHaveBeenCalledOnce();
  return JSZip.loadAsync(upload.mock.calls[0]![1]);
}

describe("documents-zip export of a pasante's draft", () => {
  it("leaves the unapproved draft out and lists it in OMITIDOS.txt", async () => {
    const zip = await exportedZip();
    expect(Object.keys(zip.files).sort()).toEqual(["Contrato.docx", "OMITIDOS.txt"]);
    const list = await zip.file("OMITIDOS.txt")!.async("string");
    expect(list).toContain("- Demanda borrador.docx: borrador de pasante pendiente de aprobación.");
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("d1.docx");
  });

  it("includes the draft approved for its current bytes", async () => {
    tables.training_version_approvals.push({ id: "a", document_version_id: "v2", content_sha256: HASH });
    const zip = await exportedZip();
    expect(Object.keys(zip.files).sort()).toEqual(["Contrato.docx", "Demanda borrador.docx"]);
  });

  it("leaves it out again once the approved bytes change", async () => {
    tables.training_version_approvals.push({ id: "a", document_version_id: "v2", content_sha256: HASH });
    tables.document_versions[1].content_sha256 = "b".repeat(64);
    const zip = await exportedZip();
    expect(Object.keys(zip.files).sort()).toEqual(["Contrato.docx", "OMITIDOS.txt"]);
  });

  it("still publishes the list when every selected document is held", async () => {
    tables.document_versions[0].training_stage = "pasante";
    const zip = await exportedZip();
    expect(Object.keys(zip.files)).toEqual(["OMITIDOS.txt"]);
    expect(download).not.toHaveBeenCalled();
  });
});
