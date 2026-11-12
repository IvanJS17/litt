import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), convert: vi.fn() }));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.userId = "user-1";
    res.locals.userEmail = "user@example.com";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({ marker: "db" })) }));
vi.mock("../../modules/documents/documents.service", () => ({
  previewDocumentConversion: mocks.preview,
  convertDocument: mocks.convert,
}));

import { documentsRouter } from "../../modules/documents/documents.routes";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);

beforeEach(() => vi.clearAllMocks());

describe("GET /single-documents/:documentId/convert/preview", () => {
  it("passes the target to the service and answers the notice, uncached", async () => {
    const notice = { source_type: "docx", target: "md", losses: ["docx_comments"], detected: null, blocked: null, new_filename: "a (de Word).md" };
    mocks.preview.mockResolvedValue({ ok: true, data: notice });
    const res = await request(app).get("/single-documents/d1/convert/preview?target=md");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(notice);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.preview).toHaveBeenCalledWith(
      { marker: "db" },
      { documentId: "d1", userId: "user-1", userEmail: "user@example.com", target: "md" },
    );
  });

  it.each([
    ["404 without access", { ok: false, kind: "not_found", detail: "Document not found" }, 404, { detail: "Document not found" }],
    [
      "409 for a trainee's unapproved draft",
      { ok: false, kind: "conflict", detail: "draft", code: "training_approval_required" },
      409,
      { code: "training_approval_required", detail: "draft" },
    ],
    [
      "400 for a pair that does not exist",
      { ok: false, kind: "validation", detail: "no", code: "convert_not_supported" },
      400,
      { code: "convert_not_supported", detail: "no" },
    ],
  ])("answers %s", async (_label, failure, status, body) => {
    mocks.preview.mockResolvedValue(failure);
    const res = await request(app).get("/single-documents/d1/convert/preview?target=docx");
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("is not shadowed by the document route", async () => {
    mocks.preview.mockResolvedValue({ ok: false, kind: "validation", detail: "bad" });
    await request(app).get("/single-documents/d1/convert/preview");
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: undefined }));
  });
});

describe("POST /single-documents/:documentId/convert", () => {
  it("passes the body target and answers 201 with the new document", async () => {
    const created = { document_id: "d2", version_id: "v1", filename: "a (de Word).md", file_type: "md", size_bytes: 3, project_id: "p", folder_id: null };
    mocks.convert.mockResolvedValue({ ok: true, data: created });
    const res = await request(app).post("/single-documents/d1/convert").send({ target: "md" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(mocks.convert).toHaveBeenCalledWith(
      { marker: "db" },
      { documentId: "d1", userId: "user-1", userEmail: "user@example.com", target: "md" },
    );
  });

  it.each([
    ["404", { ok: false, kind: "not_found", detail: "Document not found" }, 404],
    ["403 for a viewer", { ok: false, kind: "forbidden", detail: "no edit" }, 403],
    ["400 for a PDF with no text", { ok: false, kind: "validation", detail: "ocr", code: "convert_pdf_without_text" }, 400],
    ["503 when LibreOffice is unavailable", { ok: false, kind: "unavailable", detail: "busy", code: "convert_unavailable" }, 503],
  ])("answers %s", async (_label, failure, status) => {
    mocks.convert.mockResolvedValue(failure);
    const res = await request(app).post("/single-documents/d1/convert").send({ target: "md" });
    expect(res.status).toBe(status);
  });

  it("hands an empty body to the service, which refuses it", async () => {
    mocks.convert.mockResolvedValue({ ok: false, kind: "validation", detail: "target" });
    const res = await request(app).post("/single-documents/d1/convert");
    expect(res.status).toBe(400);
    expect(mocks.convert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: undefined }));
  });
});
