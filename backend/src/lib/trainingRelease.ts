// LiTT training (docs/training.md): may a document version leave LiTT?
//
// A version a pasante wrote carries a seal (document_versions.training_stage
// = 'pasante'). It is releasable when it has no seal, or when an approval
// exists for its CURRENT content_sha256: an approval binds bytes, so changing
// them in place (accepting an edit, replacing the file) needs a new one.
// Every blocked output asks this file; `heldVersionIds` is the one rule.

import {
  TRAINING_APPROVAL_REQUIRED_CODE,
  TRAINING_APPROVAL_REQUIRED_MESSAGE,
} from "./httpError";
import { chunkArray } from "./arrays";
import { ID_FILTER_BATCH_SIZE, selectAllByKey, selectInBatches } from "./batchedQuery";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "./serviceResult";
import type { Db } from "./supabase";

/**
 * The columns of a document_versions row the release rule reads. Both are
 * required: a caller that did not select them must not read as "unsealed".
 */
export type SealStage = "pasante" | null;

export type ReleaseCandidate = {
  id: string;
  training_stage: SealStage;
  content_sha256: string | null;
};

/** Sealed, or not known to be unsealed (a column the caller never read). */
const isSealed = (version: ReleaseCandidate) => version.training_stage !== null;

export type TrainingApprovalRequired = {
  ok: false;
  kind: "conflict";
  detail: string;
  code: typeof TRAINING_APPROVAL_REQUIRED_CODE;
};

/** The 409 every blocked output answers. */
export function trainingApprovalRequired(): TrainingApprovalRequired {
  return {
    ok: false,
    kind: "conflict",
    detail: TRAINING_APPROVAL_REQUIRED_MESSAGE,
    code: TRAINING_APPROVAL_REQUIRED_CODE,
  };
}

/**
 * The ids, among already-loaded `versions`, that may not leave: sealed and
 * without an approval for their current bytes. Unsealed rows cost no query.
 * A read failure is an internal failure, never a release.
 */
export async function heldVersionIds(
  db: Db,
  versions: readonly ReleaseCandidate[],
): Promise<ServiceResult<Set<string>>> {
  const sealed = versions.filter(isSealed);
  const held = new Set(sealed.map((version) => version.id));
  const hashed = sealed.filter((version) => !!version.content_sha256);
  if (hashed.length === 0) return ok(held);
  const { data, error } = await db
    .from("training_version_approvals")
    .select("document_version_id, content_sha256")
    .in("document_version_id", [...new Set(hashed.map((version) => version.id))]);
  if (error) return internalFailure(error);
  const approved = new Set(
    ((data ?? []) as { document_version_id: string; content_sha256: string }[]).map(
      (approval) => `${approval.document_version_id}:${approval.content_sha256}`,
    ),
  );
  for (const version of hashed) {
    if (approved.has(`${version.id}:${version.content_sha256}`))
      held.delete(version.id);
  }
  return ok(held);
}

/**
 * `heldVersionIds` for display: when the approvals cannot be read, every
 * sealed row counts as held, so the UI never offers what the server refuses.
 */
export async function heldVersionIdsOrSealed(
  db: Db,
  versions: readonly ReleaseCandidate[],
): Promise<Set<string>> {
  const held = await heldVersionIds(db, versions);
  if (held.ok) return held.data;
  return new Set(
    versions.filter(isSealed).map((version) => version.id),
  );
}

/** Whether one version is held; any doubt (a failed read, no live row) holds it. */
export async function isVersionHeld(db: Db, versionId: string): Promise<boolean> {
  try {
    return !(await assertReleasable(db, versionId)).ok;
  } catch {
    return true;
  }
}

/** A document version that something was built from: named by id, or by number, or the document's current one. */
export type SourceRef = { documentId?: string | null; versionId?: string | null; versionNumber?: number | null };

/** What identifies a source in the sets `heldSources` returns. */
export const sourceKey = (source: SourceRef) => `${source.documentId ?? ""}|${source.versionId ?? ""}|${source.versionNumber ?? ""}`;

type VersionRow = ReleaseCandidate & { document_id?: string; version_number?: number | null; created_at?: string | null };

/** Every row of `table` with `column` among `ids`, in batches and complete past the gateway's row limit. */
const versionsOfDocuments = <T extends Record<string, unknown>>(db: Db, columns: string, documentIds: Iterable<string>) =>
  selectInBatches<T>("document versions", documentIds, (batch) =>
    selectAllByKey<T & { id: string }>("document versions", () => db.from("document_versions").select(columns).in("document_id", batch)),
  );

/** Which of `versionIds` are held; a version with no live row is held too. */
async function heldAmong(db: Db, versionIds: Set<string>): Promise<Set<string>> {
  const live = await selectInBatches<ReleaseCandidate>("document versions", versionIds, (batch) =>
    db.from("document_versions").select("id, training_stage, content_sha256").in("id", batch).is("deleted_at", null),
  );
  const held = new Set(versionIds);
  for (const batch of chunkArray(live, ID_FILTER_BATCH_SIZE)) {
    const result = await heldVersionIds(db, batch);
    if (!result.ok) throw new Error("The approvals could not be read");
    for (const row of batch) if (!result.data.has(row.id)) held.delete(row.id);
  }
  return held;
}

/**
 * Which of `sources` may not leave LiTT, as a set of `sourceKey`s: the version
 * of each is resolved (named by id, by number, or the document's current one)
 * once per distinct source, in batches, and judged by the same rule as every
 * blocked output. Any doubt (no such version, a failed read) holds.
 */
export async function heldSources(db: Db, sources: readonly SourceRef[]): Promise<Set<string>> {
  const distinct = new Map(sources.map((source) => [sourceKey(source), source]));
  try {
    const versionOf = new Map<string, string | null>();
    const byNumber = [...distinct.values()].filter((s) => !s.versionId && s.documentId && s.versionNumber != null);
    const current = [...distinct.values()].filter((s) => !s.versionId && s.documentId && s.versionNumber == null);
    for (const [key, source] of distinct) versionOf.set(key, source.versionId ?? null);
    if (byNumber.length > 0) {
      const found = await versionsOfDocuments<{ id: string; document_id: string; version_number: number; deleted_at: string | null }>(
        db, "id, document_id, version_number, deleted_at", byNumber.map((s) => s.documentId!),
      );
      for (const source of byNumber)
        versionOf.set(sourceKey(source), found.find((v) => v.document_id === source.documentId && v.version_number === source.versionNumber && v.deleted_at === null)?.id ?? null);
    }
    if (current.length > 0) {
      const found = await selectInBatches<{ id: string; current_version_id: string | null }>("documents", current.map((s) => s.documentId!), (batch) =>
        db.from("documents").select("id, current_version_id").in("id", batch),
      );
      for (const source of current) versionOf.set(sourceKey(source), found.find((d) => d.id === source.documentId)?.current_version_id ?? null);
    }
    const held = await heldAmong(db, new Set([...versionOf.values()].filter((id): id is string => !!id)));
    return new Set([...distinct.keys()].filter((key) => {
      const version = versionOf.get(key);
      return !version || held.has(version);
    }));
  } catch {
    return new Set(distinct.keys());
  }
}

/** Whether the text of one source may not leave LiTT (see `heldSources`). */
export async function isSourceHeld(db: Db, source: SourceRef): Promise<boolean> {
  return (await heldSources(db, [source])).size > 0;
}

/** A document, and which of its versions something may have been made from: those that existed at or after `since`, or any it ever had. */
export type HistoryMoment = { documentId: string } & ({ since: string | null | undefined } | { wholeHistory: true });

/**
 * What was made from a document records no version (a cell only when it was made), and it can be made again later from whichever version is
 * current then, a replaced version coming back as current when a later one is deleted. So a cell is held when any version of its document
 * not deleted before its date (`deleted_at` empty or at or after it, later versions included) is held, and a stored answer, whose cells
 * may since have been replaced, when any version its documents ever had is held (`wholeHistory`); no date, no document row, no versions,
 * an unreadable time or a failed read hold as well.
 */
export async function heldSince(db: Db, items: readonly HistoryMoment[]): Promise<boolean[]> {
  try {
    const documents = [...new Set(items.map((item) => item.documentId))];
    const versions = await versionsOfDocuments<VersionRow & { document_id: string; deleted_at: string | null }>(
      db, "id, document_id, training_stage, content_sha256, deleted_at", documents,
    );
    const known = new Set(
      (await selectInBatches<{ id: string }>("documents", documents, (batch) => db.from("documents").select("id").in("id", batch))).map((document) => document.id),
    );
    const held = new Set<string>();
    for (const batch of chunkArray(versions.filter((v) => v.training_stage !== null), ID_FILTER_BATCH_SIZE)) {
      const result = await heldVersionIds(db, batch);
      if (!result.ok) throw new Error("The approvals could not be read");
      for (const id of result.data) held.add(id);
    }
    const byDocument = new Map<string, typeof versions>();
    for (const version of versions) byDocument.set(version.document_id, [...(byDocument.get(version.document_id) ?? []), version]);
    return items.map((item) => {
      const list = byDocument.get(item.documentId) ?? [];
      if (!known.has(item.documentId) || list.length === 0) return true;
      if ("wholeHistory" in item) return list.some((version) => held.has(version.id));
      const since = Date.parse(item.since ?? "");
      if (Number.isNaN(since)) return true;
      return list.some((version) => {
        if (version.deleted_at !== null && Number.isNaN(Date.parse(version.deleted_at ?? ""))) return true;
        const stillThere = version.deleted_at === null || Date.parse(version.deleted_at) >= since;
        return stillThere && held.has(version.id);
      });
    });
  } catch {
    return items.map(() => true);
  }
}

/** `ok` when this already-loaded version may leave, else the 409. */
export async function assertVersionReleasable(
  db: Db,
  version: ReleaseCandidate,
): Promise<ServiceResult<void>> {
  const held = await heldVersionIds(db, [version]);
  if (!held.ok) return held;
  return held.data.size === 0 ? ok(undefined) : trainingApprovalRequired();
}

/**
 * `ok` when the version may be released; a 409 `training_approval_required`
 * conflict when it is sealed and its current bytes are not approved; a
 * not_found when there is no live version with that id. A read failure is an
 * internal failure, never a release.
 */
export async function assertReleasable(
  db: Db,
  versionId: string,
): Promise<ServiceResult<void>> {
  const { data: version, error } = await db
    .from("document_versions")
    .select("training_stage, content_sha256")
    .eq("id", versionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!version) return failure("not_found", "Version not found");
  const row = version as Omit<ReleaseCandidate, "id">;
  return assertVersionReleasable(db, { id: versionId, ...row });
}
