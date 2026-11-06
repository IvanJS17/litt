import { describe, expect, it } from "vitest";
import { scriptedDb } from "../__tests__/helpers/scriptedDb";
import { assertReleasable } from "./trainingRelease";

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
      { table: "training_version_approvals", data: { id: "approval" } },
    ]);
    expect(await assertReleasable(fake.db, "v")).toEqual({ ok: true, data: undefined });
    expect(fake.calls[1].filters).toEqual([
      ["eq", "document_version_id", "v"],
      ["eq", "content_sha256", HASH],
    ]);
    fake.done();
  });

  it("holds a sealed version whose current bytes have no approval", async () => {
    // An approval for earlier bytes does not match the current hash.
    const fake = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: HASH } },
      { table: "training_version_approvals", data: null },
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
});
