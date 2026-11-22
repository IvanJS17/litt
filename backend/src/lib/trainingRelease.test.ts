import { describe, expect, it } from "vitest";
import { scriptedDb } from "../__tests__/helpers/scriptedDb";
import { tableDb } from "../__tests__/helpers/tableDb";
import {
  assertReleasable,
  assertVersionReleasable,
  heldSince,
  heldSources,
  heldVersionIds,
  heldVersionIdsOrSealed,
  isSourceHeld,
  isVersionHeld,
  sourceKey,
  type ReleaseCandidate,
} from "./trainingRelease";

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
    expect(
      await heldVersionIds(fake.db, [{ id: "plain", training_stage: null, content_sha256: null }]),
    ).toEqual({
      ok: true,
      data: new Set(),
    });
    fake.done();
  });

  // W7: a caller that never read the seal (a row with only its id) is held,
  // not released; the type also refuses it at compile time.
  it("holds a row whose seal was never read", async () => {
    const fake = scriptedDb([]);
    const unread = { id: "unread" } as unknown as ReleaseCandidate;
    expect(await heldVersionIds(fake.db, [unread])).toEqual({ ok: true, data: new Set(["unread"]) });
    expect(await assertVersionReleasable(fake.db, unread)).toMatchObject({
      ok: false,
      code: "training_approval_required",
    });
    fake.done();
  });
});

describe("display helpers", () => {
  it("counts every sealed row as held when the approvals cannot be read", async () => {
    const fake = scriptedDb([{ table: "training_version_approvals", error: { message: "down" } }]);
    const held = await heldVersionIdsOrSealed(fake.db, [
      { id: "sealed", training_stage: "pasante", content_sha256: HASH },
      { id: "plain", training_stage: null, content_sha256: HASH },
    ]);
    expect([...held]).toEqual(["sealed"]);
    fake.done();
  });

  it("answers held for a sealed version and for any doubt", async () => {
    const plain = scriptedDb([
      { table: "document_versions", data: { training_stage: null, content_sha256: HASH } },
    ]);
    expect(await isVersionHeld(plain.db, "v")).toBe(false);
    const sealed = scriptedDb([
      { table: "document_versions", data: { training_stage: "pasante", content_sha256: HASH } },
      { table: "training_version_approvals", data: [] },
    ]);
    expect(await isVersionHeld(sealed.db, "v")).toBe(true);
    const missing = scriptedDb([{ table: "document_versions", data: null }]);
    expect(await isVersionHeld(missing.db, "v")).toBe(true);
    const broken = { from: () => { throw new Error("boom"); } } as unknown as Parameters<typeof isVersionHeld>[0];
    expect(await isVersionHeld(broken, "v")).toBe(true);
  });
});

const V = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Version = { id: string; document_id: string; version_number: number; training_stage: "pasante" | null; content_sha256: string; created_at: string; deleted_at: string | null };
const version = (n: number, over: Partial<Version> = {}): Version => ({ id: V(n), document_id: V(1000 + n), version_number: 1, training_stage: null, content_sha256: HASH, created_at: "2026-11-01T10:00:00Z", deleted_at: null, ...over });
const world = (versions: Version[], extra: Record<string, Record<string, unknown>[]> = {}, options: Parameters<typeof tableDb>[1] = {}) => {
  const tables = {
    document_versions: versions,
    documents: versions.map((v) => ({ id: v.document_id, current_version_id: v.id })),
    training_version_approvals: [] as Record<string, unknown>[],
    ...extra,
  };
  const fake = tableDb(tables, options);
  return { ...fake, tables };
};
const sealed = (n: number, over: Partial<Version> = {}) => version(n, { training_stage: "pasante", ...over });
const approval = (v: Version) => ({ document_version_id: v.id, content_sha256: v.content_sha256 });

describe("isSourceHeld", () => {
  it("asks about the named version", async () => {
    const { db, tables } = world([version(1), sealed(2)]);
    expect(await isSourceHeld(db, { documentId: V(1001), versionId: V(1) })).toBe(false);
    expect(await isSourceHeld(db, { documentId: V(1002), versionId: V(2) })).toBe(true);
    tables.training_version_approvals.push(approval(sealed(2)));
    expect(await isSourceHeld(db, { documentId: V(1002), versionId: V(2) })).toBe(false);
  });

  it("resolves a version number, or the document's current version, to the version", async () => {
    const v2 = sealed(3, { document_id: V(1002), version_number: 2 });
    const { db } = world([sealed(2), v2], { documents: [{ id: V(1002), current_version_id: V(3) }] });
    expect(await isSourceHeld(db, { documentId: V(1002), versionNumber: 1 })).toBe(true);
    expect(await isSourceHeld(db, { documentId: V(1002) })).toBe(true);
    const plainCurrent = world([sealed(2), version(3, { document_id: V(1002), version_number: 2 })], { documents: [{ id: V(1002), current_version_id: V(3) }] });
    expect(await isSourceHeld(plainCurrent.db, { documentId: V(1002) })).toBe(false);
    expect(await isSourceHeld(plainCurrent.db, { documentId: V(1002), versionNumber: 1 })).toBe(true);
  });

  it("holds when the version cannot be found", async () => {
    const { db } = world([version(1, { deleted_at: "2026-11-02T10:00:00Z" })]);
    expect(await isSourceHeld(db, { documentId: V(1001), versionNumber: 9 })).toBe(true);
    expect(await isSourceHeld(db, { documentId: V(5) })).toBe(true);
    expect(await isSourceHeld(db, { documentId: V(1001), versionId: V(1) })).toBe(true);
    expect(await isSourceHeld(db, {})).toBe(true);
  });

  it("holds when a read fails, whichever way the version is named", async () => {
    const broken = { from: () => { throw new Error("boom"); } } as unknown as Parameters<typeof isVersionHeld>[0];
    expect(await isSourceHeld(broken, { documentId: V(1), versionId: V(1) })).toBe(true);
    expect(await isSourceHeld(broken, { documentId: V(1) })).toBe(true);
    expect(await isSourceHeld(broken, { documentId: V(1), versionNumber: 1 })).toBe(true);
    for (const table of ["documents", "document_versions", "training_version_approvals"]) {
      const failing = world([sealed(1)], {}, { failSelects: [table] }).db;
      expect(await isSourceHeld(failing, { documentId: V(1001), versionId: V(1) }), table).toBe(true);
      expect(await isSourceHeld(failing, { documentId: V(1001) }), table).toBe(true);
    }
  });
});

describe("heldSources", () => {
  it("judges many sources with a handful of reads, each distinct one once", async () => {
    const versions = [version(1), sealed(2), sealed(3)];
    const { db, calls } = world(versions);
    const sources = Array.from({ length: 300 }, (_, i) => ({ documentId: V(1001 + (i % 3)), versionId: i % 2 ? null : V(1 + (i % 3)), versionNumber: i % 2 ? 1 : null }));
    const held = await heldSources(db, sources);
    expect(calls.length).toBeLessThan(12);
    for (const source of sources) expect(held.has(sourceKey(source))).toBe(source.documentId !== V(1001));
  });

  it("answers a long list of versions whole, in lists of fifty at most", async () => {
    const versions = Array.from({ length: 130 }, (_, i) => (i % 2 ? sealed(i + 1) : version(i + 1)));
    const { db, calls } = world(versions);
    const held = await heldSources(db, versions.map((v) => ({ documentId: v.document_id, versionId: v.id })));
    expect(held.size).toBe(65);
    expect(Math.max(...calls.flatMap((call) => call.inSizes))).toBeLessThanOrEqual(50);
  });
});

describe("heldSince", () => {
  const doc = V(1001);
  const at = (since: string | null | undefined, db: Parameters<typeof heldSince>[0]) => heldSince(db, [{ documentId: doc, since }]).then((r) => r[0]);
  const ever = (db: Parameters<typeof heldSince>[0]) => heldSince(db, [{ documentId: doc, wholeHistory: true }]).then((r) => r[0]);
  const current = (id: string) => ({ documents: [{ id: doc, current_version_id: id }] });

  // v1 held (1 Nov); v2 plain (5 Nov); v3 held (9 Nov).
  const history = () => [
    sealed(1, { document_id: doc, created_at: "2026-11-01T10:00:00Z" }),
    version(2, { document_id: doc, created_at: "2026-11-05T10:00:00Z" }),
    sealed(3, { document_id: doc, created_at: "2026-11-09T10:00:00Z" }),
  ];

  it("holds what was made while any version that still existed was held, whichever is current and whenever it was created", async () => {
    const { db } = world(history(), current(V(3)));
    for (const since of ["2026-11-02T10:00:00Z", "2026-11-06T10:00:00Z", "2026-11-10T10:00:00Z"]) expect(await at(since, db), since).toBe(true);
  });

  it("does not infer the version that was current at the time: a held version still in the history holds a later cell, even under a plain current one", async () => {
    // v1 plain; the trainee's v2 (5 Nov) is still there; the mentor's v3 (9 Nov) is current.
    const versions = [version(1, { document_id: doc }), sealed(2, { document_id: doc, created_at: "2026-11-05T10:00:00Z" }), version(3, { document_id: doc, created_at: "2026-11-09T10:00:00Z" })];
    const { db, tables } = world(versions, current(V(3)));
    expect(await at("2026-11-10T10:00:00Z", db)).toBe(true);
    expect(await at("2026-11-03T10:00:00Z", db)).toBe(true);
    tables.training_version_approvals.push(approval(versions[1]));
    expect(await at("2026-11-10T10:00:00Z", db)).toBe(false);
    expect(await at("2026-11-03T10:00:00Z", db)).toBe(false);
  });

  it("counts a held version created after the moment, deleted or not deleted since", async () => {
    const { db } = world([version(1, { document_id: doc }), sealed(2, { document_id: doc, created_at: "2026-11-09T10:00:00Z" })], current(V(1)));
    expect(await at("2026-11-03T10:00:00Z", db)).toBe(true);
  });

  describe("a held version that was deleted", () => {
    // v1 held (1 Nov), deleted on 4 Nov; the mentor's plain v2 (2 Nov) is current.
    const afterDeletion = () => [
      sealed(1, { document_id: doc, created_at: "2026-11-01T10:00:00Z", deleted_at: "2026-11-04T10:00:00Z" }),
      version(2, { document_id: doc, created_at: "2026-11-02T10:00:00Z" }),
    ];

    it("releases what was made after the deletion, and holds what was made up to it, the very moment included", async () => {
      const { db } = world(afterDeletion(), current(V(2)));
      expect(await at("2026-11-05T10:00:00Z", db)).toBe(false);
      expect(await at("2026-11-04T10:00:00.001Z", db)).toBe(false);
      expect(await at("2026-11-04T10:00:00Z", db)).toBe(true);
      expect(await at("2026-11-03T10:00:00Z", db)).toBe(true);
    });

    it("releases both once the held version is approved", async () => {
      const versions = afterDeletion();
      const { db, tables } = world(versions, current(V(2)));
      tables.training_version_approvals.push(approval(versions[0]));
      expect(await at("2026-11-03T10:00:00Z", db)).toBe(false);
      expect(await at("2026-11-05T10:00:00Z", db)).toBe(false);
    });

    it("holds a deleted plain version's cell while the held version it replaced is back as the current one", async () => {
      // v2 plain (2 Nov) was deleted on 6 Nov: v1 (held) is current again.
      const versions = [sealed(1, { document_id: doc, created_at: "2026-11-01T10:00:00Z" }), version(2, { document_id: doc, created_at: "2026-11-02T10:00:00Z", deleted_at: "2026-11-06T10:00:00Z" })];
      const { db } = world(versions, current(V(1)));
      for (const since of ["2026-11-03T10:00:00Z", "2026-11-07T10:00:00Z"]) expect(await at(since, db), since).toBe(true);
    });

    it("holds when a deletion time cannot be read", async () => {
      const { db } = world([version(1, { document_id: doc }), version(2, { document_id: doc, created_at: "2026-11-05T10:00:00Z", deleted_at: "not a date" })], current(V(1)));
      expect(await at("2026-11-06T10:00:00Z", db)).toBe(true);
    });
  });

  it("holds when the moment, the document, its versions or a read are unknown", async () => {
    const { db } = world(history());
    expect(await at(null, db)).toBe(true);
    expect(await at(undefined, db)).toBe(true);
    expect(await at("not a date", db)).toBe(true);
    const plain = world([version(1, { document_id: doc })]);
    expect(await at(null, plain.db)).toBe(true);
    expect(await at("2026-11-10T10:00:00Z", plain.db)).toBe(false);
    expect((await heldSince(plain.db, [{ documentId: V(77), since: "2026-11-10T10:00:00Z" }]))[0]).toBe(true);
    expect((await heldSince(plain.db, [{ documentId: V(77), wholeHistory: true }]))[0]).toBe(true);
    // A document with a row and no versions, and a version row with no document row.
    expect(await at("2026-11-10T10:00:00Z", world([], { documents: [{ id: doc, current_version_id: null }] }).db)).toBe(true);
    expect(await at("2026-11-10T10:00:00Z", world([version(1, { document_id: doc })], { documents: [] }).db)).toBe(true);
    for (const table of ["document_versions", "documents", "training_version_approvals"]) {
      expect(await at("2026-11-10T10:00:00Z", world(history(), {}, { failSelects: [table] }).db), table).toBe(true);
      expect(await ever(world([sealed(1, { document_id: doc })], {}, { failSelects: [table] }).db), table).toBe(true);
    }
  });

  describe("the whole history of a document", () => {
    it("holds when any version it ever had is held, a deleted one included, and releases once all are approved", async () => {
      const versions = [sealed(1, { document_id: doc, created_at: "2026-11-01T10:00:00Z", deleted_at: "2026-11-02T10:00:00Z" }), version(2, { document_id: doc, created_at: "2026-11-03T10:00:00Z" })];
      const { db, tables } = world(versions, current(V(2)));
      expect(await ever(db)).toBe(true);
      expect(await at("2026-11-10T10:00:00Z", db)).toBe(false);
      tables.training_version_approvals.push(approval(versions[0]));
      expect(await ever(db)).toBe(false);
    });

    it("lets a document that never had a held version go", async () => {
      expect(await ever(world([version(1, { document_id: doc }), version(2, { document_id: doc })]).db)).toBe(false);
    });
  });

  it("judges many items with a handful of reads", async () => {
    const versions = Array.from({ length: 120 }, (_, i) => (i % 2 ? sealed(i + 1) : version(i + 1)));
    const { db, calls } = world(versions);
    const result = await heldSince(db, versions.flatMap((v) => [{ documentId: v.document_id, since: "2026-11-02T10:00:00Z" }, { documentId: v.document_id, wholeHistory: true as const }]));
    expect(result.filter(Boolean)).toHaveLength(120);
    expect(calls.length).toBeLessThan(20);
    expect(Math.max(...calls.flatMap((call) => call.inSizes))).toBeLessThanOrEqual(50);
  });
});
