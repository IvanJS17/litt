// Read/serve paths for documents: inline display bytes, zip bundling, signed
// download URLs, and the raw source bytes of a version.

import { getSignedUrl, headFile } from "../../lib/storage";
import {
    attachActiveVersionPaths,
    loadActiveVersion,
} from "../../lib/documentVersions";
import { checkProjectAccess, createDocumentAccessChecker } from "../../lib/access";
import { mapWithConcurrency } from "../../lib/concurrency";
import { folderSubtreeIds } from "../../lib/folderSubtree";
import { queryFailureCause, selectAllByKey, selectInBatches } from "../../lib/batchedQuery";
import { zipExportLimitDetail } from "../../lib/zipExport";
import {
    loadDocumentDisplay,
    type DocumentDisplayPayload,
} from "../../lib/documentDisplay";
import { downloadFilenameForVersion, type Db } from "./documents.shared";
import { ensureDocumentAccess } from "./documents.access";
import {
    assertVersionReleasable,
    heldVersionIds,
    trainingApprovalRequired,
    type SealStage,
    type TrainingApprovalRequired,
} from "../../lib/trainingRelease";
import type { ServiceFailure } from "../../lib/serviceResult";

/**
 * In-app views (/display, /file) stay open for a pasante's unapproved
 * version, the author's editor needs them (docs/training.md), but the route
 * marks the bytes not to be cached. Any doubt (a failed approval read) marks
 * them too: the flag only tightens headers.
 */
async function isHeld(db: Db, version: Parameters<typeof assertVersionReleasable>[1]) {
    return !(await assertVersionReleasable(db, version)).ok;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Resolve the payload to serve inline for a document's display view. The
 * rendition logic (stored PDF, LibreOffice fallback, raw bytes) lives in
 * lib/documentDisplay so every preview surface renders identically; the route
 * hands the returned payload to `sendDocumentDisplay`.
 *
 * A conversion failure throws out of `loadDocumentDisplay`, so it is reported
 * separately from the 404 paths: the route maps it to an internal error.
 */
export async function getDisplayableVersion(
    documentId: string,
    userId: string,
    userEmail: string,
    versionIdParam: string | null,
    db: Db,
): Promise<
    | { ok: true; display: DocumentDisplayPayload; held: boolean }
    | { ok: false; kind: "not_found"; detail: string }
    | { ok: false; kind: "error"; error: unknown }
> {
    const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
    if (!access.ok)
        return { ok: false, kind: "not_found", detail: "Document not found" };

    const active = await loadActiveVersion(documentId, db, versionIdParam);
    if (!active)
        return { ok: false, kind: "not_found", detail: "No file available" };

    const displayFilename = downloadFilenameForVersion(
        active.filename,
        active.version_number,
        active.source === "assistant_edit",
    );

    try {
        const display = await loadDocumentDisplay({
            filename: displayFilename,
            fileType: active.file_type,
            storagePath: active.storage_path,
            pdfStoragePath: active.pdf_storage_path,
        });
        if (!display)
            return {
                ok: false,
                kind: "not_found",
                detail: "Document not found in storage",
            };
        return { ok: true, display, held: await isHeld(db, active) };
    } catch (error) {
        return { ok: false, kind: "error", error };
    }
}

// ---------------------------------------------------------------------------
// Download zip
// ---------------------------------------------------------------------------


// A `type` (not an interface) so it keeps the implicit index signature that
// attachActiveVersionPaths's row constraint requires.
type DownloadDocumentRow = {
    id: string;
    current_version_id?: string | null;
    user_id: string | null;
    project_id: string | null;
    org_id?: string | null;
    workflow_id?: string | null;
    storage_path?: string | null;
    filename?: string | null;
    source?: string | null;
    active_version_number?: number | null;
    content_sha256?: string | null;
    training_stage?: SealStage;
};

/** One file to place in the archive, already named and sized. */
export type ZipExportEntry = {
    storagePath: string;
    filename: string;
    size: number;
};

/**
 * Resolve the exportable files behind a zip request: the requested documents
 * plus everything inside the requested project / library folders, filtered to
 * what the caller may read, restricted to versions that still have bytes, and
 * bounded by the document-count and total-size limits.
 *
 * Returns entries only — the route streams the archive, because that loop is
 * an HTTP concern (it applies backpressure onto `res`).
 */
export async function resolveZipExportDocuments(
    params: {
        documentIds: string[];
        folderIds: string[];
        userId: string;
        userEmail: string | undefined;
    },
    db: Db,
): Promise<
    | { ok: true; entries: ZipExportEntry[] }
    | { ok: false; kind: "limit"; detail: string }
    | { ok: false; kind: "not_found"; detail: string }
    // A pasante's unapproved version is in the selection (docs/training.md).
    | TrainingApprovalRequired
    // Database and object-storage failures are opaque to the client: the
    // route hands the raw error to sendInternalError.
    | { ok: false; kind: "internal"; error: unknown }
> {
    const { documentIds, folderIds, userId, userEmail } = params;

    // Bound the *requested* count before any query runs, so an oversized
    // selection cannot cost a database round-trip.
    const requestedCountLimit = zipExportLimitDetail(documentIds.length, 0);
    if (requestedCountLimit)
        return { ok: false, kind: "limit", detail: requestedCountLimit };

    const rawDocsById = new Map<string, DownloadDocumentRow>();

    // Every id list is sent in 50-id batches (a 500-document selection in one
    // `.in()` exceeds the gateway's URL limit) and every read that can grow
    // with the selection is paged by id (a folder subtree can hold more than
    // max_rows documents, which used to be dropped without an error).
    const DOCUMENT_COLUMNS = "id, current_version_id, user_id, project_id, org_id, workflow_id";
    type FolderRow = { id: string; project_id?: string; library_kind?: string; parent_folder_id: string | null };
    const documentsWhereIn = (column: "id" | "folder_id" | "library_folder_id", ids: string[]) =>
        selectInBatches<DownloadDocumentRow>("download documents", ids, (batch) =>
            selectAllByKey<DownloadDocumentRow>("download documents", () =>
                  db
                    .from("documents")
                    .select(DOCUMENT_COLUMNS)
                    .in(column, batch)),
        );
    try {
        for (const doc of await documentsWhereIn("id", documentIds))
            rawDocsById.set(doc.id, doc);

        if (folderIds.length > 0) {
            const [projectRoots, libraryRoots] = await Promise.all([
                selectInBatches<FolderRow>("download project folders", folderIds, (batch) =>
                    db
                        .from("project_subfolders")
                        .select("id, project_id, parent_folder_id")
                        .in("id", batch),
                ),
                selectInBatches<FolderRow>("download library folders", folderIds, (batch) =>
                    db
                        .from("library_folders")
                        .select("id, user_id, library_kind, parent_folder_id")
                        .in("id", batch)
                        .eq("user_id", userId),
                ),
            ]);

            const projectIds = [
                ...new Set(projectRoots.map((folder) => folder.project_id as string)),
            ];
            const accessibleProjectIds = new Set(
                (
                    await mapWithConcurrency(projectIds, 5, async (projectId) => ({
                        projectId,
                        access: await checkProjectAccess(projectId, userId, userEmail, db),
                    }))
                )
                    .filter((result) => result.access.ok)
                    .map((result) => result.projectId),
            );
            const libraryKinds = [
                ...new Set(libraryRoots.map((folder) => folder.library_kind as string)),
            ];

            // Walk down from the selected roots (per project, in that
            // project; library roots within the caller's own folders of
            // those kinds) instead of reading every folder of every
            // project involved.
            const projectFolderIds: string[] = [];
            for (const projectId of accessibleProjectIds) {
                const roots = projectRoots
                    .filter((folder) => folder.project_id === projectId)
                    .map((folder) => folder.id);
                projectFolderIds.push(
                    ...(await folderSubtreeIds("download project subtree", roots, (parents) =>
                        db
                            .from("project_subfolders")
                            .select("id")
                            .eq("project_id", projectId)
                            .in("parent_folder_id", parents),
                    )),
                );
            }
            const libraryFolderIds = libraryRoots.length
                ? await folderSubtreeIds(
                      "download library subtree",
                      libraryRoots.map((folder) => folder.id),
                      (parents) =>
                          db
                              .from("library_folders")
                              .select("id")
                              .eq("user_id", userId)
                              .in("library_kind", libraryKinds)
                              .in("parent_folder_id", parents),
                  )
                : [];

            const [projectFolderDocs, libraryFolderDocs] = await Promise.all([
                documentsWhereIn("folder_id", projectFolderIds),
                documentsWhereIn("library_folder_id", libraryFolderIds),
            ]);
            for (const doc of [...projectFolderDocs, ...libraryFolderDocs])
                rawDocsById.set(doc.id, doc);
        }
    } catch (error) {
        return {
            ok: false,
            kind: "internal",
            error: queryFailureCause(error),
        };
    }

    // Folder expansion can multiply the selection well past the requested
    // count, so re-check the bound on what actually resolved.
    const resolvedCountLimit = zipExportLimitDetail(rawDocsById.size, 0);
    if (resolvedCountLimit)
        return { ok: false, kind: "limit", detail: resolvedCountLimit };

    // Filter to docs the user actually has access to (own + shared-project).
    const check = createDocumentAccessChecker(userId, userEmail, db);
    const accessChecks = await mapWithConcurrency(
        [...rawDocsById.values()], 5, async (d) => ({
            doc: d,
            access: await check(d),
        }),
    );
    const docs = accessChecks.filter((x) => x.access.ok).map((x) => x.doc);
    if (docs.length === 0)
        return { ok: false, kind: "not_found", detail: "No documents found" };

    await attachActiveVersionPaths(db, docs);
    const activeDocs = docs.filter(
        (
            doc,
        ): doc is DownloadDocumentRow & {
            storage_path: string;
        } => typeof doc.storage_path === "string" && doc.storage_path.length > 0,
    );
    if (activeDocs.length === 0)
        return { ok: false, kind: "not_found", detail: "No files available" };

    // A file with bytes has a live current version, so current_version_id is
    // the row whose seal decides. One unapproved draft blocks the archive.
    const held = await heldVersionIds(
        db,
        activeDocs.map((doc) => ({
            id: doc.current_version_id as string,
            // A seal never read (undefined) holds the archive, as a seal does.
            training_stage: doc.training_stage === null ? null : "pasante",
            content_sha256: doc.content_sha256 ?? null,
        })),
    );
    if (!held.ok)
        return {
            ok: false,
            kind: "internal",
            error: "error" in held ? held.error : held,
        };
    if (held.data.size > 0) return trainingApprovalRequired();

    // HEAD every object to learn the archive's total size before committing to
    // it; bounded concurrency keeps a large selection from opening one request
    // per document at once.
    let sized: Array<{ doc: (typeof activeDocs)[number]; size: number }>;
    try {
        sized = (
            await mapWithConcurrency(activeDocs, 5, async (doc) => ({
                doc,
                metadata: await headFile(doc.storage_path),
            }))
        )
            .filter(
                (
                    entry,
                ): entry is {
                    doc: (typeof activeDocs)[number];
                    metadata: NonNullable<Awaited<ReturnType<typeof headFile>>>;
                } => entry.metadata != null,
            )
            .map(({ doc, metadata }) => ({ doc, size: metadata.size }));
    } catch (error) {
        return { ok: false, kind: "internal", error };
    }
    if (sized.length === 0)
        return { ok: false, kind: "not_found", detail: "No files available" };

    const sizeLimit = zipExportLimitDetail(
        sized.length,
        sized.reduce((total, entry) => total + entry.size, 0),
    );
    if (sizeLimit) return { ok: false, kind: "limit", detail: sizeLimit };

    return {
        ok: true,
        entries: sized.map(({ doc, size }) => ({
            storagePath: doc.storage_path,
            filename: downloadFilenameForVersion(
                doc.filename,
                doc.active_version_number ?? null,
                doc.source === "assistant_edit",
            ),
            size,
        })),
    };
}

// ---------------------------------------------------------------------------
// Signed download URL
// ---------------------------------------------------------------------------

export async function getDownloadUrl(
    documentId: string,
    userId: string,
    userEmail: string | undefined,
    versionIdParam: string | null,
    db: Db,
): Promise<
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; kind: "not_found"; detail: string }
    | { ok: false; kind: "storage"; detail: string }
    | ServiceFailure
> {
    const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
    if (!access.ok)
        return { ok: false, kind: "not_found", detail: "Document not found" };

    const active = await loadActiveVersion(documentId, db, versionIdParam);
    if (!active)
        return { ok: false, kind: "not_found", detail: "No file available" };

    // A signed URL cannot be revoked once issued: the check is on issuing it,
    // for the row actually resolved (?version_id= may name any live version).
    const releasable = await assertVersionReleasable(db, active);
    if (!releasable.ok) return releasable;

    const downloadFilename = downloadFilenameForVersion(
        active.filename,
        active.version_number,
        active.source === "assistant_edit",
    );
    const url = await getSignedUrl(active.storage_path, 3600, downloadFilename);
    if (!url)
        return { ok: false, kind: "storage", detail: "Storage not configured" };

    return {
        ok: true,
        payload: {
            url,
            document_id: documentId,
            filename: downloadFilename,
            version_id: active.id,
            // Lets the frontend decide between DocView (PDF.js) and DocxView
            // (docx-preview) without a follow-up round-trip.
            has_pdf_rendition: !!active.pdf_storage_path,
        },
    };
}

// ---------------------------------------------------------------------------
// Raw file bytes
// ---------------------------------------------------------------------------

/**
 * Locate the active version's source object (or a specific version selected
 * with `versionIdParam`) so the route can stream it. Unlike the display path
 * this never substitutes a generated PDF rendition. Only the object's
 * metadata is read here: the route opens the read stream itself so `res`
 * applies backpressure to the object-storage read.
 */
export async function getFileStreamSource(
    documentId: string,
    userId: string,
    userEmail: string | undefined,
    versionIdParam: string | null,
    db: Db,
): Promise<
    | {
          ok: true;
          storagePath: string;
          fileType: string | null;
          size: number;
          filename: string;
          held: boolean;
      }
    | { ok: false; detail: string }
> {
    const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
    if (!access.ok) return { ok: false, detail: "Document not found" };

    const active = await loadActiveVersion(documentId, db, versionIdParam);
    if (!active) return { ok: false, detail: "No file available" };
    const metadata = await headFile(active.storage_path);
    if (!metadata) return { ok: false, detail: "Document bytes not available" };

    return {
        ok: true,
        storagePath: active.storage_path,
        fileType: active.file_type,
        size: metadata.size,
        filename: downloadFilenameForVersion(
            active.filename,
            active.version_number,
            active.source === "assistant_edit",
        ),
        held: await isHeld(db, active),
    };
}
