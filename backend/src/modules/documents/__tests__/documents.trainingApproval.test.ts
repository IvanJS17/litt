import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  stage: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../documents.access", () => ({ ensureDocumentAccess: mocks.access }));
vi.mock("../../../lib/training", () => ({ resolveTrainingStage: mocks.stage }));
vi.mock("../../../lib/audit", () => ({ recordAudit: mocks.audit }));

import { approveTrainingVersion } from "../documents.trainingApproval";

const HASH = "a".repeat(64);
const PUPIL = "pupil";
const input = { documentId: "doc", versionId: "v", userId: "approver" };
const sealed = {
  id: "v",
  training_author_user_id: PUPIL,
  training_stage: "pasante",
  content_sha256: HASH,
};
const projectDoc = { id: "doc", org_id: "org", project_id: "project" };

function readable(projectRole: string, doc: object = projectDoc) {
  mocks.access.mockResolvedValue({ ok: true, doc, isCreator: false, projectRole });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stage.mockResolvedValue(null);
});

describe("approving a pasante's version", () => {
  it("lets a lawyer with content.edit approve the current bytes, audited with ids only", async () => {
    readable("editor");
    const fake = scriptedDb([
      { table: "document_versions", data: sealed },
      { table: "training_version_approvals", op: "insert", data: { created_at: "t" } },
    ]);
    expect(await approveTrainingVersion(fake.db, input)).toEqual({
      ok: true,
      data: { document_version_id: "v", content_sha256: HASH, approved_at: "t" },
    });
    expect(fake.calls[0].filters).toEqual([
      ["eq", "id", "v"],
      ["eq", "document_id", "doc"],
      ["is", "deleted_at", null],
    ]);
    expect(fake.calls[1].payload).toEqual({
      document_version_id: "v",
      content_sha256: HASH,
      org_id: "org",
      approved_by: "approver",
    });
    expect(mocks.stage).toHaveBeenCalledWith(fake.db, "approver", {
      orgId: "org",
      projectId: "project",
    });
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(fake.db, expect.objectContaining({
      action: "training.version_approved",
      orgId: "org",
      detail: { org_id: "org", target_user_id: PUPIL },
    }));
    fake.done();
  });

  it("lets the author's current mentor approve without content.edit", async () => {
    readable("viewer");
    const fake = scriptedDb([
      { table: "document_versions", data: sealed },
      { table: "training_pupils", data: { mentor_user_id: "approver" } },
      { table: "training_version_approvals", op: "insert", data: { created_at: "t" } },
    ]);
    expect(await approveTrainingVersion(fake.db, input)).toMatchObject({ ok: true });
    expect(fake.calls[1].filters).toEqual([
      ["eq", "org_id", "org"],
      ["eq", "trainee_user_id", PUPIL],
      ["eq", "mentor_user_id", "approver"],
    ]);
    fake.done();
  });

  it.each([
    ["the author", { ...input, userId: PUPIL }, "owner", null, []],
    ["a pasante", input, "editor", "pasante", []],
    ["a junior", input, "owner", "junior", []],
    ["a viewer who is not the mentor", input, "viewer", null, [{ table: "training_pupils", data: null }]],
  ] as const)("refuses %s with one 403 and writes nothing", async (_who, args, role, stage, extra) => {
    readable(role);
    mocks.stage.mockResolvedValue(stage);
    const fake = scriptedDb([{ table: "document_versions", data: sealed }, ...extra]);
    expect(await approveTrainingVersion(fake.db, args)).toEqual({
      ok: false,
      kind: "forbidden",
      detail: "No puedes aprobar esta versión.",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    fake.done();
  });

  it("refuses a lawyer outside a project: content.edit is the project's", async () => {
    readable("owner", { id: "doc", org_id: "org", project_id: null });
    const fake = scriptedDb([
      { table: "document_versions", data: sealed },
      { table: "training_pupils", data: null },
    ]);
    expect(await approveTrainingVersion(fake.db, input)).toMatchObject({ kind: "forbidden" });
    fake.done();
  });

  it("answers 404 to somebody who cannot read the document", async () => {
    mocks.access.mockResolvedValue({ ok: false, kind: "forbidden" });
    const fake = scriptedDb([]);
    expect(await approveTrainingVersion(fake.db, input)).toMatchObject({ kind: "not_found" });
    fake.done();
  });

  it("has nothing to approve on a version without a seal", async () => {
    readable("editor");
    const fake = scriptedDb([
      { table: "document_versions", data: { ...sealed, training_stage: null, training_author_user_id: null } },
    ]);
    expect(await approveTrainingVersion(fake.db, input)).toMatchObject({ kind: "conflict" });
    fake.done();
  });

  it("keeps the first approval of the same bytes and audits it once", async () => {
    readable("editor");
    const fake = scriptedDb([
      { table: "document_versions", data: sealed },
      { table: "training_version_approvals", op: "insert", error: { code: "23505" } },
      { table: "training_version_approvals", data: { created_at: "first" } },
    ]);
    expect(await approveTrainingVersion(fake.db, input)).toMatchObject({
      ok: true,
      data: { approved_at: "first" },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    fake.done();
  });
});
