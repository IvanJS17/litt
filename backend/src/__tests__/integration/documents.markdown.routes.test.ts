import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), compare: vi.fn() }));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.userId = "user-1";
    res.locals.userEmail = "user@example.com";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({ marker: "db" })) }));
vi.mock("../../modules/documents/documents.service", () => ({
  saveMarkdownEdit: mocks.save,
  compareVersionTexts: mocks.compare,
}));

import { documentsRouter } from "../../modules/documents/documents.routes";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);

beforeEach(() => vi.clearAllMocks());

describe("POST /single-documents/:documentId/versions/markdown", () => {
  it("passes the body to the service and answers 201 with the new version", async () => {
    const saved = { id: "v2", version_number: 2, source: "user_edit", created_at: "t", filename: "n.md", file_type: "md", size_bytes: 3 };
    mocks.save.mockResolvedValue({ ok: true, data: saved });
    const res = await request(app)
      .post("/single-documents/d1/versions/markdown")
      .send({ text: "# a", base_version_id: "v1" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(saved);
    expect(mocks.save).toHaveBeenCalledWith(
      { marker: "db" },
      { documentId: "d1", userId: "user-1", userEmail: "user@example.com", text: "# a", baseVersionId: "v1" },
    );
  });

  it("answers 409 with the document_version_conflict code", async () => {
    mocks.save.mockResolvedValue({ ok: false, kind: "conflict", detail: "changed", code: "document_version_conflict" });
    const res = await request(app).post("/single-documents/d1/versions/markdown").send({ text: "x", base_version_id: "v1" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "document_version_conflict", detail: "changed" });
  });

  it("is not shadowed by the :versionId routes", async () => {
    mocks.save.mockResolvedValue({ ok: false, kind: "validation", detail: "bad" });
    const res = await request(app).post("/single-documents/d1/versions/markdown").send({});
    expect(res.status).toBe(400);
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: undefined, baseVersionId: undefined }));
  });
});

describe("GET /single-documents/:documentId/versions/compare", () => {
  it("answers the two sides, uncached, from the query", async () => {
    const data = { base: { id: "a" }, head: { id: "b" } };
    mocks.compare.mockResolvedValue({ ok: true, data });
    const res = await request(app).get("/single-documents/d1/versions/compare?base=a&head=b");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(data);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.compare).toHaveBeenCalledWith(
      { marker: "db" },
      { documentId: "d1", userId: "user-1", userEmail: "user@example.com", baseVersionId: "a", headVersionId: "b" },
    );
  });

  it("answers 404 when the service cannot open a version", async () => {
    mocks.compare.mockResolvedValue({ ok: false, kind: "not_found", detail: "Version not found" });
    const res = await request(app).get("/single-documents/d1/versions/compare?base=a&head=b");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Version not found" });
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});
