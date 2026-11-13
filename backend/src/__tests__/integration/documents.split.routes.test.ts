import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ state: vi.fn(), propose: vi.fn(), create: vi.fn() }));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.userId = "user-1";
    res.locals.userEmail = "user@example.com";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({ marker: "db" })) }));
vi.mock("../../modules/documents/documents.service", () => ({
  getSplitState: mocks.state,
  proposeSplit: mocks.propose,
  createSplitDocuments: mocks.create,
}));

import { documentsRouter } from "../../modules/documents/documents.routes";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);
const who = { documentId: "d1", userId: "user-1", userEmail: "user@example.com" };

beforeEach(() => vi.clearAllMocks());

describe("Separar expediente routes", () => {
  it("GET /split answers the local state, uncached", async () => {
    mocks.state.mockResolvedValue({ ok: true, data: { page_count: 3 } });
    const res = await request(app).get("/single-documents/d1/split");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page_count: 3 });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.state).toHaveBeenCalledWith({ marker: "db" }, who);
  });

  it("POST /split answers 200 with the proposal and sends nothing from the body", async () => {
    mocks.propose.mockResolvedValue({ ok: true, data: { groups: [] } });
    const res = await request(app).post("/single-documents/d1/split").send({ markdown: "ignored", key: "ignored" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.propose).toHaveBeenCalledWith({ marker: "db" }, who);
  });

  it.each([
    ["403 without edit rights", { ok: false, kind: "forbidden", detail: "no" }, 403],
    ["409 without a key", { ok: false, kind: "conflict", detail: "key", code: "ocr_key_missing" }, 409],
    ["409 while scanned pages are unread", { ok: false, kind: "conflict", detail: "scan", code: "split_needs_scan_reading" }, 409],
    ["400 for LandingAI refusing the key", { ok: false, kind: "validation", detail: "k", code: "ocr_key_invalid" }, 400],
    ["503 when LandingAI is down", { ok: false, kind: "unavailable", detail: "d", code: "ocr_unavailable" }, 503],
  ])("POST /split answers %s", async (_label, failure, status) => {
    mocks.propose.mockResolvedValue(failure);
    const res = await request(app).post("/single-documents/d1/split");
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ detail: (failure as { detail: string }).detail });
  });

  it("POST /split/create passes the version and the confirmed groups and answers 201", async () => {
    mocks.create.mockResolvedValue({ ok: true, data: { documents: [] } });
    const groups = [{ pages: [1], name: "A", type: null }];
    const res = await request(app).post("/single-documents/d1/split/create").send({ version_id: "v1", groups });
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ marker: "db" }, { ...who, versionId: "v1", body: { version_id: "v1", groups } });
  });

  it("POST /split/create answers 409 for a stale version and 400 for invalid groups", async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, kind: "conflict", detail: "stale", code: "document_version_conflict" });
    expect((await request(app).post("/single-documents/d1/split/create").send({})).status).toBe(409);
    mocks.create.mockResolvedValueOnce({ ok: false, kind: "validation", detail: "bad", code: "split_invalid_groups" });
    expect((await request(app).post("/single-documents/d1/split/create").send({})).status).toBe(400);
  });
});
