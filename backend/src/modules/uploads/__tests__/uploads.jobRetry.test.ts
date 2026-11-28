// The upload worker acts on its session owner's authority, and a job may run
// more than once. Three rules are held here, end to end through
// `processUploadJob` with the real access verdicts:
//   - a refusal never hands storage cleanup bytes a stored version points at;
//   - a failed read is retried, a real refusal ends the upload;
//   - the cleanup of a failed created document goes by the document's id.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  enqueueStorageCleanup: vi.fn(),
  realEnqueueStorageCleanup: undefined as unknown as (...args: unknown[]) => Promise<void>,
}));

vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  headFile: mocks.headFile,
  copyFile: mocks.copyFile,
  deleteFile: mocks.deleteFile,
  deleteFileBestEffort: (key: string) => Promise.resolve(mocks.deleteFile(key)).catch(() => undefined),
  deleteFilesBestEffort: async (keys: Array<string | null | undefined>) => {
    for (const key of keys.filter(Boolean)) mocks.deleteFile(key);
  },
  getSignedUploadUrl: mocks.getSignedUploadUrl,
  createFileReadStream: mocks.createFileReadStream,
  uploadFileFromPath: mocks.uploadFileFromPath,
  assertStorageConfigured: () => undefined,
  listFiles: async () => [],
}));
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
// The cleanup is the real one, queued into the fake `db_jobs` table and run by
// the real handler: what a refusal leaves behind is judged by what that job
// finally deletes.
vi.mock("../../../lib/dbq/enqueue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/dbq/enqueue")>();
  mocks.realEnqueueStorageCleanup = actual.enqueueStorageCleanup as never;
  return {
    ...actual,
    enqueueStorageCleanup: mocks.enqueueStorageCleanup,
    requestDocumentCleanupDelivery: vi.fn(async () => 0),
  };
});
vi.mock("../../documents/documents.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../documents/documents.service")>()),
  createDocumentVersion: mocks.createDocumentVersion,
  updateDocumentVersion: mocks.updateDocumentVersion,
  queueScanReadingOnUpload: mocks.queueScanReadingOnUpload,
}));

import { ownerlessRpcResult } from "../../../__tests__/helpers/ownerlessRpc";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import { syntheticPdf } from "../../../lib/__tests__/pdfFixtures";
import type { Db } from "../../../lib/supabase";
import { handleStorageCleanup } from "../../../lib/dbq/storageCleanup";
import { cleanupUploadSessions, processUploadJob, UPLOAD_JOB_LEASE_SECONDS, UPLOAD_JOB_MAX_ATTEMPTS } from "../uploads.processing";
import { completeUploadSessionFile, refreshUploadUrls } from "../uploads.sessions";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const ALICE = id(10);
const COLLEAGUE = id(11);
const PROJECT = id(100);
const WORKFLOW = id(110);
const DOCUMENT = id(120);
const VERSION = id(130);
const SESSION = id(200);
const FILE = id(201);
const RESOURCE = id(202);
const VRESOURCE = id(203);

type Row = Record<string, unknown>;
let pdfBytes: Buffer;

function world() {
  const tables: Record<string, Row[]> = {
    organizations: [{ id: ORG, kind: "team" }],
    org_members: [
      { org_id: ORG, user_id: ALICE, role: "member" },
      { org_id: ORG, user_id: COLLEAGUE, role: "member" },
    ],
    projects: [{ id: PROJECT, user_id: COLLEAGUE, org_id: ORG, visibility: "organization", archived_at: null }],
    workflows: [{ id: WORKFLOW, user_id: COLLEAGUE, org_id: ORG, visibility: "organization", type: "assistant", archived_at: null }],
    documents: [
      { id: DOCUMENT, user_id: ALICE, project_id: PROJECT, org_id: ORG, workflow_id: null, current_version_id: VERSION, archived_at: null },
    ],
    document_versions: [
      { id: VERSION, document_id: DOCUMENT, file_type: "pdf", deleted_at: null, storage_path: "current/path.pdf", pdf_storage_path: "current/path.pdf", content_sha256: null, version_number: 1 },
    ],
    matters: [],
    project_org_access_overrides: [],
    workflow_org_access_overrides: [],
    upload_sessions: [],
    upload_session_files: [],
    upload_processing_jobs: [],
    db_jobs: [],
  };
  const { db } = tableDb(tables, { maxInList: 100 });
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    if (name === "queue_upload_session_file_processing") return { data: "job-1", error: null };
    return ownerlessRpcResult(tables, name, args) ?? { data: null, error: null };
  };
  // tableDb merges on upsert and returns nothing from a delete; PostgREST does
  // nothing on an ignored duplicate and hands back the removed row.
  const from = (table: string) => {
    const builder = db.from(table) as unknown as Record<string, any>;
    const upsert = builder.upsert.bind(builder);
    builder.upsert = (value: Row, options?: { ignoreDuplicates?: boolean }) =>
      options?.ignoreDuplicates && tables[table].some((row) => row.id === value.id)
        ? { then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }
        : upsert(value, options);
    const del = builder.delete.bind(builder);
    builder.delete = () => {
      const before = [...tables[table]];
      del();
      const ms = builder.maybeSingle.bind(builder);
      builder.maybeSingle = async () => {
        const r = await ms();
        return { ...r, data: before.filter((row) => !tables[table].includes(row))[0] ?? null };
      };
      return builder;
    };
    return builder;
  };
  // The address the account has now, as the auth service answers it.
  const auth = {
    admin: {
      getUserById: async () => ({
        data: { user: { email: "alice@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
    },
  };
  return { tables, db: { from, rpc, auth } as unknown as Db };
}
type World = ReturnType<typeof world>;

type Kind = { purpose: string; destination: Row; resource: string };
const KINDS: Record<string, Kind> = {
  create: { purpose: "document_create", destination: { scope: "project", project_id: PROJECT }, resource: RESOURCE },
  createInWorkflow: { purpose: "document_create", destination: { scope: "workflow", workflow_id: WORKFLOW }, resource: RESOURCE },
  newVersion: { purpose: "document_version_create", destination: { document_id: DOCUMENT }, resource: VRESOURCE },
  replace: { purpose: "document_version_replace", destination: { document_id: DOCUMENT, version_id: VERSION }, resource: VRESOURCE },
};

const removeFromOrg = (t: Record<string, Row[]>) => {
  t.org_members = t.org_members.filter((m) => m.user_id !== ALICE);
};

function openSession(w: World, kind: Kind, fileStatus = "uploaded") {
  w.tables.upload_sessions.push({
    id: SESSION, user_id: ALICE, user_email: "alice@example.test", purpose: kind.purpose,
    destination: kind.destination, status: "pending_upload",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  w.tables.upload_session_files.push({
    id: FILE, session_id: SESSION, resource_id: kind.resource, client_id: "c1", filename: "contract.pdf",
    target_folder_id: null, file_type: "pdf", content_type: "application/pdf", expected_size_bytes: pdfBytes.length,
    staging_storage_path: "staging/c1", sealed_storage_path: "sealed/c1", status: fileStatus, error_code: null,
    document_created_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

function claim(w: World, attempts: number) {
  w.tables.upload_processing_jobs = [
    { id: "job-1", session_id: SESSION, file_id: FILE, status: "running", locked_by: "w1", attempts },
  ];
}

// create_document_version as the database does it: idempotent on the id.
function versionRpc(w: World) {
  mocks.createDocumentVersion.mockImplementation(async (_db: unknown, version: Row) => {
    const doc = w.tables.documents.find((d) => d.id === version.document_id);
    if (!doc) return { data: null, error: { code: "P0002", message: "document_not_found" } };
    const existing = w.tables.document_versions.find((v) => v.id === version.id);
    if (existing) return { data: { ...existing }, error: null };
    const row: Row = { ...version, version_number: 2, created_at: new Date().toISOString(), deleted_at: null };
    delete row.authorship;
    w.tables.document_versions.push(row);
    doc.current_version_id = version.id;
    return { data: { ...row }, error: null };
  });
  mocks.updateDocumentVersion.mockImplementation(async (_db: unknown, documentId: string, versionId: string, patch: Row) => {
    const v = w.tables.document_versions.find((x) => x.id === versionId && x.document_id === documentId);
    if (!v) return { data: null, error: null };
    Object.assign(v, patch);
    return { data: { ...v }, error: null };
  });
}

/** Every key storage was told to delete, directly or through the cleanup queue. */
const removedKeys = () => [
  ...mocks.deleteFile.mock.calls.map((c) => c[0] as string),
  ...mocks.enqueueStorageCleanup.mock.calls.flatMap((c) => c[1] as string[]),
];

/** Run every queued `storage.cleanup` job with the real handler, as the runner would. */
async function runCleanupJobs(w: World) {
  for (const row of w.tables.db_jobs.filter((r) => r.kind === "storage.cleanup")) {
    await handleStorageCleanup(w.db, row as never);
  }
}

/** The worker that holds the job now is another one: this attempt's lease is gone. */
function stealLease(w: World) {
  Object.assign(w.tables.upload_processing_jobs[0], { locked_by: "w2", attempts: 2 });
}

/** The next claim of the same job, as the queue hands it out after a retry. */
function reclaim(w: World, attempts: number) {
  Object.assign(w.tables.upload_processing_jobs[0], { status: "running", locked_by: "w1", attempts });
}

/** Make the first read of `table` (or rpc `name`) fail, once. */
function failReadOnce(w: World, failing: string) {
  const base = w.db.from.bind(w.db);
  const baseRpc = w.db.rpc.bind(w.db);
  let failed = false;
  (w.db as any).from = (t: string) => {
    const b = base(t) as any;
    if (t === failing && !failed) {
      const fail = async () => {
        failed = true;
        return { data: null, error: { message: "transient failure" } };
      };
      b.maybeSingle = fail;
      b.single = fail;
      b.then = (res: any, rej: any) => fail().then(res, rej);
    }
    return b;
  };
  (w.db as any).rpc = async (name: string, args?: Record<string, unknown>) => {
    if (name === failing && !failed) {
      failed = true;
      return { data: null, error: { message: "transient failure" } };
    }
    return baseRpc(name, args as never);
  };
  return () => failed;
}

let tempRoot: string;
beforeAll(async () => {
  pdfBytes = Buffer.from(await syntheticPdf([null]));
});
beforeEach(async () => {
  vi.clearAllMocks();
  tempRoot = await mkdtemp(join(tmpdir(), "mike-upload-jobretry-"));
  process.env.UPLOAD_PROCESSING_TEMP_DIR = tempRoot;
  mocks.headFile.mockResolvedValue({ size: pdfBytes.length, etag: "etag" });
  mocks.copyFile.mockResolvedValue({ size: pdfBytes.length, etag: "etag" });
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.getSignedUploadUrl.mockResolvedValue("https://storage.test/put");
  mocks.createFileReadStream.mockImplementation(() => Readable.from([pdfBytes]));
  mocks.uploadFileFromPath.mockResolvedValue(undefined);
  mocks.queueScanReadingOnUpload.mockResolvedValue(undefined);
  mocks.enqueueStorageCleanup.mockImplementation((...args: unknown[]) => mocks.realEnqueueStorageCleanup(...args));
});
afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_PROCESSING_TEMP_DIR;
});

describe("a refusal on a retried job", () => {
  it.each(["newVersion", "replace", "create"])(
    "leaves the bytes of an already stored version alone (%s)",
    async (kindKey) => {
      const kind = KINDS[kindKey];
      const w = world();
      versionRpc(w);
      openSession(w, kind);
      claim(w, 1);
      // Attempt 1 stores the version, then fails in a retryable way.
      mocks.queueScanReadingOnUpload.mockRejectedValueOnce(new Error("transient failure after the commit"));
      await processUploadJob(w.db, "job-1", "w1");
      expect(w.tables.upload_processing_jobs[0].status).toBe("queued");

      // Attempt 2: the owner leaves the organization while the file is copied.
      reclaim(w, 2);
      mocks.deleteFile.mockClear();
      mocks.enqueueStorageCleanup.mockClear();
      mocks.copyFile.mockImplementation(async () => {
        removeFromOrg(w.tables);
        return { size: pdfBytes.length, etag: "e" };
      });
      await processUploadJob(w.db, "job-1", "w1");

      const documentId = kindKey === "create" ? RESOURCE : DOCUMENT;
      const document = w.tables.documents.find((d) => d.id === documentId);
      expect(document, "the document stays").toBeDefined();
      const stored = w.tables.document_versions.find((v) => v.id === document?.current_version_id);
      expect(stored, "the version stays").toBeDefined();
      expect(stored?.storage_path).not.toBe("current/path.pdf");
      // What the cleanup finally deletes, not what it was handed.
      mocks.deleteFile.mockClear();
      await runCleanupJobs(w);
      const deleted = mocks.deleteFile.mock.calls.map((c) => c[0]);
      expect(deleted).not.toContain(stored?.storage_path);
      expect(deleted).not.toContain(stored?.pdf_storage_path);
    },
  );

  it("still cleans the bytes this attempt wrote when no stored version uses them", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.newVersion);
    claim(w, 1);
    mocks.copyFile.mockImplementation(async () => {
      removeFromOrg(w.tables);
      return { size: pdfBytes.length, etag: "e" };
    });
    await processUploadJob(w.db, "job-1", "w1");

    expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION]);
    expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
    const cleaned = removedKeys();
    expect(cleaned.some((key) => key.includes(VRESOURCE.replace(/-/g, "")))).toBe(true);
    expect(w.tables.upload_session_files[0]).toMatchObject({ status: "error", error_code: "destination_unavailable" });
  });
});

describe("a refusal decided while an earlier attempt of the job is still finishing", () => {
  it("does not remove the bytes of a version the earlier attempt commits after the refusal", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.newVersion);
    claim(w, 1);
    // Attempt 1 has passed its checks and waits inside the version-creating call.
    const real = mocks.createDocumentVersion.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const atCall = new Promise<void>((resolve) => (reached = resolve));
    mocks.createDocumentVersion.mockImplementationOnce(async (db: unknown, version: Row) => {
      reached();
      await gate;
      return real(db, version);
    });
    const first = processUploadJob(w.db, "job-1", "w1").catch(() => undefined);
    await atCall;

    // The job is reclaimed; attempt 2 loses its authority during the copy.
    stealLease(w);
    mocks.copyFile.mockImplementation(async () => {
      removeFromOrg(w.tables);
      return { size: pdfBytes.length, etag: "e" };
    });
    await processUploadJob(w.db, "job-1", "w2");
    expect(w.tables.upload_session_files[0]).toMatchObject({ status: "error", error_code: "destination_unavailable" });

    // Attempt 1 commits after the refusal; then the queued cleanup runs.
    release();
    await first;
    const stored = w.tables.document_versions.find((v) => v.id === VRESOURCE);
    expect(stored, "the version was stored").toBeDefined();
    mocks.deleteFile.mockClear();
    await runCleanupJobs(w);

    expect(mocks.deleteFile.mock.calls.map((c) => c[0])).not.toContain(stored?.storage_path);
    expect(mocks.deleteFile.mock.calls.map((c) => c[0])).not.toContain(stored?.pdf_storage_path);
  });

  it.each(["newVersion", "replace"])(
    "removes the bytes of a refused first attempt that stored no version, once the cleanup runs (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      mocks.copyFile.mockImplementation(async () => {
        removeFromOrg(w.tables);
        return { size: pdfBytes.length, etag: "e" };
      });
      await processUploadJob(w.db, "job-1", "w1");
      expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION]);

      mocks.deleteFile.mockClear();
      await runCleanupJobs(w);

      const slug = KINDS[kindKey].resource.replace(/-/g, "");
      const removed = mocks.deleteFile.mock.calls.map((c) => c[0] as string);
      expect(removed.length).toBeGreaterThan(0);
      expect(removed.every((key) => key.includes(slug) || key.includes(RESOURCE))).toBe(true);
    },
  );

  it("queues that cleanup to run only after a running job would have been reclaimed", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.newVersion);
    claim(w, 1);
    mocks.copyFile.mockImplementation(async () => {
      removeFromOrg(w.tables);
      return { size: pdfBytes.length, etag: "e" };
    });
    const before = Date.now();
    await processUploadJob(w.db, "job-1", "w1");

    const [row] = w.tables.db_jobs;
    expect(row.payload).toMatchObject({ unlessUsedByVersion: true });
    expect(Date.parse(row.run_at as string) - before).toBeGreaterThanOrEqual(UPLOAD_JOB_LEASE_SECONDS * 1000);
  });
});

describe("an attempt that no longer holds its job", () => {
  it.each(["create", "newVersion", "replace"])(
    "stores nothing and queues no cleanup when the job was taken during the copy (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      mocks.copyFile.mockImplementation(async () => {
        stealLease(w);
        return { size: pdfBytes.length, etag: "e" };
      });

      await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow();

      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.enqueueStorageCleanup).not.toHaveBeenCalled();
      expect(mocks.deleteFile).not.toHaveBeenCalled();
      expect(w.tables.db_jobs).toEqual([]);
      expect(w.tables.upload_session_files[0].status).toBe("processing");
    },
  );

  it.each(["create", "newVersion", "replace"])(
    "stores nothing when the job is taken after its last check began (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      // The attempt is stuck in its second destination check, which started
      // while it still held the job; the job is taken meanwhile.
      const getUserById = (w.db as any).auth.admin.getUserById;
      let asked = 0;
      (w.db as any).auth.admin.getUserById = async (...args: unknown[]) => {
        if (++asked === 2) stealLease(w);
        return getUserById(...args);
      };

      await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow();

      expect(asked).toBe(2);
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.copyFile).toHaveBeenCalledTimes(1);
      expect(w.tables.db_jobs).toEqual([]);
      expect(mocks.deleteFile).not.toHaveBeenCalled();
    },
  );

  it("finishes an upload that is slow but still holds its job", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.newVersion);
    claim(w, 1);
    mocks.copyFile.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { size: pdfBytes.length, etag: "e" };
    });

    await processUploadJob(w.db, "job-1", "w1");

    expect(mocks.createDocumentVersion).toHaveBeenCalledTimes(1);
    expect(w.tables.upload_session_files[0].status).toBe("completed");
    expect(w.tables.db_jobs).toEqual([]);
    expect(mocks.deleteFile.mock.calls.map((c) => c[0])).toEqual(["sealed/c1"]);
  });

  it.each(["create", "newVersion", "replace"])(
    "does not copy anything when the job was taken before the copy (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      mocks.createFileReadStream.mockImplementationOnce(() => {
        stealLease(w);
        return Readable.from([pdfBytes]);
      });

      await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow();

      expect(mocks.copyFile).not.toHaveBeenCalled();
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.enqueueStorageCleanup).not.toHaveBeenCalled();
    },
  );
});

describe("a replacement whose job is taken while it compares hashes", () => {
  it("does not copy anything", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(pdfBytes).digest("hex");
    const kind = { ...KINDS.replace, destination: { document_id: DOCUMENT, version_id: VERSION, expected_content_sha256: expected } };
    const w = world();
    versionRpc(w);
    openSession(w, kind);
    claim(w, 1);
    // The stored version has no hash yet: it is read to compute one, after the
    // destination was checked and before anything is copied.
    let reads = 0;
    mocks.createFileReadStream.mockImplementation(() => {
      if (++reads === 2) stealLease(w);
      return Readable.from([pdfBytes]);
    });

    await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow();

    expect(reads).toBeGreaterThanOrEqual(2);
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
  });
});

describe("a replacement onto a sealed version", () => {
  it("is stored as a new version based on it, and the sealed row is left as it is", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.replace);
    claim(w, 1);
    const before = { ...w.tables.document_versions.find((v) => v.id === VERSION)! };
    // The shared writer refuses a content change of a sealed version.
    mocks.updateDocumentVersion.mockResolvedValue({ data: null, error: null, sealed: true });

    await processUploadJob(w.db, "job-1", "w1");

    expect(mocks.createDocumentVersion).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        // Held under the sealed version's training author, whoever replaces it.
        authorship: { kind: "copy", sourceVersionId: VERSION },
        id: VRESOURCE,
        document_id: DOCUMENT,
        base_version_id: VERSION,
        content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(w.tables.document_versions.find((v) => v.id === VERSION)).toEqual(before);
    expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION, VRESOURCE]);
  });

  it("without a sealed version, still rewrites it in place and creates nothing", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.replace);
    claim(w, 1);

    await processUploadJob(w.db, "job-1", "w1");

    expect(mocks.updateDocumentVersion).toHaveBeenCalledOnce();
    expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
  });
});

describe("a read that fails during the destination check", () => {
  it.each([
    ["create", "projects"],
    ["create", "org_members"],
    ["create", "project_org_access_overrides"],
    ["createInWorkflow", "workflows"],
    ["newVersion", "documents"],
  ])("%s / %s: retried, and the next attempt completes it", async (kindKey, failing) => {
    const kind = KINDS[kindKey];
    const w = world();
    versionRpc(w);
    openSession(w, kind);
    claim(w, 1);
    const failedRead = failReadOnce(w, failing);

    await processUploadJob(w.db, "job-1", "w1");

    expect(failedRead()).toBe(true);
    expect(w.tables.upload_processing_jobs[0].status).toBe("queued");
    expect(w.tables.upload_session_files[0]).toMatchObject({ status: "uploaded", error_code: null });
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION]);
    expect(w.tables.documents.map((d) => d.id)).toEqual([DOCUMENT]);

    reclaim(w, 2);
    await processUploadJob(w.db, "job-1", "w1");

    expect(w.tables.upload_session_files[0]).toMatchObject({ status: "completed" });
    expect(w.tables.upload_processing_jobs[0].status).not.toBe("queued");
  });

  it("an unanswered private-matter lookup is retried too", async () => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS.create);
    claim(w, 1);
    const failedRead = failReadOnce(w, "private_matter_denied_project_ids");

    await processUploadJob(w.db, "job-1", "w1");

    expect(failedRead()).toBe(true);
    expect(w.tables.upload_processing_jobs[0].status).toBe("queued");
    expect(w.tables.documents.map((d) => d.id)).toEqual([DOCUMENT]);
  });

  it.each([
    ["complete", "projects"],
    ["complete", "org_members"],
    ["complete", "project_org_access_overrides"],
    ["re-sign", "projects"],
    ["re-sign", "org_members"],
    ["re-sign", "project_org_access_overrides"],
  ])("answers a failed read of %s / %s as an internal failure, not as a refusal", async (step, failing) => {
    const w = world();
    openSession(w, KINDS.create, "pending_upload");
    failReadOnce(w, failing);

    const outcome: any =
      step === "complete"
        ? await completeUploadSessionFile(w.db, { sessionId: SESSION, fileId: FILE, userId: ALICE, failed: false })
        : await refreshUploadUrls(w.db, SESSION, ALICE);

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("internal");
    expect(mocks.getSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("a real refusal in the worker", () => {
  it.each(["create", "newVersion", "replace"])("ends the upload without a document, a version or bytes (%s)", async (kindKey) => {
    const w = world();
    versionRpc(w);
    openSession(w, KINDS[kindKey]);
    claim(w, 1);
    removeFromOrg(w.tables);

    await processUploadJob(w.db, "job-1", "w1");

    expect(w.tables.upload_session_files[0]).toMatchObject({ status: "error", error_code: "destination_unavailable" });
    expect(w.tables.upload_processing_jobs[0].status).not.toBe("queued");
    expect(w.tables.documents.map((d) => d.id)).toEqual([DOCUMENT]);
    expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION]);
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });
});

describe("the cleanup of a failed created document", () => {
  const stored = (extra: Row = {}) => ({
    id: RESOURCE, user_id: null, project_id: PROJECT, org_id: ORG, workflow_id: null,
    status: "processing", current_version_id: null, archived_at: null, ...extra,
  });
  const failVersion = () =>
    mocks.createDocumentVersion.mockImplementation(async () => ({ data: null, error: new Error("transient failure") }));

  it("moves a document whose creator was cleared out of processing when its job fails", async () => {
    const w = world();
    w.tables.documents.push(stored());
    openSession(w, KINDS.create);
    w.tables.upload_session_files[0].document_created_at = "2026-11-01T00:00:00Z";
    claim(w, 1);
    failVersion();

    await processUploadJob(w.db, "job-1", "w1");

    expect(w.tables.upload_processing_jobs[0].status).toBe("queued");
    expect(w.tables.documents.find((d) => d.id === RESOURCE)?.status).toBe("error");
  });

  it("removes such a document, and its bytes, when the last attempt fails", async () => {
    const w = world();
    w.tables.documents.push(stored());
    openSession(w, KINDS.create);
    w.tables.upload_session_files[0].document_created_at = "2026-11-01T00:00:00Z";
    claim(w, UPLOAD_JOB_MAX_ATTEMPTS);
    failVersion();

    await processUploadJob(w.db, "job-1", "w1");

    expect(w.tables.documents.some((d) => d.id === RESOURCE)).toBe(false);
    expect(mocks.deleteFile).toHaveBeenCalled();
  });

  it("puts a retried document back to processing before it is written to", async () => {
    const w = world();
    w.tables.documents.push(stored({ status: "error" }));
    openSession(w, KINDS.create);
    w.tables.upload_session_files[0].document_created_at = "2026-11-01T00:00:00Z";
    claim(w, 2);
    let statusWhenVersionWritten: unknown;
    mocks.createDocumentVersion.mockImplementation(async (_db: unknown, version: Row) => {
      statusWhenVersionWritten = w.tables.documents.find((d) => d.id === RESOURCE)?.status;
      return { data: { ...version, version_number: 1 }, error: null };
    });

    await processUploadJob(w.db, "job-1", "w1");

    expect(statusWhenVersionWritten).toBe("processing");
  });

  describe("a session opened by the previous release (workflow_reference_create)", () => {
    const legacy: Kind = {
      purpose: "workflow_reference_create", destination: { workflow_id: WORKFLOW }, resource: RESOURCE,
    };
    const rowOf = (w: World) => w.tables.documents.find((d) => d.id === RESOURCE);

    it("moves its document out of processing when the job fails, then removes it with its bytes on the last attempt", async () => {
      const w = world();
      openSession(w, legacy);
      claim(w, 1);
      failVersion();

      await processUploadJob(w.db, "job-1", "w1");
      expect(w.tables.upload_processing_jobs[0].status).toBe("queued");
      expect(rowOf(w)?.status).toBe("error");

      reclaim(w, UPLOAD_JOB_MAX_ATTEMPTS);
      await processUploadJob(w.db, "job-1", "w1");

      expect(rowOf(w)).toBeUndefined();
      expect(mocks.deleteFile.mock.calls.map((c) => c[0] as string).some((key) => key.includes(RESOURCE))).toBe(true);
    });

    it("leaves no document row behind when it is refused after the row was written", async () => {
      const w = world();
      openSession(w, legacy);
      claim(w, 1);
      // The owner leaves while the file is copied: the second check refuses.
      mocks.copyFile.mockImplementation(async () => {
        removeFromOrg(w.tables);
        return { size: pdfBytes.length, etag: "e" };
      });

      await processUploadJob(w.db, "job-1", "w1");

      expect(w.tables.upload_session_files[0]).toMatchObject({ status: "error", error_code: "destination_unavailable" });
      expect(rowOf(w)).toBeUndefined();
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
    });
  });
});

describe("a cleanup is queued only by the attempt that ends the job", () => {
  const failVersion = () =>
    mocks.createDocumentVersion.mockImplementation(async () => ({ data: null, error: new Error("transient failure") }));
  const failUpdate = () =>
    mocks.updateDocumentVersion.mockImplementation(async () => ({ data: null, error: new Error("transient failure") }));
  const failStore = () => {
    failVersion();
    failUpdate();
  };
  const cleanupJobs = (w: World) => w.tables.db_jobs.filter((row) => row.kind === "storage.cleanup");
  const storedOf = (w: World, kindKey: string) => {
    const documentId = kindKey === "create" ? RESOURCE : DOCUMENT;
    const document = w.tables.documents.find((d) => d.id === documentId);
    return w.tables.document_versions.find((v) => v.id === document?.current_version_id);
  };

  it.each(["create", "newVersion", "replace"])(
    "keeps the bytes the holder stores when the loser's turn ended earlier and a cleanup runs between its copy and its store (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      // Attempt 1 loses the job during its copy.
      mocks.copyFile.mockImplementationOnce(async () => {
        stealLease(w);
        return { size: pdfBytes.length, etag: "e" };
      });
      await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow("upload_job_lease_lost");

      // Attempt 2 holds the job: any cleanup due now runs after its copy and
      // before it stores its version.
      mocks.deleteFile.mockClear();
      mocks.copyFile.mockImplementationOnce(async () => {
        await runCleanupJobs(w);
        return { size: pdfBytes.length, etag: "e" };
      });
      await processUploadJob(w.db, "job-1", "w2");

      expect(w.tables.upload_session_files[0].status).toBe("completed");
      const stored = storedOf(w, kindKey);
      expect(stored, "the version was stored").toBeDefined();
      const deleted = mocks.deleteFile.mock.calls.map((c) => c[0]);
      expect(deleted).not.toContain(stored?.storage_path);
      expect(deleted).not.toContain(stored?.pdf_storage_path);
      // The uploaded source is released only after the version is stored.
      expect(deleted).toEqual(["sealed/c1"]);
    },
  );

  it.each(["create", "newVersion", "replace"])(
    "queues the job's copies once when its last attempt fails after an earlier attempt copied (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      failStore();
      await processUploadJob(w.db, "job-1", "w1");
      expect(w.tables.upload_processing_jobs[0].status).toBe("queued");
      expect(cleanupJobs(w), "a job that goes on queues nothing").toEqual([]);
      const copied = mocks.copyFile.mock.calls.map((c) => c[1] as string);

      reclaim(w, UPLOAD_JOB_MAX_ATTEMPTS);
      await processUploadJob(w.db, "job-1", "w1");

      expect(w.tables.upload_processing_jobs[0].status).toBe("completed");
      const queued = cleanupJobs(w);
      expect(queued).toHaveLength(1);
      expect(queued[0].payload).toMatchObject({ unlessUsedByVersion: true });
      expect((queued[0].payload as { keys: string[] }).keys).toEqual(expect.arrayContaining(copied));

      mocks.deleteFile.mockClear();
      await runCleanupJobs(w);
      expect(mocks.deleteFile.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(copied));
    },
  );

  it.each(["create", "newVersion", "replace"])(
    "queues the job's copies once when the sweep retires a job whose attempts are spent (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      failStore();
      await processUploadJob(w.db, "job-1", "w1");
      const copied = mocks.copyFile.mock.calls.map((c) => c[1] as string);

      // The last attempt's worker is gone: its lease is stale and no attempt is left.
      Object.assign(w.tables.upload_processing_jobs[0], {
        status: "running", locked_by: "gone", attempts: UPLOAD_JOB_MAX_ATTEMPTS,
        locked_at: new Date(Date.now() - (UPLOAD_JOB_LEASE_SECONDS + 60) * 1000).toISOString(),
      });
      // The table fake has no `>=`; attempts are whole numbers.
      const base = w.db.from.bind(w.db);
      (w.db as any).from = (t: string) => {
        const b = base(t) as any;
        b.gte ??= (column: string, value: number) => b.gt(column, value - 1);
        return b;
      };
      await cleanupUploadSessions(w.db);
      await cleanupUploadSessions(w.db);

      expect(w.tables.upload_processing_jobs[0].status).toBe("error");
      const queued = cleanupJobs(w);
      expect(queued).toHaveLength(1);
      expect((queued[0].payload as { keys: string[] }).keys).toEqual(expect.arrayContaining(copied));
    },
  );

  it.each(["create", "newVersion", "replace"])(
    "queues nothing and deletes nothing when a later attempt succeeds (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      (kindKey === "replace" ? mocks.updateDocumentVersion : mocks.createDocumentVersion)
        .mockRejectedValueOnce(new Error("transient failure"));
      await processUploadJob(w.db, "job-1", "w1");
      expect(w.tables.upload_processing_jobs[0].status).toBe("queued");

      mocks.deleteFile.mockClear();
      reclaim(w, 2);
      await processUploadJob(w.db, "job-1", "w1");

      expect(w.tables.upload_session_files[0].status).toBe("completed");
      expect(w.tables.db_jobs).toEqual([]);
      expect(mocks.enqueueStorageCleanup).not.toHaveBeenCalled();
      expect(mocks.deleteFile.mock.calls.map((c) => c[0])).toEqual(["sealed/c1"]);
    },
  );

  it.each(["create", "newVersion", "replace"])(
    "stores nothing when its job has already ended while it was still copying (%s)",
    async (kindKey) => {
      const w = world();
      versionRpc(w);
      openSession(w, KINDS[kindKey]);
      claim(w, 1);
      mocks.copyFile.mockImplementation(async () => {
        // Another worker ended the job (retry limit) while this attempt stalled.
        Object.assign(w.tables.upload_processing_jobs[0], { status: "error", locked_by: null });
        return { size: pdfBytes.length, etag: "e" };
      });

      await expect(processUploadJob(w.db, "job-1", "w1")).rejects.toThrow("upload_job_lease_lost");

      expect(mocks.createDocumentVersion).not.toHaveBeenCalled();
      expect(mocks.updateDocumentVersion).not.toHaveBeenCalled();
      expect(w.tables.document_versions.map((v) => v.id)).toEqual([VERSION]);
      expect(mocks.deleteFile).not.toHaveBeenCalled();
    },
  );
});
