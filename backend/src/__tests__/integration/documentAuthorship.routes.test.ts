// LiTT training (docs/training.md, "Authorship of the work"): the estimate of
// how much of a version came from the assistant. Real route, service and
// rule over an in-memory database; document access and the text store are
// stood in for. Who may ask is the point: the author, their current mentor and
// whoever may approve the draft; nobody else, by role or by stage.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHORSHIP_MAX_CHARS } from "../../lib/documentAuthorship";
import { memoryDb, type Row } from "../helpers/memoryDb";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  userId: "pupil",
  ensureDocAccess: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = mocks.userId;
    res.locals.userEmail = `${mocks.userId}@example.com`;
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => mocks.db }));
vi.mock("../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access")>()),
  ensureDocAccess: mocks.ensureDocAccess,
}));

import { documentsRouter } from "../../modules/documents/documents.routes";

const app = express();
app.use(express.json());
app.use("/single-documents", documentsRouter);

const AI_ONE = "La cláusula quinta establece la obligación de pago mensual.";
const AI_TWO = "El deudor responderá con todos sus bienes presentes y futuros.";
const MINE = "Agrego que el plazo de gracia es de quince días naturales.";
const FILE = "Este contrato se celebra entre las partes que comparecen.";

type Stored = { status: string; text: string | null; textless_page_count?: number };

let tables: Record<string, Row[]>;
let texts: Record<string, Stored>;

function setup() {
  tables = {
    documents: [
      { id: "doc-1", current_version_id: "ver-3", user_id: "pupil", project_id: "project", org_id: "org", workflow_id: null },
    ],
    document_versions: [
      { id: "ver-1", document_id: "doc-1", version_number: 1, source: "upload", created_at: "2026-11-01T10:00:00Z", deleted_at: null, training_author_user_id: null, training_stage: null },
      { id: "ver-2", document_id: "doc-1", version_number: 2, source: "assistant_edit", created_at: "2026-11-02T10:00:00Z", deleted_at: null, training_author_user_id: "pupil", training_stage: "pasante", content_sha256: "a".repeat(64) },
      { id: "ver-3", document_id: "doc-1", version_number: 3, source: "assistant_edit", created_at: "2026-11-03T10:00:00Z", deleted_at: null, training_author_user_id: "pupil", training_stage: "pasante", content_sha256: "b".repeat(64) },
    ],
    document_edits: [
      { id: "e1", document_id: "doc-1", version_id: "ver-2", status: "accepted", inserted_text: AI_ONE },
      { id: "e2", document_id: "doc-1", version_id: "ver-2", status: "rejected", inserted_text: "Texto rechazado por completo aquí." },
      { id: "e3", document_id: "doc-1", version_id: "ver-3", status: "pending", inserted_text: AI_TWO },
    ],
    training_stages: [{ org_id: "org", trainee_user_id: "pupil", practice: null, stage: "pasante" }],
    training_pupils: [{ org_id: "org", trainee_user_id: "pupil", mentor_user_id: "mentor" }],
    training_version_approvals: [],
    audit_events: [],
  };
  texts = {
    "ver-1": { status: "ready", text: FILE },
    "ver-2": { status: "ready", text: `${FILE}\n${AI_ONE}` },
    "ver-3": { status: "ready", text: `${FILE}\n${AI_ONE}\n${AI_TWO}\n${MINE}` },
  };
  mocks.db = memoryDb(tables, {
    read_document_text: (args) => {
      const row = texts[String(args.p_version_id)];
      return row
        ? { revision: "r", status: row.status, text: row.text, textless_page_count: row.textless_page_count ?? null }
        : null;
    },
  }).db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = "pupil";
  setup();
  mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator: true, projectRole: "owner" });
});

const ask = (versionId = "ver-3", documentId = "doc-1") =>
  request(app).get(`/single-documents/${documentId}/versions/${versionId}/authorship`);

function as(userId: string, projectRole: string, isCreator = false) {
  mocks.userId = userId;
  mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator, projectRole });
}

describe("the estimate", () => {
  it("is computed from the recorded edits and the file the document started from", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      document_id: "doc-1",
      version_id: "ver-3",
      status: "ok",
      estimate: true,
      baseline: "file",
      // The pending AI_TWO is not attributed to anybody yet; the file is not
      // known to be anyone's. Only AI_ONE (accepted) and MINE are placed.
      words: { total: 39, ai: 9, person: 11, undetermined: 19 },
      edits: { accepted: 1, rejected: 1, pending: 1 },
      textless_pages: 0,
    });
    const shares = response.body.shares;
    expect(shares.person + shares.ai + shares.undetermined).toBe(100);
    expect(shares).toEqual({ person: 30, ai: 20, undetermined: 50 });
  });

  it("does not count edits of versions newer than the one asked about", async () => {
    const response = await ask("ver-2");
    expect(response.body.words).toMatchObject({ ai: 9, person: 0, undetermined: 9 });
    expect(response.body.edits).toEqual({ accepted: 1, rejected: 1, pending: 0 });
  });

  it("a version that is the uploaded file is undetermined as a whole", async () => {
    mocks.userId = "mentor";
    mocks.ensureDocAccess.mockResolvedValue({ ok: true, isCreator: false, projectRole: "viewer" });
    // ver-1 is unsealed; the pupil owns the document and has a stage there.
    const response = await ask("ver-1");
    expect(response.status).toBe(200);
    expect(response.body.baseline).toBe("file");
    expect(response.body.shares).toEqual({ person: 0, ai: 0, undetermined: 100 });
  });

  it("reads a generated starting text as the assistant's", async () => {
    tables.document_versions[0].source = "generated";
    const response = await ask("ver-3");
    expect(response.body.baseline).toBe("ai");
    expect(response.body.words).toMatchObject({ ai: 18, person: 11, undetermined: 10 });
  });

  it("says the starting text is unknown when it cannot be read", async () => {
    texts["ver-1"] = { status: "pending", text: null };
    const response = await ask("ver-3");
    expect(response.body.baseline).toBe("unknown");
    expect(response.body.words.person).toBe(0);
    expect(response.body.words.ai).toBe(9);
  });

  it("says the starting text is unknown when the document has none recorded", async () => {
    tables.document_versions[0].source = "user_accept";
    expect((await ask("ver-3")).body.baseline).toBe("unknown");
  });

  it("reports pages without a text layer instead of attributing them", async () => {
    texts["ver-3"].textless_page_count = 2;
    expect((await ask()).body.textless_pages).toBe(2);
  });

  it("writes nothing", async () => {
    const before = JSON.stringify(tables);
    await ask();
    await ask("ver-2");
    expect(JSON.stringify(tables)).toBe(before);
    expect(tables.audit_events).toEqual([]);
  });
});

describe("when there is nothing to attribute", () => {
  it.each([
    ["pending", { status: "pending", text: null }, "text_pending"],
    ["processing", { status: "processing", text: null }, "text_pending"],
    ["failed", { status: "failed", text: null }, "text_failed"],
    ["ready without text", { status: "ready", text: null }, "text_pending"],
    ["too large", { status: "ready", text: "a".repeat(AUTHORSHIP_MAX_CHARS + 1) }, "too_large"],
    ["empty", { status: "ready", text: "[Page 1]\n" }, "empty"],
  ])("%s -> %s", async (_name, stored, status) => {
    texts["ver-3"] = stored as Stored;
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status, estimate: true });
    if (status !== "empty") {
      expect(response.body.words).toBeNull();
      expect(response.body.shares).toBeNull();
    } else expect(response.body.shares).toBeNull();
  });
});

describe("who may ask about a pasante's sealed draft", () => {
  it.each([
    ["the author", "pupil", "owner", true],
    ["the author's current mentor", "mentor", "viewer", true],
    ["a lawyer who may approve it", "lawyer", "editor", true],
    ["a lawyer who can only read", "lawyer", "viewer", false],
    ["a firm owner or admin who can only read the matter", "boss", "viewer", false],
  ])("%s -> %s", async (_who, userId, projectRole, allowed) => {
    as(userId, projectRole, userId === "pupil");
    const response = await ask();
    expect(response.status).toBe(allowed ? 200 : 404);
    if (!allowed) expect(response.body).toEqual(expect.not.objectContaining({ words: expect.anything() }));
  });

  it("is not offered to a former mentor after the pupil moves to another", async () => {
    tables.training_pupils[0].mentor_user_id = "mentor-2";
    as("mentor", "viewer");
    expect((await ask()).status).toBe(404);
    as("mentor-2", "viewer");
    expect((await ask()).status).toBe(200);
  });

  it("is not offered to a pasante or a junior, even with edit rights", async () => {
    tables.training_stages.push({ org_id: "org", trainee_user_id: "other", practice: null, stage: "junior" });
    as("other", "editor");
    expect((await ask()).status).toBe(404);
  });

  it("is not offered to somebody who cannot read the document", async () => {
    mocks.ensureDocAccess.mockResolvedValue({ ok: false });
    expect((await ask()).status).toBe(404);
  });

  it("answers the same 404 for a mentor who is not theirs and for a missing version", async () => {
    as("mentor-2", "viewer");
    const refused = await ask();
    const missing = await ask("ver-404");
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refused.body).toEqual(missing.body);
  });
});

describe("who may ask about a version nobody sealed", () => {
  it("is the owner who is in training, and their current mentor", async () => {
    tables.training_stages[0].stage = "junior";
    expect((await ask("ver-1")).status).toBe(200);
    as("mentor", "viewer");
    expect((await ask("ver-1")).status).toBe(200);
  });

  it("is nobody when the owner has no stage where the document lives (a lawyer's document)", async () => {
    tables.training_stages.length = 0;
    expect((await ask("ver-1")).status).toBe(404);
    as("mentor", "viewer");
    expect((await ask("ver-1")).status).toBe(404);
  });

  it("is not a colleague, the firm's owner or a lawyer, whatever they can edit", async () => {
    tables.training_stages[0].stage = "junior";
    for (const [user, role] of [["lawyer", "editor"], ["boss", "owner"], ["boss", "viewer"]]) {
      as(user, role);
      expect((await ask("ver-1")).status).toBe(404);
    }
  });

  it("is nobody for a document outside an organization", async () => {
    tables.documents[0].org_id = null;
    expect((await ask("ver-1")).status).toBe(404);
  });

  it("is not a stage in another practice area", async () => {
    tables.training_stages[0].practice = "penal";
    tables.projects = [{ id: "project", practice: "civil" }];
    expect((await ask("ver-1")).status).toBe(404);
  });
});

describe("versions that cannot be asked about", () => {
  it("a deleted version", async () => {
    tables.document_versions[2].deleted_at = "2026-11-04T00:00:00Z";
    expect((await ask("ver-3")).status).toBe(404);
  });

  it("a version of another document", async () => {
    tables.document_versions.push({ id: "other-ver", document_id: "doc-2", version_number: 1, source: "upload", created_at: "2026-11-01T10:00:00Z", deleted_at: null, training_author_user_id: null });
    expect((await ask("other-ver")).status).toBe(404);
  });

  it("a text the caller may not read (the store answers nothing)", async () => {
    delete texts["ver-3"];
    expect((await ask()).status).toBe(404);
  });
});

describe("a database failure", () => {
  it("answers 500 without internals", async () => {
    mocks.db = {
      from: () => {
        throw new Error("connection string leaked: postgres://secret");
      },
    };
    const response = await ask();
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});

describe("GET /single-documents/:id/versions flags who is offered the panel", () => {
  const list = () => request(app).get("/single-documents/doc-1/versions");
  const flags = (body: { versions: { id: string; training_authorship: boolean }[] }) =>
    Object.fromEntries(body.versions.map((row) => [row.id, row.training_authorship]));

  it("the author sees it on every version of their document", async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(flags(response.body)).toEqual({ "ver-1": true, "ver-2": true, "ver-3": true });
    expect(JSON.stringify(response.body)).not.toContain("training_author_user_id");
  });

  it("an approver sees it on the sealed drafts only, the mentor on all", async () => {
    as("lawyer", "editor");
    expect(flags((await list()).body)).toEqual({ "ver-1": false, "ver-2": true, "ver-3": true });
    as("mentor", "viewer");
    expect(flags((await list()).body)).toEqual({ "ver-1": true, "ver-2": true, "ver-3": true });
  });

  it("a colleague who can only read sees it nowhere, whatever their role in the firm", async () => {
    as("boss", "viewer");
    expect(flags((await list()).body)).toEqual({ "ver-1": false, "ver-2": false, "ver-3": false });
  });

  it("offers nothing it cannot prove, and the list still works, when the stages cannot be read", async () => {
    const db = mocks.db as { from: (t: string) => unknown };
    const from = db.from;
    db.from = (table: string) => {
      if (table === "training_stages" || table === "training_pupils") throw new Error("boom");
      return from(table);
    };
    as("lawyer", "editor");
    const response = await list();
    expect(response.status).toBe(200);
    expect(flags(response.body)).toEqual({ "ver-1": false, "ver-2": false, "ver-3": false });
  });
});
