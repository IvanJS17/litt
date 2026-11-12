import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ compare: vi.fn() }));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.userId = "user-1";
    res.locals.userEmail = "user@example.com";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({ marker: "db" })) }));
vi.mock("../../modules/documents/documents.service", () => ({ compareDocuments: mocks.compare }));

import { documentsRouter } from "../../modules/documents/documents.routes";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);

beforeEach(() => vi.clearAllMocks());

describe("POST /single-documents/:documentId/compare", () => {
  it("passes the other document to the service and answers 201 with the new document", async () => {
    const created = { document_id: "d3", version_id: "v1", filename: "a vs b (cambios).docx", file_type: "docx", size_bytes: 3, project_id: "p", folder_id: null };
    mocks.compare.mockResolvedValue({ ok: true, data: created });
    const res = await request(app).post("/single-documents/d1/compare").send({ against_document_id: "d2" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(mocks.compare).toHaveBeenCalledWith(
      { marker: "db" },
      { documentId: "d1", againstDocumentId: "d2", userId: "user-1", userEmail: "user@example.com" },
    );
  });

  it.each([
    ["404", { ok: false, kind: "not_found", detail: "Document not found" }, 404],
    ["409 for a trainee's unapproved draft", { ok: false, kind: "conflict", detail: "draft", code: "training_approval_required" }, 409],
    ["403 for a viewer", { ok: false, kind: "forbidden", detail: "no edit" }, 403],
    ["400 compare_not_supported", { ok: false, kind: "validation", detail: "no", code: "compare_not_supported" }, 400],
    ["503 compare_unavailable", { ok: false, kind: "unavailable", detail: "busy", code: "compare_unavailable" }, 503],
  ])("answers %s", async (_label, failure, status) => {
    mocks.compare.mockResolvedValue(failure);
    const res = await request(app).post("/single-documents/d1/compare").send({ against_document_id: "d2" });
    expect(res.status).toBe(status);
    if ("code" in failure) expect(res.body.code).toBe(failure.code);
  });

  it("hands an empty body to the service, which refuses it", async () => {
    mocks.compare.mockResolvedValue({ ok: false, kind: "validation", detail: "against_document_id is required." });
    const res = await request(app).post("/single-documents/d1/compare");
    expect(res.status).toBe(400);
    expect(mocks.compare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ againstDocumentId: undefined }));
  });
});
