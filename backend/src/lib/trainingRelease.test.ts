import { describe, expect, it } from "vitest";
import { scriptedDb } from "../__tests__/helpers/scriptedDb";
import { assertReleasable, heldVersionIds } from "./trainingRelease";

const HASH = "a".repeat(64);

describe("assertReleasable", () => {
  it("releases a version without a seal", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: null, content_sha256: HASH } },
    ]);
    expect(await assertReleasable(fake.db, "v")).toEqual({ ok: true, data: undefined });
    expect(fake.calls[0].filters).toEqual([["eq", "id", "v"], ["is", "deleted_at", null]]);
    fake.done();
  });

  it("releases a sealed version approved for its current bytes", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: HASH } },
      {
        table: "training_version_approvals",
        data: [{ document_version_id: "v", content_sha256: HASH }],
      },
    ]);
    expect(await assertReleasable(fake.db, "v")).toEqual({ ok: true, data: undefined });
    expect(fake.calls[1].filters).toEqual([["in", "document_version_id", ["v"]]]);
    fake.done();
  });

  it("holds a sealed version whose current bytes have no approval", async () => {
    // An approval for earlier bytes does not match the current hash.
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: HASH } },
      {
        table: "training_version_approvals",
        data: [{ document_version_id: "v", content_sha256: "b".repeat(64) }],
      },
    ]);
    expect(await assertReleasable(fake.db, "v")).toMatchObject({
      ok: false,
      kind: "conflict",
      code: "training_approval_required",
    });
    fake.done();
  });

  it("holds a sealed version without a content hash", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: null } },
    ]);
    expect(await assertReleasable(fake.db, "v")).toMatchObject({
      ok: false,
      code: "training_approval_required",
    });
    fake.done();
  });

  it("never releases on a read failure", async () => {
    const fake = scriptedDb([{ table: "document_versions", error: { message: "down" } }]);
    expect(await assertReleasable(fake.db, "v")).toMatchObject({ ok: false, kind: "error" });
    fake.done();
  });

  it("never releases on an approval read failure", async () => {
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: HASH } },
      { table: "training_version_approvals", error: { message: "down" } },
    ]);
    expect(await assertReleasable(fake.db, "v")).toMatchObject({ ok: false, kind: "error" });
    fake.done();
  });
});

describe("heldVersionIds", () => {
  it("holds only the sealed versions whose current bytes are not approved", async () => {
    const fake = scriptedDb([
      {
        table: "training_version_approvals",
        data: [
          { document_version_id: "approved", content_sha256: HASH },
          { document_version_id: "changed", content_sha256: HASH },
        ],
      },
    ]);
    const result = await heldVersionIds(fake.db, [
      { id: "plain", training_stage: null, content_sha256: HASH },
      { id: "approved", training_stage: "pasante", content_sha256: HASH },
      { id: "changed", training_stage: "pasante", content_sha256: "c".repeat(64) },
      { id: "pending", training_stage: "pasante", content_sha256: HASH },
      { id: "unhashed", training_stage: "pasante", content_sha256: null },
    ]);
    expect(result).toEqual({ ok: true, data: new Set(["changed", "pending", "unhashed"]) });
    expect(fake.calls[0].filters).toEqual([
      ["in", "document_version_id", ["approved", "changed", "pending"]],
    ]);
    fake.done();
  });

  it("asks nothing when no version is sealed", async () => {
    const fake = scriptedDb([]);
    expect(await heldVersionIds(fake.db, [{ id: "plain", training_stage: null }])).toEqual({
      ok: true,
      data: new Set(),
    });
    fake.done();
  });
});
