// A document row created by an upload job belongs to whoever owns it NOW. The
// job creates the row only if it is absent and afterwards updates just the
// fields it owns (its status) by id, so a retry never rewrites the owner or the
// placement that a departure, a transfer, an archive or a move has since set.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyFile: vi.fn(),
  createFileReadStream: vi.fn(),
  createDocumentVersion: vi.fn(),
}));

vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  copyFile: mocks.copyFile,
  createFileReadStream: mocks.createFileReadStream,
  deleteFile: vi.fn(),
  uploadFileFromPath: vi.fn(),
}));
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("../uploads.access", () => ({
  sessionDestinationWritable: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../documents/documents.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../documents/documents.service")>()),
  createDocumentVersion: mocks.createDocumentVersion,
  queueScanReadingOnUpload: vi.fn(),
}));

import { tableDb } from "../../../__tests__/helpers/tableDb";
import { syntheticPdf } from "../../../lib/__tests__/pdfFixtures";
import type { Db } from "../../../lib/supabase";
import { processUploadFile } from "../uploads.processing";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const UPLOADER = id(10);
const SUCCESSOR = id(11);
const PROJECT = id(100);
const OTHER_PROJECT = id(101);
const FOLDER = id(150);
const DOCUMENT = id(202);
let pdfBytes: Buffer;

type Row = Record<string, unknown>;

/**
 * An in-memory database whose `upsert(..., { ignoreDuplicates: true })` does
 * what PostgREST does for it: ON CONFLICT DO NOTHING.
 */
function database(documents: Row[]) {
  const tables: Record<string, Row[]> = { documents, upload_session_files: [], projects: [{ id: PROJECT, org_id: ORG }] };
  const { db } = tableDb(tables);
  const from = (table: string) => {
    const builder = db.from(table) as unknown as {
      upsert: (value: Row, options?: { ignoreDuplicates?: boolean }) => unknown;
    };
    const upsert = builder.upsert.bind(builder);
    builder.upsert = (value, options) =>
      options?.ignoreDuplicates && tables[table].some((row) => row.id === value.id)
        ? { then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }
        : upsert(value, options);
    return builder;
  };
  const auth = {
    admin: {
      getUserById: async () => ({
        data: { user: { email: "uploader@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
    },
  };
  return { tables, db: { from, rpc: vi.fn(), auth } as unknown as Db };
}

const session = {
  id: id(200), user_id: UPLOADER, user_email: "uploader@example.test",
  purpose: "document_create" as const,
  destination: { scope: "project", project_id: PROJECT }, status: "processing",
};
const uploadedFile = () => ({
  id: id(201), session_id: session.id, resource_id: DOCUMENT, client_id: "c1", filename: "contract.pdf",
  file_type: "pdf", content_type: "application/pdf", expected_size_bytes: pdfBytes.length,
  sealed_storage_path: "sealed/c1", target_folder_id: FOLDER, status: "uploaded", error_code: null,
  document_created_at: null as string | null,
});

let tempRoot: string;
beforeAll(async () => {
  pdfBytes = Buffer.from(await syntheticPdf([null]));
});
beforeEach(async () => {
  vi.clearAllMocks();
  tempRoot = await mkdtemp(join(tmpdir(), "mike-upload-retry-"));
  process.env.UPLOAD_PROCESSING_TEMP_DIR = tempRoot;
  mocks.copyFile.mockResolvedValue(undefined);
  mocks.createFileReadStream.mockImplementation(() => Readable.from([pdfBytes]));
  mocks.createDocumentVersion.mockImplementation(async (_db: unknown, version: Row) => ({
    data: { ...version, version_number: 1 }, error: null,
  }));
});
afterEach(async () => {
  expect(await readdir(tempRoot)).toEqual([]);
  await rm(tempRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_PROCESSING_TEMP_DIR;
});

describe("a retried upload job and the document row an earlier attempt created", () => {
  it.each<[string, Row]>([
    ["the creator was cleared and the document archived", { user_id: null, archived_at: "2026-11-01T00:00:00Z" }],
    ["the document was transferred to a successor", { user_id: SUCCESSOR }],
    ["the document was moved to another project and folder", { project_id: OTHER_PROJECT, folder_id: null, user_id: SUCCESSOR }],
  ])("leaves ownership and placement as they are when %s", async (_name, changes) => {
    const created: Row = {
      id: DOCUMENT, user_id: UPLOADER, org_id: ORG, project_id: PROJECT, folder_id: FOLDER,
      library_kind: "file", library_folder_id: null, workflow_id: null, status: "processing",
      archived_at: null,
    };
    const changed = { ...created, ...changes };
    const { tables, db } = database([{ ...changed }]);

    await processUploadFile(db, session, { ...uploadedFile(), document_created_at: "2026-11-01T00:00:00Z" });

    const row = tables.documents[0];
    for (const column of ["user_id", "org_id", "project_id", "folder_id", "library_folder_id", "workflow_id", "archived_at"])
      expect(row[column], column).toEqual(changed[column]);
    expect(row.status).toBe("ready");
    expect(tables.documents).toHaveLength(1);
  });

  it("finishes a document whose creator was cleared while the first attempt was converting it", async () => {
    const { tables, db } = database([]);
    mocks.createDocumentVersion.mockImplementationOnce(async (_db: unknown, version: Row) => {
      // The departure commits between the version and the final status update.
      tables.documents[0].user_id = null;
      return { data: { ...version, version_number: 1 }, error: null };
    });

    await processUploadFile(db, session, uploadedFile());

    expect(tables.documents).toHaveLength(1);
    expect(tables.documents[0]).toMatchObject({ user_id: null, status: "ready" });
  });

  it("still creates the row, for the uploader, when none exists yet", async () => {
    const { tables, db } = database([]);

    await processUploadFile(db, session, uploadedFile());

    expect(tables.documents[0]).toMatchObject({
      id: DOCUMENT, user_id: UPLOADER, org_id: ORG, project_id: PROJECT, folder_id: FOLDER, status: "ready",
    });
  });
});
