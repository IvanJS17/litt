// Business logic + data-access for the downloads module.
//
// Service layer behind downloads.routes.ts. Takes an explicit Supabase client
// (`db`) plus request-derived primitives, resolves a signed download token to
// the object it grants access to, and RETURNS a typed result. It never touches
// req/res — the route maps the result onto status codes, headers, and body.

import type { Db } from "../../lib/supabase";
import type { Readable } from "node:stream";
import { headFile, openFileStream } from "../../lib/storage";
import { verifyDownload } from "../../lib/downloadTokens";
import { ensureDocAccess } from "../../lib/access";
import {
    assertVersionReleasable,
    type SealStage,
    type TrainingApprovalRequired,
} from "../../lib/trainingRelease";
import {
    contentTypeForDocumentType,
    documentSuffix,
} from "../../lib/documentTypes";

function contentTypeFor(filename: string): string {
    return contentTypeForDocumentType(documentSuffix(filename));
}

/**
 * An object a download token resolved to: what the response headers need,
 * and a way to open the bytes. Opening is deferred so a conditional or HEAD
 * request can be answered from the metadata without reading the object.
 */
export type ObjectDownload = {
    size: number;
    etag: string | null;
    contentType: string;
    filename: string;
    /**
     * Open the object as a stream. Rejects (StorageOperationError) when the
     * store cannot serve it, before any byte is produced; `signal` releases
     * the read when the client goes away.
     */
    open: (signal: AbortSignal) => Promise<Readable>;
};

/**
 * Metadata for the object at `path`, or null when it is not there. A HEAD,
 * not a read: the bytes are streamed to the client later, never held whole.
 */
async function describeObject(
    path: string,
    filename: string,
): Promise<ObjectDownload | null> {
    const head = await headFile(path);
    if (!head) return null;
    return {
        size: head.size,
        etag: head.etag,
        contentType: contentTypeFor(filename),
        filename,
        open: (signal) => openFileStream(path, { signal }),
    };
}

/**
 * Resolve a signed download token to the object it grants access to, enforcing that the token's
 * storage path is still backed by a live document version the caller can
 * access. Every failure after token verification collapses to "not_found" so
 * a valid-looking token cannot be used to probe for foreign files.
 *
 * This is the one gate for every issued token (chat events, edits, generated
 * files, playbook reviews, chat history and exports): a pasante's unapproved
 * version of the resolved row answers the training 409, after access, so the
 * answer reveals nothing to someone who cannot read the document.
 */
export async function resolveTokenDownload(
    db: Db,
    args: { token: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; download: ObjectDownload }
    | { ok: false; kind: "invalid_link" | "not_found" }
    | TrainingApprovalRequired
    | { ok: false; kind: "error"; error: unknown }
> {
    const info = verifyDownload(args.token);
    if (!info) return { ok: false, kind: "invalid_link" };

    const { data: version } = await db
        .from("document_versions")
        .select("id, document_id, training_stage, content_sha256")
        .eq("storage_path", info.path)
        .is("deleted_at", null)
        .maybeSingle();
    if (!version) return { ok: false, kind: "not_found" };

    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, project_id, org_id, workflow_id")
        .eq("id", (version as { document_id: string }).document_id)
        .single();
    if (!doc) return { ok: false, kind: "not_found" };

    const access = await ensureDocAccess(doc, args.userId, args.userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const releasable = await assertVersionReleasable(
        db,
        version as {
            id: string;
            training_stage: SealStage;
            content_sha256: string | null;
        },
    );
    if (!releasable.ok) {
        if (releasable.kind === "conflict") return releasable as TrainingApprovalRequired;
        if (releasable.kind === "error")
            return { ok: false, kind: "error", error: releasable.error };
        return { ok: false, kind: "not_found" };
    }

    const download = await describeObject(info.path, info.filename);
    if (!download) return { ok: false, kind: "not_found" };
    return { ok: true, download };
}
