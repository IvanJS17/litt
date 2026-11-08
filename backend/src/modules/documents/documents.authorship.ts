// LiTT training (docs/training.md, "Authorship of the work"): the estimate of
// how much of a version came from the assistant. Computed when asked and never
// stored. It reads the version's extracted text and the assistant edits
// LiTT recorded; the rule itself is lib/documentAuthorship.ts.
//
// Who may ask is deliberately narrow, and the stage is not a permission: the
// caller must already be able to read the document, and then be
//   - for a pasante's sealed draft: its author, their current mentor, or
//     whoever may approve it (documents.trainingApproval.ts);
//   - for any other version: the document's owner when the owner has a stage
//     where the document lives, or that owner's current mentor.
// Everybody else gets the same 404 as a document they cannot read, so the
// answer does not tell who is in training. An org owner or admin gets nothing
// by role.

import type { DocumentAuthorship } from "@mike/contracts";
import {
  AUTHORSHIP_MAX_CHARS,
  estimateAuthorship,
  type AuthorshipBaselineInput,
  type AuthorshipEdit,
} from "../../lib/documentAuthorship";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { resolveTrainingStage } from "../../lib/training";
import type { ProjectRole } from "../../lib/permissions";
import { ensureDocumentAccess } from "./documents.access";
import { readStoredDocumentText } from "./documents.textSearch";
import {
  isCurrentMentor,
  mayApproveTrainingVersion,
} from "./documents.trainingApproval";

const NOT_FOUND = failure("not_found", "Version not found");

type VersionRow = {
  id: string;
  version_number: number | null;
  source: string;
  created_at: string;
  deleted_at: string | null;
  training_author_user_id: string | null;
};

type AccessLike = {
  doc: unknown;
  projectRole: ProjectRole;
};

type DocLike = {
  user_id?: string | null;
  org_id?: string | null;
  project_id?: string | null;
};

/**
 * Whether `userId`, who can read the document, may see the estimate of a
 * version sealed to `authorId` (or unsealed when it is null).
 * `canApprove`, when the caller already knows it, saves a second lookup.
 */
 * `memo` is shared by the rows of one list: what depends only on the caller,
 * the document or the author is read once instead of once per row.
export async function mayViewAuthorship(
  db: Db,
  access: AccessLike,
  userId: string,
  authorId: string | null,
  canApprove?: boolean,
): Promise<boolean> {
  memo: Map<string, Promise<boolean>> = new Map(),
  const doc = access.doc as DocLike;
  const once = (key: string, read: () => Promise<boolean>) => {
    const known = memo.get(key);
    if (known) return known;
    const pending = read();
    memo.set(key, pending);
    return pending;
  };
  const orgId = doc.org_id ?? null;
  if (!orgId) return false;
  if (authorId) {
    if (userId === authorId) return true;
    if (canApprove ?? (await mayApproveTrainingVersion(db, access, userId, authorId)))
      return true;
    return once(`mentor:${authorId}`, () => isCurrentMentor(db, orgId, authorId, userId));
  }
  const owner = doc.user_id ?? null;
  if (!owner) return false;
  // The same answer for every unsealed version of the document.
  return once("unsealed", async () => {
    if (owner !== userId && !(await isCurrentMentor(db, orgId, owner, userId)))
      return false;
    const stage = await resolveTrainingStage(db, owner, {
      orgId,
      projectId: doc.project_id ?? null,
    });
    return stage !== null;
  });
}

/** Oldest first: by creation time, then by version number. */
function compareVersions(a: VersionRow, b: VersionRow): number {
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  return byTime !== 0 ? byTime : (a.version_number ?? 0) - (b.version_number ?? 0);
}

export async function getDocumentAuthorship(
  db: Db,
  input: {
    documentId: string;
    versionId: string;
    userId: string;
    userEmail?: string | null;
  },
): Promise<ServiceResult<DocumentAuthorship>> {
  try {
    const access = await ensureDocumentAccess(
      input.documentId,
      input.userId,
      input.userEmail ?? undefined,
      db,
    );
    if (!access.ok) {
      if (access.kind === "error") return internalFailure(access.error);
      return NOT_FOUND;
    }

    const { data, error } = await db
      .from("document_versions")
      .select("id, version_number, source, created_at, deleted_at, training_author_user_id")
      .eq("document_id", input.documentId);
    if (error) return internalFailure(error);
    const versions = (data ?? []) as VersionRow[];
    const version = versions.find((row) => row.id === input.versionId);
    if (!version || version.deleted_at) return NOT_FOUND;

    if (
      !(await mayViewAuthorship(db, access, input.userId, version.training_author_user_id))
    )
      return NOT_FOUND;

    const base = {
      document_id: input.documentId,
      version_id: version.id,
      estimate: true as const,
    };
    const empty = {
      words: null,
      shares: null,
      baseline: "unknown" as const,
      edits: { accepted: 0, rejected: 0, pending: 0 },
      textless_pages: 0,
    };

    const stored = await readStoredDocumentText(db, {
      userId: input.userId,
      userEmail: input.userEmail,
      documentId: input.documentId,
      versionId: version.id,
    });
    if (!stored) return NOT_FOUND;
    if (stored.status === "failed") return ok({ ...base, ...empty, status: "text_failed" });
    if (stored.status !== "ready" || stored.text === null)
      return ok({ ...base, ...empty, status: "text_pending" });
    if (stored.text.length > AUTHORSHIP_MAX_CHARS)
      return ok({ ...base, ...empty, status: "too_large" });

    const lineage = versions.filter((row) => compareVersions(row, version) <= 0);
    const edits = await loadEdits(db, input.documentId, lineage.map((row) => row.id));
    const baseline = await loadBaseline(db, input, version, lineage, stored.text);

    const estimate = estimateAuthorship({
      text: stored.text,
      edits,
      baseline,
      textlessPages: stored.textless_page_count ?? 0,
    });
    return ok({
      ...base,
      ...estimate,
      status: estimate.words && estimate.words.total > 0 ? "ok" : "empty",
    });
  } catch (error) {
    return internalFailure(error);
  }
}

async function loadEdits(
  db: Db,
  documentId: string,
  versionIds: string[],
): Promise<AuthorshipEdit[]> {
  if (versionIds.length === 0) return [];
  const { data, error } = await db
    .from("document_edits")
    .select("version_id, status, inserted_text")
    .eq("document_id", documentId)
    .in("version_id", versionIds);
  if (error) throw error;
  return ((data ?? []) as AuthorshipEdit[]).filter(
    (row) => row.status === "pending" || row.status === "accepted" || row.status === "rejected",
  );
}

/**
 * The text the version started from: the latest version at or before it that
 * the assistant generated or somebody uploaded. When it cannot be read the
 * baseline is "unknown" and everything not matched to an accepted assistant
 * edit stays undetermined.
 */
async function loadBaseline(
  db: Db,
  input: { documentId: string; userId: string; userEmail?: string | null },
  version: VersionRow,
  lineage: VersionRow[],
  ownText: string,
): Promise<AuthorshipBaselineInput> {
  const starts = lineage
    .filter(
      (row) =>
        !row.deleted_at &&
        (row.source === "generated" || row.source === "upload" || row.source === "user_upload"),
    )
    .sort(compareVersions);
  const start = starts[starts.length - 1];
  if (!start) return { kind: "unknown" };
  const kind = start.source === "generated" ? "ai" : "file";
  if (start.id === version.id) return { kind, text: ownText };
  const stored = await readStoredDocumentText(db, {
    userId: input.userId,
    userEmail: input.userEmail,
    documentId: input.documentId,
    versionId: start.id,
  });
  if (!stored || stored.status !== "ready" || stored.text === null) return { kind: "unknown" };
  return { kind, text: stored.text };
}
