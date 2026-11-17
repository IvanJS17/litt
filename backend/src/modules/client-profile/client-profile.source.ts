/**
 * Reads the cited document versions and says whether each fact still stands on
 * the text it was captured from. Nothing is stored for this: it is computed
 * every time a fact is read, by comparing the SHA-256 of the version's text
 * today with the one saved with the fact, and by checking the version still
 * exists in the matter's project. No job watches a document.
 */

import { createHash } from "node:crypto";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { selectInBatches } from "../../lib/batchedQuery";
import { mapWithConcurrency } from "../../lib/concurrency";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import type { FactRow, SourceState } from "./client-profile.shared";

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

type VersionRow = {
  id: string;
  document_id: string;
  version_number: number | null;
  filename: string | null;
  deleted_at: string | null;
};
type DocumentRow = { id: string; project_id: string | null; archived_at: string | null };

/** A live version of a live document of this project, or null. */
export async function findLiveVersion(
  db: Db,
  projectId: string,
  versionId: string,
): Promise<ServiceResult<VersionRow | null>> {
  const { data, error } = await db
    .from("document_versions")
    .select("id, document_id, version_number, filename, deleted_at")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return internalFailure(error);
  const version = data as unknown as VersionRow | null;
  if (!version || version.deleted_at) return ok(null);
  const { data: owner, error: ownerError } = await db
    .from("documents")
    .select("id, project_id, archived_at")
    .eq("id", version.document_id)
    .maybeSingle();
  if (ownerError) return internalFailure(ownerError);
  const document = owner as unknown as DocumentRow | null;
  return ok(document && !document.archived_at && document.project_id === projectId ? version : null);
}

/**
 * The state of the source of each fact's version, by version id. Only the
 * facts passed in are read, so a caller leaves out the ones whose answer it
 * does not need (a rejected fact is never stale).
 */
export async function readSources(
  db: Db,
  projectId: string,
  facts: readonly Pick<FactRow, "document_id" | "version_id" | "text_sha256">[],
): Promise<ServiceResult<Map<string, SourceState>>> {
  const result = new Map<string, SourceState>();
  if (facts.length === 0) return ok(result);
  try {
    const versionIds = [...new Set(facts.map((fact) => fact.version_id))];
    const versions = await selectInBatches<VersionRow>("profile versions", versionIds, (batch) =>
      db.from("document_versions").select("id, document_id, version_number, filename, deleted_at").in("id", batch),
    );
    const documents = await selectInBatches<DocumentRow>(
      "profile documents",
      versions.map((version) => version.document_id),
      (batch) => db.from("documents").select("id, project_id, archived_at").in("id", batch),
    );
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const checks = await mapWithConcurrency(versionIds, 4, async (versionId): Promise<[string, SourceState]> => {
      const version = versionById.get(versionId);
      const document = version ? documentById.get(version.document_id) : undefined;
      const base = { versionNumber: version?.version_number ?? null, filename: version?.filename ?? null, currentSha: null };
      if (!version || version.deleted_at || !document || document.archived_at || document.project_id !== projectId)
        return [versionId, { ...base, staleReason: "version_missing" }];
      const state = await loadVersionTextState(db, version.document_id, versionId);
      if (!state) return [versionId, { ...base, staleReason: "version_missing" }];
      if (state.text === null) return [versionId, { ...base, staleReason: "text_unavailable" }];
      // The reason depends on each fact's saved hash; the caller compares.
      return [versionId, { ...base, staleReason: null, currentSha: sha256(state.text) }];
    });
    for (const [versionId, state] of checks) result.set(versionId, state);
    return ok(result);
  } catch (error) {
    return internalFailure(error);
  }
}

/** The state of one fact's source, given what its version reads as now. */
export function sourceStateFor(
  fact: Pick<FactRow, "version_id" | "text_sha256">,
  sources: ReadonlyMap<string, SourceState>,
): SourceState | undefined {
  const state = sources.get(fact.version_id);
  if (!state || state.staleReason || state.currentSha === null) return state;
  return state.currentSha === fact.text_sha256 ? state : { ...state, staleReason: "text_changed" };
}
