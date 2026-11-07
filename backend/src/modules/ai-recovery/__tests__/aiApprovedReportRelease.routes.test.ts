// LiTT training 1b (docs/training.md): the approved AI review report of a
// pasante reviewer is sealed, and its download (B12) answers 409 until a
// person who may approve it approves its current bytes. Authorization,
// evidence and the strict artifact read are stubbed; the release rule and
// the route's mapping are real.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";

const IDS = {
  actor: "00000000-0000-4000-8000-000000000001",
  organization: "00000000-0000-4000-8000-000000000002",
  matter: "00000000-0000-4000-8000-000000000003",
  project: "00000000-0000-4000-8000-000000000004",
  execution: "00000000-0000-4000-8000-000000000005",
  artifactVersion: "00000000-0000-4000-8000-000000000009",
} as const;
const HASH = "a".repeat(64);

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  read: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.authenticatedIdentity = {
      user_id: "00000000-0000-4000-8000-000000000001",
      transport: { kind: "web_session" },
      mfa_satisfied: true,
    };
    next();
  },
}));
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: () => mocks.db }));
vi.mock("../../../lib/recovery/authorization/supabaseTenancyReadPort", () => ({
  createSupabaseTenancyReadPort: () => ({}),
}));
vi.mock("../../../lib/recovery/authorization/tenancyReadPort", () => ({
  evaluateInitialAccess: async () => ({
    kind: "decision",
    decision: {
      outcome: "allow",
      scope: {
        organization_id: "00000000-0000-4000-8000-000000000002",
        authorization_epoch: 1,
      },
    },
  }),
  recheckFreshAccessViaPort: async () => ({ kind: "recheck", result: { fresh: true } }),
}));
vi.mock("../../../lib/recovery/persistence/supabaseAiReadRepository", () => ({
  createSupabaseAiReadRepository: () => ({
    loadExecutionEvidence: async () => ({
      execution: {
        execution_id: "00000000-0000-4000-8000-000000000005",
        organization_id: "00000000-0000-4000-8000-000000000002",
        matter_id: "00000000-0000-4000-8000-000000000003",
      },
    }),
    loadReview: async () => ({ status: "approved", revision: 3 }),
  }),
  createBoundEvidenceResourceScopePort: () => ({}),
}));
vi.mock("../../../lib/recovery/persistence/approvedArtifactPersistence", () => ({
  createApprovedArtifactPersistence: () => ({ read: mocks.read }),
}));
vi.mock("../ai-recovery.storage", () => ({ createApprovedArtifactStorage: () => ({}) }));

import { aiRecoveryRouter } from "../ai-recovery.routes";

const app = express();
app.use("/projects/:projectId/ai-executions", aiRecoveryRouter);
const path = `/projects/${IDS.project}/ai-executions/${IDS.execution}/review/approved-report`;

let tables: Record<string, Row[]>;

beforeEach(() => {
  tables = {
    ai_review_exports: [
      {
        id: "export",
        project_id: IDS.project,
        execution_id: IDS.execution,
        review_revision: 3,
        artifact_document_version_id: IDS.artifactVersion,
      },
    ],
    document_versions: [
      {
        id: IDS.artifactVersion,
        content_sha256: HASH,
        training_stage: "pasante",
        deleted_at: null,
      },
    ],
    training_version_approvals: [],
  };
  mocks.db = memoryDb(tables).db;
  mocks.read.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

function approve() {
  tables.training_version_approvals.push({
    id: "approval",
    document_version_id: IDS.artifactVersion,
    content_sha256: HASH,
  });
}

describe("GET approved-report of a pasante reviewer", () => {
  it("answers 409 while the sealed report is not approved", async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "training_approval_required" });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves the report approved for its current bytes", async () => {
    approve();
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment/);
  });

  it("answers 409 again once the approved bytes change", async () => {
    approve();
    tables.document_versions[0].content_sha256 = "b".repeat(64);
    expect((await request(app).get(path)).status).toBe(409);
  });

  it("serves an unsealed report as before", async () => {
    tables.document_versions[0].training_stage = null;
    expect((await request(app).get(`${path}?revision=3`)).status).toBe(200);
  });
});
