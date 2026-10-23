import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Deleting a document (or one of its versions) is authorship-scoped AND needs
// a current content.edit verdict where the document lives now. Authorship is
// provenance: a creator downgraded to Viewer, or one whose project access was
// revoked, must not be able to destroy the container's content.

const mocks = vi.hoisted(() => ({
  ensureDocAccess: vi.fn(),
  createServerSupabase: vi.fn(),
  enqueueStorageCleanup: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));

vi.mock("../../lib/supabase", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "actor-id";
    res.locals.userEmail = "actor@example.test";
    next();
  },
}));

vi.mock("../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access")>()),
  ensureDocAccess: mocks.ensureDocAccess,
}));

vi.mock("../../lib/dbq/enqueue", () => ({
  enqueueStorageCleanup: mocks.enqueueStorageCleanup,
}));

vi.mock("../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage")>()),
  deleteFile: mocks.deleteFile,
}));

import { documentsRouter } from "../../routes/documents";

type Query = Record<string, unknown>;

function makeDb(doc: Record<string, unknown> | null) {
  const state = { rowDelete: false };
  const db = {
    from(table: string) {
      const query: Query = {};
      const chain = ["select", "eq", "in", "is", "order", "limit", "update"];
      for (const method of chain) query[method] = vi.fn(() => query);
      query.single = vi.fn(async () => ({
        data: table === "documents" ? doc : null,
        error: doc ? null : { message: "no rows" },
      }));
      query.delete = vi.fn(() => {
        if (table === "documents") state.rowDelete = true;
        return query;
      });
      // Supabase builders are thenable; the storage-key lookup awaits one
      // without a terminal `.single()`.
      query.then = (
        resolve: (value: { data: unknown; error: null }) => unknown,
      ) =>
        Promise.resolve({
          data: table === "document_versions" ? [] : null,
          error: null,
        }).then(resolve);
      return query;
    },
  };
  return { db, state };
}

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);

let current: ReturnType<typeof makeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  current = makeDb({
    id: "doc-1",
    user_id: "actor-id",
    project_id: "project-1",
    org_id: null,
    workflow_id: null,
    current_version_id: "version-2",
  });
  mocks.createServerSupabase.mockImplementation(() => current.db);
});

describe("DELETE /single-documents/:documentId", () => {
  it("refuses a creator whose project role was reduced to viewer", async () => {
    mocks.ensureDocAccess.mockResolvedValue({
      ok: true,
      isCreator: true,
      orgRole: null,
      projectRole: "viewer",
    });

    const res = await request(app).delete("/single-documents/doc-1");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Document not found" });
    expect(current.state.rowDelete).toBe(false);
    expect(mocks.enqueueStorageCleanup).not.toHaveBeenCalled();
  });

  it("refuses a creator whose access to the project was revoked", async () => {
    mocks.ensureDocAccess.mockResolvedValue({ ok: false });

    const res = await request(app).delete("/single-documents/doc-1");

    expect(res.status).toBe(404);
    expect(current.state.rowDelete).toBe(false);
  });

  it("deletes for a creator who still holds content.edit", async () => {
    mocks.ensureDocAccess.mockResolvedValue({
      ok: true,
      isCreator: true,
      orgRole: null,
      projectRole: "editor",
    });

    const res = await request(app).delete("/single-documents/doc-1");

    expect(res.status).toBe(204);
    expect(current.state.rowDelete).toBe(true);
  });
});
