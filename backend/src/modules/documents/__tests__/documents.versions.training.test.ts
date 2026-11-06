import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({ access: vi.fn(), stage: vi.fn() }));
vi.mock("../documents.access", () => ({
  ensureDocumentAccess: mocks.access,
  canManageDocument: vi.fn(),
}));
vi.mock("../../../lib/training", () => ({ resolveTrainingStage: mocks.stage }));

import { listVersions } from "../documents.versions";

const HASH = "a".repeat(64);
const row = (id: string, seal: boolean, extra: object = {}) => ({
  id,
  version_number: 1,
  deleted_at: null,
  content_sha256: HASH,
  training_stage: seal ? "pasante" : null,
  training_author_user_id: seal ? "pupil" : null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stage.mockResolvedValue(null);
});

function readable(projectRole: string) {
  mocks.access.mockResolvedValue({
    ok: true,
    doc: { id: "doc", current_version_id: "held", org_id: "org", project_id: "project" },
    isCreator: false,
    projectRole,
  });
}

describe("versions list: the training lock (docs/training.md)", () => {
  it("says which versions are held and lets a lawyer approve them, never leaking the author", async () => {
    readable("editor");
    const fake = scriptedDb([
      {
        table: "document_versions",
        data: [row("plain", false), row("held", true), row("approved", true)],
      },
      {
        table: "training_version_approvals",
        data: [{ document_version_id: "approved", content_sha256: HASH }],
      },
    ]);
    const result = await listVersions("doc", "lawyer", undefined, fake.db);
    expect(result.ok && result.versions).toEqual([
      expect.objectContaining({ id: "plain", training_held: false, training_can_approve: false }),
      expect.objectContaining({ id: "held", training_held: true, training_can_approve: true }),
      expect.objectContaining({ id: "approved", training_held: false, training_can_approve: false }),
    ]);
    for (const version of result.ok ? result.versions : []) {
      expect(version).not.toHaveProperty("training_author_user_id");
      expect(version).not.toHaveProperty("content_sha256");
    }
    fake.done();
  });

  it("offers no approval to the author, to a pasante, or when the check fails", async () => {
    readable("editor");
    const asAuthor = scriptedDb([
      { table: "document_versions", data: [row("held", true)] },
      { table: "training_version_approvals", data: [] },
    ]);
    const mine = await listVersions("doc", "pupil", undefined, asAuthor.db);
    expect(mine.ok && mine.versions).toEqual([
      expect.objectContaining({ training_held: true, training_can_approve: false }),
    ]);

    mocks.stage.mockResolvedValueOnce("pasante");
    const asPasante = scriptedDb([
      { table: "document_versions", data: [row("held", true)] },
      { table: "training_version_approvals", data: [] },
    ]);
    const peer = await listVersions("doc", "peer", undefined, asPasante.db);
    expect(peer.ok && peer.versions).toEqual([
      expect.objectContaining({ training_can_approve: false }),
    ]);

    mocks.stage.mockRejectedValueOnce(new Error("down"));
    const failing = scriptedDb([
      { table: "document_versions", data: [row("held", true), row("gone", true, { deleted_at: "t" })] },
      { table: "training_version_approvals", error: { message: "down" } },
    ]);
    const doubt = await listVersions("doc", "lawyer", undefined, failing.db);
    // Approvals unreadable: every sealed version counts as held.
    expect(doubt.ok && doubt.versions).toEqual([
      expect.objectContaining({ id: "held", training_held: true, training_can_approve: false }),
      expect.objectContaining({ id: "gone", training_held: true, training_can_approve: false }),
    ]);
  });
});
