// Markdown documents: saving an edit as a new version, and reading the text of
// two versions side by side. Both rest on the version rows and the text index
// that already exist: nothing here replaces a file, and nothing logs a text.

import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/appError";
import { can, DOCUMENT_EDIT_FORBIDDEN } from "../../lib/permissions";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { contentSha256 } from "../../lib/documentVersions";
import {
    contentTypeForDocumentType,
    decodeMarkdownBytes,
    isMarkdownDocumentType,
    MAX_DOCUMENT_UPLOAD_BYTES,
} from "../../lib/documentTypes";
import { deleteFile, uploadFile, versionStorageKey } from "../../lib/storage";
import { logError } from "../../lib/log";
import { safeError } from "../../lib/safeError";
import { ensureDocumentAccess } from "./documents.access";
import { createDocumentVersion } from "./documents.lifecycle";
import { readStoredDocumentText } from "./documents.textSearch";
import type { Db } from "./documents.shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VERSION_CONFLICT_CODE = "document_version_conflict";

/** Text returned per version by the compare route; above it the text is withheld. */
export const COMPARE_MAX_TEXT_CHARS = 2_000_000;

export type SavedMarkdownVersion = {
    id: string;
    version_number: number;
    source: string;
    created_at: string;
    filename: string;
    file_type: string;
    size_bytes: number;
};

export function isVersionConflict(error: unknown): boolean {
    const { message } = (error ?? {}) as { message?: unknown };
    return typeof message === "string" && message.includes(VERSION_CONFLICT_CODE);
}

/**
 * Save a person's edit of a Markdown document as a NEW version
 * (source 'user_edit'). `baseVersionId` is the version the edit was made on:
 * if the document has moved on, nothing is written and the caller gets a 409,
 * so a concurrent save is never lost in silence. The check is repeated under
 * the document lock inside create_document_version.
 */
export async function saveMarkdownEdit(
    db: Db,
    args: {
        documentId: string;
        userId: string;
        userEmail: string | undefined;
        text: unknown;
        baseVersionId: unknown;
    },
): Promise<ServiceResult<SavedMarkdownVersion>> {
    const { documentId, userId, userEmail, text, baseVersionId } = args;
    if (typeof text !== "string" || typeof baseVersionId !== "string" || !UUID.test(baseVersionId))
        return failure("validation", "text and base_version_id are required.");

    const access = await ensureDocumentAccess(documentId, userId, userEmail, db, {
        select: "id, current_version_id, user_id, project_id, org_id, workflow_id",
    });
    if (!access.ok) {
        if (access.kind === "error") return internalFailure(access.error);
        return failure("not_found", "Document not found");
    }
    // The same rule as uploading a version: content.edit where the document lives.
    if (!can(access.projectRole, "content.edit"))
        return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);

    const currentVersionId = access.doc.current_version_id ?? null;
    if (!currentVersionId) return failure("not_found", "Document not found");
    const { data: current, error: currentError } = await db
        .from("document_versions")
        .select("id, filename, file_type")
        .eq("id", currentVersionId)
        .eq("document_id", documentId)
        .is("deleted_at", null)
        .maybeSingle();
    if (currentError) return internalFailure(currentError);
    if (!current) return failure("not_found", "Document not found");
    if (!isMarkdownDocumentType(current.file_type))
        return failure("validation", "Only Markdown documents can be edited this way.");
    if (currentVersionId !== baseVersionId)
        return failure(
            "conflict",
            "This document changed since you opened it. Reload it to continue.",
            VERSION_CONFLICT_CODE,
        );

    const bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength > MAX_DOCUMENT_UPLOAD_BYTES)
        return failure(
            "validation",
            "The document is larger than the upload limit.",
            "upload_file_too_large",
        );
    // A lone surrogate does not survive UTF-8: refuse it instead of storing a replacement character.
    if (decodeMarkdownBytes(bytes, { fatal: true }) !== text)
        return failure("validation", "The text is not valid UTF-8.");

    const filename = (current.filename as string | null)?.trim() || "Untitled document.md";
    const key = versionStorageKey(userId, documentId, randomUUID().replace(/-/g, ""), filename);
    try {
        await uploadFile(
            key,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
            contentTypeForDocumentType("md"),
        );
    } catch (error) {
        return internalFailure(
            new AppError("storage.write_failed", "[versions/markdown] storage write failed", { cause: error }),
        );
    }

    const { data: version, error } = await createDocumentVersion(db, {
        authorship: { kind: "author", userId },
        document_id: documentId,
        storage_path: key,
        pdf_storage_path: null,
        source: "user_edit",
        filename,
        file_type: "md",
        size_bytes: bytes.byteLength,
        page_count: null,
        textless_page_count: null,
        content_sha256: contentSha256(bytes),
        base_version_id: baseVersionId,
    });
    if (error || !version) {
        await deleteFile(key).catch((err) => logError("markdown-version", safeError(err)));
        if (isVersionConflict(error))
            return failure(
                "conflict",
                "This document changed since you opened it. Reload it to continue.",
                VERSION_CONFLICT_CODE,
            );
        return internalFailure(
            new AppError("db.rpc_failed", "[versions/markdown] insert failed", {
                cause: error ?? new Error("version_insert_returned_no_data"),
            }),
        );
    }
    return ok({
        id: version.id,
        version_number: version.version_number,
        source: version.source,
        created_at: version.created_at,
        filename: version.filename ?? filename,
        file_type: "md",
        size_bytes: bytes.byteLength,
    });
}

export type CompareTextStatus = "ready" | "pending" | "failed" | "none";

export type CompareVersion = {
    id: string;
    version_number: number | null;
    filename: string | null;
    source: string | null;
    created_at: string;
    text_status: CompareTextStatus;
    text: string | null;
    too_large: boolean;
    textless_page_count: number | null;
};

/**
 * The stored text of two versions of one document, for a read-only compare.
 * Access is the download's: whoever can open the document, over live versions
 * of that document; anything else is "not found", whether the document, a
 * version, or the permission is what is missing.
 */
export async function compareVersionTexts(
    db: Db,
    args: {
        documentId: string;
        userId: string;
        userEmail: string | undefined;
        baseVersionId: unknown;
        headVersionId: unknown;
    },
): Promise<ServiceResult<{ base: CompareVersion; head: CompareVersion }>> {
    const { documentId, userId, userEmail, baseVersionId, headVersionId } = args;
    if (
        typeof baseVersionId !== "string" ||
        typeof headVersionId !== "string" ||
        !UUID.test(baseVersionId) ||
        !UUID.test(headVersionId)
    )
        return failure("validation", "base and head are required.");

    const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
    if (!access.ok) {
        if (access.kind === "error") return internalFailure(access.error);
        return failure("not_found", "Document not found");
    }

    const ids = [...new Set([baseVersionId, headVersionId])];
    const { data: rows, error } = await db
        .from("document_versions")
        .select("id, version_number, filename, source, created_at, storage_path, textless_page_count")
        .eq("document_id", documentId)
        .in("id", ids)
        .is("deleted_at", null);
    if (error) return internalFailure(error);
    const byId = new Map(
        (rows ?? []).filter((row) => row.storage_path).map((row) => [row.id as string, row]),
    );
    if (!ids.every((id) => byId.has(id))) return failure("not_found", "Version not found");

    const load = async (versionId: string): Promise<CompareVersion | null> => {
        const row = byId.get(versionId)!;
        const stored = await readStoredDocumentText(db, { userId, userEmail, documentId, versionId });
        if (!stored) return null;
        const status: CompareTextStatus = !stored.revision
            ? "none"
            : stored.status === "ready" && stored.text !== null
              ? "ready"
              : stored.status === "failed"
                ? "failed"
                : "pending";
        const tooLarge = status === "ready" && (stored.text as string).length > COMPARE_MAX_TEXT_CHARS;
        return {
            id: row.id as string,
            version_number: (row.version_number as number | null) ?? null,
            filename: (row.filename as string | null) ?? null,
            source: (row.source as string | null) ?? null,
            created_at: row.created_at as string,
            text_status: status,
            text: status === "ready" && !tooLarge ? (stored.text as string) : null,
            too_large: tooLarge,
            textless_page_count: stored.textless_page_count ?? (row.textless_page_count as number | null) ?? null,
        };
    };
    try {
        const [base, head] = await Promise.all([load(baseVersionId), load(headVersionId)]);
        if (!base || !head) return failure("not_found", "Version not found");
        return ok({ base, head });
    } catch (error) {
        return internalFailure(error);
    }
}
