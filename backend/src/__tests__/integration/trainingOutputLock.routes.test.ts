// LiTT training 1b (docs/training.md): a pasante's unapproved version does
// not leave LiTT through a download, a signed URL or a token, and stays
// viewable inside the app. Real routes, services, loadActiveVersion and the
// release rule over an in-memory database; access and storage are stubbed.

import express from "express";
import { Readable } from "node:stream";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../helpers/memoryDb";

const HASH = "a".repeat(64);
const CHANGED = "b".repeat(64);

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  ensureDocAccess: vi.fn(),
  getSignedUrl: vi.fn(),
  headFile: vi.fn(),
  downloadFile: vi.fn(),
  createFileReadStream: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "author";
    res.locals.userEmail = "author@example.com";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => mocks.db }));
vi.mock("../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access")>()),
  ensureDocAccess: mocks.ensureDocAccess,
}));
vi.mock("../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage")>()),
  getSignedUrl: mocks.getSignedUrl,
  headFile: mocks.headFile,
  downloadFile: mocks.downloadFile,
  createFileReadStream: mocks.createFileReadStream,
}));

import { documentsRouter } from "../../modules/documents/documents.routes";
import { downloadsRouter } from "../../modules/downloads/downloads.routes";
import { buildDownloadUrl } from "../../lib/downloadTokens";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);
app.use("/download", downloadsRouter);

const STORAGE = "documents/author/doc-1/v2.pdf";
let tables: Record<string, Row[]>;

function version(): Row {
  return tables.document_versions.find((row) => row.id === "ver-2")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_SIGNING_SECRET = "test-secret";
  tables = {
    documents: [
      {
        id: "doc-1",
        current_version_id: "ver-2",
        user_id: "author",
        project_id: null,
        org_id: null,
        workflow_id: null,
      },
    ],
    document_versions: [
      {
        id: "ver-1",
        document_id: "doc-1",
        storage_path: "documents/author/doc-1/v1.pdf",
        filename: "Contrato.pdf",
        file_type: "pdf",
        version_number: 1,
        source: "upload",
        content_sha256: "c".repeat(64),
        training_stage: null,
        deleted_at: null,
      },
      {
        id: "ver-2",
        document_id: "doc-1",
        storage_path: STORAGE,
        filename: "Contrato.pdf",
        file_type: "pdf",
        version_number: 2,
        source: "user_upload",
        content_sha256: HASH,
        training_stage: "pasante",
        training_author_user_id: "author",
        deleted_at: null,
      },
    ],
    training_version_approvals: [],
  };
  mocks.db = memoryDb(tables).db;
  mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator: true, projectRole: "owner" });
  mocks.getSignedUrl.mockResolvedValue("https://storage.example/signed");
  mocks.headFile.mockResolvedValue({ size: 3 });
  mocks.downloadFile.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44]).buffer);
  mocks.createFileReadStream.mockImplementation(() =>
    Readable.from([Buffer.from([0x25, 0x50, 0x44])]),
  );
});

function approve(hash = HASH) {
  tables.training_version_approvals.push({
    id: `approval-${hash.slice(0, 4)}`,
    document_version_id: "ver-2",
    content_sha256: hash,
  });
}

const outputs = [
  {
    name: "POST /single-documents/download-zip",
    send: () =>
      request(app).post("/single-documents/download-zip").send({ document_ids: ["doc-1"] }),
  },
  {
    name: "GET /single-documents/:id/url",
    send: () => request(app).get("/single-documents/doc-1/url"),
  },
  {
    name: "GET /download/:token",
    send: () => request(app).get(buildDownloadUrl(STORAGE, "Contrato.pdf")),
  },
];

describe.each(outputs)("$name", ({ send }) => {
  it("answers 409 for a sealed version without approval", async () => {
    const response = await send();
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: "training_approval_required",
      detail: expect.any(String),
    });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(mocks.createFileReadStream).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("releases a sealed version approved for its current bytes", async () => {
    approve();
    expect((await send()).status).toBe(200);
  });

  it("answers 409 again once the approved bytes change in place", async () => {
    approve();
    version().content_sha256 = CHANGED;
    expect((await send()).status).toBe(409);
  });
});

describe("outputs of an unsealed version", () => {
  it("are unchanged", async () => {
    version().training_stage = null;
    for (const { send } of outputs) expect((await send()).status).toBe(200);
  });
});

describe("?version_id= (D-5)", () => {
  it("checks the row it names, not the current one", async () => {
    tables.documents[0].current_version_id = "ver-1";
    expect((await request(app).get("/single-documents/doc-1/url")).status).toBe(200);
    const named = await request(app).get("/single-documents/doc-1/url?version_id=ver-2");
    expect(named.status).toBe(409);
    expect(named.body.code).toBe("training_approval_required");
  });
});

describe.each(["display", "file"])("GET /single-documents/:id/%s (in-app view)", (path) => {
  it("serves the author's unapproved draft inline and uncached", async () => {
    const response = await request(app).get(`/single-documents/doc-1/${path}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/^inline/);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("serves a modified draft (version_id) uncached as well", async () => {
    approve();
    version().content_sha256 = CHANGED;
    const response = await request(app).get(
      `/single-documents/doc-1/${path}?version_id=ver-2`,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("does not add no-store once the version is approved", async () => {
    approve();
    const response = await request(app).get(`/single-documents/doc-1/${path}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBeUndefined();
  });
});

// A8: a pasante's document copied into a workflow is a workflow asset in the
// workflow's organization, with no project. A lawyer who may edit the
// workflow (or the pasante's mentor) approves it, and its download is released.
describe("a pasante's copy in a workflow asset", () => {
  beforeEach(() => {
    Object.assign(tables.documents[0], { org_id: "org", workflow_id: "workflow" });
    version().training_author_user_id = "pupil";
    tables.training_stages = [];
    tables.training_pupils = [];
  });

  const approveIt = () =>
    request(app).post("/single-documents/doc-1/versions/ver-2/training-approval");

  it.each([
    ["a lawyer with content.edit on the workflow", "editor", false],
    ["the pupil's mentor without content.edit", "viewer", true],
  ])("is approved by %s and its download released", async (_who, projectRole, mentor) => {
    mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator: false, projectRole });
    if (mentor)
      tables.training_pupils.push({ org_id: "org", trainee_user_id: "pupil", mentor_user_id: "author" });
    expect((await request(app).get("/single-documents/doc-1/url")).status).toBe(409);
    const approval = await approveIt();
    expect(approval.status).toBe(200);
    expect(tables.training_version_approvals).toEqual([
      expect.objectContaining({ document_version_id: "ver-2", content_sha256: HASH, org_id: "org" }),
    ]);
    expect((await request(app).get("/single-documents/doc-1/url")).status).toBe(200);
  });

  it("is not approved by a viewer who is not the mentor", async () => {
    mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator: false, projectRole: "viewer" });
    expect((await approveIt()).status).toBe(403);
    expect(tables.training_version_approvals).toEqual([]);
  });
});
