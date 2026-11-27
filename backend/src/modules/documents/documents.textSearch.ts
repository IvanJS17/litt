import type { Db } from "../../lib/supabase";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { readTextSlices } from "../../lib/documentTextSlices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DocumentTextMatch = {
  document_id: string; version_id: string; version_number: number | null;
  revision: string; filename: string; file_type: string; storage_path: string;
  library_kind: string; start_char: number; end_char: number;
  excerpt_start_char: number; excerpt: string;
};
export type DocumentTextSearch = {
  matches: DocumentTextMatch[];
  next_offset: number | null;
  coverage: {
    total_versions: number; indexed_versions: number; pending_versions: number;
    failed_versions: number; versions_needing_ocr: number;
    /** True when the search stopped on its time budget before it had looked at every version. */
    search_incomplete: boolean; incomplete_notice?: string;
  };
};

// How many searches may run at once: a search holds a database connection until it ends.
// Counted in this process, per person and for everybody together.
const SEARCHES_PER_PERSON = 2;
const SEARCHES_IN_TOTAL = 6;
const searchesRunning = new Map<string, number>();
let searchesRunningTotal = 0;
const INCOMPLETE_NOTICE = "The search stopped on its time budget before every document was checked, so the absence of a match is not conclusive. Try a more specific phrase or a narrower scope.";

/** Validate search bounds and query only text visible to the server-supplied actor. */
export async function findDocumentText(db: Db, args: {
  userId: string; userEmail?: string | null; workspace?: string | null;
  scope: string; query: string; projectId?: string | null;
  documentId?: string | null; versionId?: string | null;
  limit?: number; offset?: number;
}): Promise<ServiceResult<DocumentTextSearch>> {
  const limit = args.limit ?? 10;
  const offset = args.offset ?? 0;
  if (!["project", "library", "templates", "document"].includes(args.scope)
    || typeof args.query !== "string" || args.query.trim().length < 2 || args.query.length > 500
    || !Number.isInteger(limit) || limit < 1 || limit > 20
    || !Number.isInteger(offset) || offset < 0 || offset > 100000
    || (args.scope === "project" && !args.projectId)
    || (args.scope === "document" && !args.documentId)
    || (args.versionId && args.scope !== "document")
    || [args.projectId, args.documentId, args.versionId].some((id) => id != null && !UUID.test(id))) {
    return failure("validation", "Choose a scope and a phrase of 2–500 characters, with a limit of 1–20.");
  }
  if (searchesRunningTotal >= SEARCHES_IN_TOTAL || (searchesRunning.get(args.userId) ?? 0) >= SEARCHES_PER_PERSON) {
    return failure("unavailable", "Document search is busy. Try again in a moment.");
  }
  searchesRunningTotal += 1;
  searchesRunning.set(args.userId, (searchesRunning.get(args.userId) ?? 0) + 1);
  try {
    const { data, error } = await db.rpc("find_document_text", {
      p_user_id: args.userId, p_user_email: args.userEmail ?? null,
      p_workspace: args.workspace ?? "personal", p_scope: args.scope, p_query: args.query,
      p_project_id: args.projectId ?? null, p_document_id: args.documentId ?? null,
      p_version_id: args.versionId ?? null, p_limit: limit, p_offset: offset,
    });
    if (error) return internalFailure(error);
    const found = data as DocumentTextSearch;
    // A search that ran out of time never looks like "no matches".
    if (found?.coverage?.search_incomplete) found.coverage.incomplete_notice = INCOMPLETE_NOTICE;
    return ok(found);
  } finally {
    searchesRunningTotal -= 1;
    const left = (searchesRunning.get(args.userId) ?? 1) - 1;
    if (left > 0) searchesRunning.set(args.userId, left); else searchesRunning.delete(args.userId);
  }
}

export type StoredDocumentText = {
  revision: string; status: "pending" | "processing" | "ready" | "failed";
  text: string | null; textless_page_count: number | null;
  /** Characters in the whole text (`text` may be only the window asked for); null when there is no text yet. */
  text_length: number | null;
};
/**
 * Rechecks authorization and matches the version to its parent in the same
 * query. The whole text is assembled from bounded slices; a caller that needs
 * only a window of it passes `offset` and `maxChars`, and `text` is then that
 * window (`text_length` is still the whole length).
 */
export async function readStoredDocumentText(db: Db, args: {
  userId: string; userEmail?: string | null; documentId: string; versionId: string;
  offset?: number; maxChars?: number;
}): Promise<StoredDocumentText | null> {
  return readTextSlices(async (offset, length) => {
    const { data, error } = await db.rpc("read_document_text", {
      p_user_id: args.userId, p_user_email: args.userEmail ?? null,
      p_document_id: args.documentId, p_version_id: args.versionId,
      p_offset: offset, p_length: length,
    });
    if (error) throw error;
    return data as StoredDocumentText | null;
  }, { offset: args.offset, maxChars: args.maxChars });
}

/**
 * May this person open this stored document now? The authorization half of
 * read_document_text, on its own: every read a running turn makes asks it, so a
 * turn built while access was open stops serving text once access is gone.
 * Throws when the database cannot answer (the caller must not read then).
 */
export async function documentOpenableNow(db: Db, args: {
  userId: string; userEmail?: string | null; documentId: string;
}): Promise<boolean> {
  const { data, error } = await db.rpc("document_text_access", {
    p_document_id: args.documentId, p_user_id: args.userId, p_user_email: args.userEmail ?? null,
  });
  if (error) throw error;
  return data === true;
}

/**
 * The cheap half of readStoredDocumentText: is the actor still allowed to read
 * this document, and is the version still live at `revision`? A ready text row
 * is keyed by its source revision, so "same revision" means "same text" and a
 * caller holding that text from earlier in the turn may serve it again without
 * transferring it. Same authorization function as read_document_text.
 */
export async function storedDocumentTextCurrent(db: Db, args: {
  userId: string; userEmail?: string | null; documentId: string; versionId: string; revision: string;
}): Promise<boolean> {
  const [access, version] = await Promise.all([
    documentOpenableNow(db, args),
    db.from("document_versions").select("text_revision")
      .eq("id", args.versionId).eq("document_id", args.documentId).is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (version.error) throw version.error;
  return access
    && (version.data as { text_revision?: string | null } | null)?.text_revision === args.revision;
}
