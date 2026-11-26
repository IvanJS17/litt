// An upload session names a destination when it is opened. Every later step
// that turns the session into bytes or rows asks again whether its owner may
// write there NOW: completing a file, re-signing its upload URL, and the worker
// right before it writes the document, the new version or the replacement. The
// verdicts here are the real ones (lib/access.ts over an in-memory database);
// only storage and the documents facade are stand-ins.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headFile: vi.fn(),
  copyFile: vi.fn(),
  deleteFile: vi.fn(),
  getSignedUploadUrl: vi.fn(),
  createFileReadStream: vi.fn(),
  uploadFileFromPath: vi.fn(),
  createDocumentVersion: vi.fn(),
  updateDocumentVersion: vi.fn(),
  queueScanReadingOnUpload: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  headFile: mocks.headFile,
  copyFile: mocks.copyFile,
  deleteFile: mocks.deleteFile,
  deleteFileBestEffort: (key: string) =>
    Promise.resolve(mocks.deleteFile(key)).catch(() => undefined),
  deleteFilesBestEffort: async (keys: Array<string | null | undefined>) => {
    for (const key of keys.filter(Boolean)) mocks.deleteFile(key);
  },
  getSignedUploadUrl: mocks.getSignedUploadUrl,
  createFileReadStream: mocks.createFileReadStream,
  uploadFileFromPath: mocks.uploadFileFromPath,
}));
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("../../documents/documents.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../documents/documents.service")>()),
  createDocumentVersion: mocks.createDocumentVersion,
  updateDocumentVersion: mocks.updateDocumentVersion,
  queueScanReadingOnUpload: mocks.queueScanReadingOnUpload,
}));

import { ownerlessRpcResult } from "../../../__tests__/helpers/ownerlessRpc";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import type { Db } from "../../../lib/supabase";
import { processUploadFile } from "../uploads.processing";
import { completeUploadSessionFile, refreshUploadUrls } from "../uploads.sessions";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const ALICE = id(10);
const COLLEAGUE = id(11);
const PROJECT = id(100);
const MATTER_PROJECT = id(101);
const WORKFLOW = id(110);
const DOCUMENT = id(120);
const MATTER_DOCUMENT = id(121);
const VERSION = id(130);
const SESSION = id(200);
const FILE = id(201);
const RESOURCE = id(202);
/** The smallest PDF pdf.js opens: one empty page. */
function onePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}
const pdfBytes = onePagePdf();

type Row = Record<string, unknown>;

function world() {
  const tables: Record<string, Row[]> = {
    organizations: [{ id: ORG, kind: "team" }],
    org_members: [
      { org_id: ORG, user_id: ALICE, role: "member" },
      { org_id: ORG, user_id: COLLEAGUE, role: "member" },
    ],
    projects: [
      { id: PROJECT, user_id: COLLEAGUE, org_id: ORG, visibility: "organization", archived_at: null },
      { id: MATTER_PROJECT, user_id: COLLEAGUE, org_id: ORG, visibility: "organization", archived_at: null },
    ],
    workflows: [
      {
        id: WORKFLOW, user_id: COLLEAGUE, org_id: ORG, visibility: "organization",
        type: "assistant", archived_at: null,
      },
    ],
    documents: [
      {
        id: DOCUMENT, user_id: ALICE, project_id: PROJECT, org_id: ORG, workflow_id: null,
        current_version_id: VERSION, archived_at: null,
      },
      {
        id: MATTER_DOCUMENT, user_id: ALICE, project_id: MATTER_PROJECT, org_id: ORG, workflow_id: null,
        current_version_id: VERSION, archived_at: null,
      },
    ],
    document_versions: [
      {
        id: VERSION, document_id: DOCUMENT, file_type: "pdf", deleted_at: null,
        storage_path: "current/path.pdf", pdf_storage_path: null, content_sha256: null,
      },
    ],
    matters: [{ id: id(900), project_id: MATTER_PROJECT, workspace_id: id(901), visibility: "private" }],
    workspaces: [{ id: id(901), organization_id: ORG }],
    matter_memberships: [{ matter_id: id(900), user_id: ALICE, status: "active" }],
    project_org_access_overrides: [],
    workflow_org_access_overrides: [],
    upload_sessions: [],
    upload_session_files: [],
  };
  const { db, calls } = tableDb(tables, { maxInList: 100 });
  const rpcCalls: string[] = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push(name);
    if (name === "queue_upload_session_file_processing") return { data: "job-1", error: null };
    return ownerlessRpcResult(tables, name, args) ?? { data: null, error: null };
  };
  return { tables, calls, rpcCalls, db: { from: db.from, rpc } as unknown as Db };
}

/** What can be taken from the owner after the session was opened. */
type Loss = {
  name: string;
  /** The answer the same refusal would have been at creation. */
  status: number;
  apply: (tables: Record<string, Row[]>, kind: Kind) => void;
};
const leaveOrganization: Loss = {
  name: "removed from the organization",
  status: 404,
  apply: (tables) => {
    tables.org_members = tables.org_members.filter((member) => member.user_id !== ALICE);
  },
};
const roleBelowEdit = (override: string): Loss => ({
  name: "role lowered below edit",
  status: 403,
  apply: (tables, kind) => {
    const table = kind.container === "workflow" ? "workflow_org_access_overrides" : "project_org_access_overrides";
    tables[table].push({
      [kind.container === "workflow" ? "workflow_id" : "project_id"]: kind.containerId,
      org_id: ORG, user_id: ALICE, role: override,
    });
  },
});
const leaveMatter: Loss = {
  name: "removed from the private matter",
  status: 404,
  apply: (tables) => {
    for (const row of tables.matter_memberships) if (row.user_id === ALICE) row.status = "revoked";
  },
};

type Kind = {
  name: string;
  purpose: string;
  destination: Record<string, unknown>;
  container: "project" | "workflow" | "own";
  containerId: string;
  losses: Loss[];
};
const KINDS: Kind[] = [
  {
    name: "project (create)", purpose: "document_create", container: "project", containerId: PROJECT,
    destination: { scope: "project", project_id: PROJECT },
    losses: [leaveOrganization, roleBelowEdit("viewer")],
  },
  {
    name: "private matter project (create)", purpose: "document_create", container: "project",
    containerId: MATTER_PROJECT,
    destination: { scope: "project", project_id: MATTER_PROJECT },
    losses: [leaveMatter, leaveOrganization],
  },
  {
    name: "workflow (create)", purpose: "document_create", container: "workflow", containerId: WORKFLOW,
    destination: { scope: "workflow", workflow_id: WORKFLOW },
    losses: [leaveOrganization, roleBelowEdit("viewer")],
  },
  {
    name: "new version of a document", purpose: "document_version_create", container: "project",
    containerId: PROJECT, destination: { document_id: DOCUMENT },
    losses: [leaveOrganization, roleBelowEdit("viewer")],
  },
  {
    name: "new version of a private matter document", purpose: "document_version_create",
    container: "project", containerId: MATTER_PROJECT, destination: { document_id: MATTER_DOCUMENT },
    losses: [leaveMatter],
  },
  {
    name: "replacement of a version", purpose: "document_version_replace", container: "project",
    containerId: PROJECT, destination: { document_id: DOCUMENT, version_id: VERSION },
    losses: [leaveOrganization, roleBelowEdit("viewer")],
  },
  {
    name: "own space in the organization", purpose: "document_create", container: "own", containerId: ORG,
    destination: { scope: "standalone", org_id: ORG },
    losses: [{ ...leaveOrganization, status: 400 }],
  },
];

const cases = KINDS.flatMap((kind) => kind.losses.map((loss) => ({ kind, loss })));

function openSession(w: ReturnType<typeof world>, kind: Kind, fileStatus = "pending_upload") {
  w.tables.upload_sessions.push({
    id: SESSION, user_id: ALICE, user_email: "alice@example.test", purpose: kind.purpose,
    destination: kind.destination, status: "pending_upload",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  w.tables.upload_session_files.push({
    id: FILE, session_id: SESSION, resource_id: kind.purpose === "document_create" ? RESOURCE : id(203),
    client_id: "c1", filename: "contract.pdf", target_folder_id: null, file_type: "pdf",
    content_type: "application/pdf", expected_size_bytes: pdfBytes.length,
    staging_storage_path: "staging/c1", sealed_storage_path: "sealed/c1",
    status: fileStatus, error_code: null, document_created_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

const workerSession = (kind: Kind) => ({
  id: SESSION, user_id: ALICE, user_email: "alice@example.test",
  purpose: kind.purpose as never, destination: kind.destination, status: "processing",
});
const workerFile = (kind: Kind) => ({
  id: FILE, session_id: SESSION, resource_id: kind.purpose === "document_create" ? RESOURCE : id(203),
  client_id: "c1", filename: "contract.pdf", file_type: "pdf", content_type: "application/pdf",
  expected_size_bytes: pdfBytes.length, sealed_storage_path: "sealed/c1", target_folder_id: null,
  status: "uploaded", error_code: null, document_created_at: null as string | null,
});

let tempRoot: string;
beforeEach(async () => {
  vi.clearAllMocks();
  tempRoot = await mkdtemp(join(tmpdir(), "mike-upload-gate-"));
  process.env.UPLOAD_PROCESSING_TEMP_DIR = tempRoot;
  mocks.headFile.mockResolvedValue({ size: pdfBytes.length, etag: "etag" });
  mocks.copyFile.mockResolvedValue({ size: pdfBytes.length, etag: "etag" });
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.getSignedUploadUrl.mockResolvedValue("https://storage.test/put");
  mocks.createFileReadStream.mockImplementation(() => Readable.from([pdfBytes]));
  mocks.uploadFileFromPath.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.queueScanReadingOnUpload.mockResolvedValue(undefined);
  mocks.createDocumentVersion.mockImplementation(async (_db: unknown, version: Row) => ({
    data: { ...version, version_number: 1, created_at: new Date().toISOString() }, error: null,
  }));
  mocks.updateDocumentVersion.mockResolvedValue({
    data: { id: VERSION, version_number: 1, source: "upload", created_at: "t", filename: "contract.pdf", file_type: "pdf", size_bytes: pdfBytes.length, page_count: null, textless_page_count: null },
    error: null,
  });
});
afterEach(async () => {
  expect(await readdir(tempRoot)).toEqual([]);
  await rm(tempRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_PROCESSING_TEMP_DIR;
});

describe("an upload session checks its destination each time it is used", () => {
  describe.each(cases)("$kind.name, owner $loss.name", ({ kind, loss }) => {
    it("refuses to complete a file, with the answer opening the session would give, and queues nothing", async () => {
      const w = world();
      openSession(w, kind);
      loss.apply(w.tables, kind);

      const result = await completeUploadSessionFile(w.db, {
        sessionId: SESSION, fileId: FILE, userId: ALICE, failed: false,
      });

      expect(result).toMatchObject({ ok: false, kind: "http", status: loss.status });
      expect(w.rpcCalls).not.toContain("queue_upload_session_file_processing");
      expect(mocks.headFile).not.toHaveBeenCalled();
      expect(mocks.copyFile).not.toHaveBeenCalled();
      expect(w.tables.upload_session_files[0].status).toBe("pending_upload");
    });

    it("refuses to sign new upload URLs", async () => {
      const w = world();
      openSession(w, kind);
      loss.apply(w.tables, kind);

      const result = await refreshUploadUrls(w.db, SESSION, ALICE);

      expect(result).toMatchObject({ ok: false, kind: "http", status: loss.status });
      expect(mocks.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("fails the job without writing a document, a version or replacement bytes", async () => {
      const w = world();
      openSession(w, kind, "uploaded");
      loss.apply(w.tables, kind);
      const documentsBefore = JSON.stringify(w.tables.documents);
      const versionsBefore = JSON.stringify(w.tables.document_versions);

      await expect(
        processUploadFile(w.db, workerSession(kind), workerFile(kind)),
      ).rejects.toMatchObject({ message: "upload_destination_unavailable" });

      expect(JSON.stringify(w.tables.documents)).toBe(documentsBefore);
      expect(JSON.stringify(w.tables.document_versions)).toBe(versionsBefore);
      expect(mocks.copyFile).not.toHaveBeenCalled();
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
    });
  });

  describe.each(KINDS)("$name, owner who kept access", (kind) => {
    it("completes the file and queues it", async () => {
      const w = world();
      openSession(w, kind);

      const result = await completeUploadSessionFile(w.db, {
        sessionId: SESSION, fileId: FILE, userId: ALICE, failed: false,
      });

      expect(result).toMatchObject({ ok: true });
      expect(w.rpcCalls).toContain("queue_upload_session_file_processing");
    });

    it("signs new upload URLs", async () => {
      const w = world();
      openSession(w, kind);

      const result = await refreshUploadUrls(w.db, SESSION, ALICE);

      expect(result).toMatchObject({ ok: true });
      expect(mocks.getSignedUploadUrl).toHaveBeenCalledTimes(1);
    });

    it("writes the document, version or replacement", async () => {
      const w = world();
      openSession(w, kind, "uploaded");

      await processUploadFile(w.db, workerSession(kind), workerFile(kind));

      if (kind.purpose === "document_version_replace")
        expect(mocks.updateDocumentVersion).toHaveBeenCalledTimes(1);
      else expect(mocks.createDocumentVersion).toHaveBeenCalledTimes(1);
      expect(mocks.copyFile).toHaveBeenCalledTimes(1);
    });
  });

  it("lets a person who lost access report a failed transfer, which only cleans up", async () => {
    const w = world();
    openSession(w, KINDS[0]);
    leaveOrganization.apply(w.tables, KINDS[0]);

    const result = await completeUploadSessionFile(w.db, {
      sessionId: SESSION, fileId: FILE, userId: ALICE, failed: true,
    });

    expect(result).toMatchObject({ ok: true });
    expect(w.tables.upload_session_files[0].status).toBe("error");
  });

  it.each([KINDS[0], KINDS[3], KINDS[5]])(
    "checks again right before the write, after a copy during which access was lost: $name",
    async (kind) => {
      const w = world();
      openSession(w, kind, "uploaded");
      // Access is lost while the file is being copied and converted.
      mocks.copyFile.mockImplementation(async () => {
        leaveOrganization.apply(w.tables, kind);
        return { size: pdfBytes.length, etag: "etag" };
      });

      await expect(
        processUploadFile(w.db, workerSession(kind), workerFile(kind)),
      ).rejects.toMatchObject({ message: "upload_destination_unavailable" });

      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
    },
  );
});

describe("an upload for an account that is being erased", () => {
  const requested = { user_id: ALICE, account_deletion_requested_at: "2026-11-25T10:00:00Z" };

  it.each(KINDS)("writes nothing, however the session began: $name", async (kind) => {
    const w = world();
    openSession(w, kind, "uploaded");
    w.tables.user_profiles = [requested];
    const documentsBefore = JSON.stringify(w.tables.documents);

    await expect(
      processUploadFile(w.db, workerSession(kind), workerFile(kind)),
    ).rejects.toMatchObject({ message: "upload_destination_unavailable" });

    expect(JSON.stringify(w.tables.documents)).toBe(documentsBefore);
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
    expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
  });

  it("removes the document row it created when the erasure was requested while it wrote it", async () => {
    const w = world();
    openSession(w, KINDS[0], "uploaded");
    w.tables.user_profiles = [{ user_id: ALICE, account_deletion_requested_at: null }];
    const from = w.db.from.bind(w.db);
    // The request lands between the check that opened the job and the row.
    (w.db as { from: unknown }).from = (table: string) => {
      const query = from(table) as { upsert: (...args: unknown[]) => unknown };
      if (table !== "documents") return query;
      const upsert = query.upsert.bind(query);
      query.upsert = (...args: unknown[]) => {
        const result = upsert(...args);
        w.tables.user_profiles = [requested];
        return result;
      };
      return query;
    };

    await expect(
      processUploadFile(w.db, workerSession(KINDS[0]), workerFile(KINDS[0])),
    ).rejects.toMatchObject({ message: "upload_destination_unavailable" });

    expect(w.tables.documents.some((row) => row.id === RESOURCE)).toBe(false);
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });
});
