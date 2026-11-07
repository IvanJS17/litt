// LiTT training 1b, R1 (docs/training.md): copying a pasante's draft into a
// workflow without an organization is refused with a 409 and a code the
// client acts on, not a generic 500. Real route and service over a scripted
// database; workflow access, document access and storage are stubbed.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  workflowAccess: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "actor";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => mocks.db }));
vi.mock("../../modules/workflows/workflows.access", async (original) => ({
  ...(await original<typeof import("../../modules/workflows/workflows.access")>()),
  resolveWorkflowAccess: mocks.workflowAccess,
}));
vi.mock("../../lib/access", async (original) => ({
  ...(await original<typeof import("../../lib/access")>()),
  ensureDocAccess: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../lib/storage", async (original) => ({
  ...(await original<typeof import("../../lib/storage")>()),
  copyFile: vi.fn(async () => undefined),
}));

import { workflowsRouter } from "../../modules/workflows/workflows.routes";

const app = express();
app.use(express.json());
app.use("/workflows", workflowsRouter);

const DOC_ID = "55555555-5555-4555-8555-555555555555";
const source = {
  id: DOC_ID,
  user_id: "actor",
  project_id: null,
  org_id: null,
  workflow_id: null,
  current_version_id: "source-version",
};
const sourceVersion = {
  id: "source-version",
  document_id: DOC_ID,
  storage_path: "src/key.docx",
  pdf_storage_path: null,
  filename: "Borrador.docx",
  file_type: "docx",
  size_bytes: 4,
  page_count: null,
  textless_page_count: null,
  content_sha256: "hash",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflowAccess.mockResolvedValue({
    allowEdit: true,
    workflow: { org_id: null, type: "assistant" },
  });
});

describe("POST /workflows/:id/assets/from-documents with a pasante's draft", () => {
  it("answers 409 training_copy_needs_organization in a personal workflow", async () => {
    const fake = scriptedDb([
      { table: "documents", data: [source] },
      { table: "documents", data: [source] },
      { table: "document_versions", data: [sourceVersion] },
      { table: "documents", op: "insert" },
      {
        table: "document_versions",
        data: [{ training_author_user_id: "pasante-1", training_stage: "pasante" }],
      },
      { table: "documents", data: { org_id: null } },
      { table: "documents", op: "delete" },
      { table: "db_jobs", op: "insert" },
    ]);
    mocks.db = fake.db;

    const res = await request(app)
      .post("/workflows/workflow/assets/from-documents")
      .send({ document_ids: [DOC_ID] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "training_copy_needs_organization",
      detail: expect.stringContaining("borrador de pasante"),
    });
    // Nothing inapprovable is left behind.
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(fake.calls.some((c) => c.op === "delete")).toBe(true);
  });
});
