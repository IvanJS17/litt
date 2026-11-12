// Compare two Word documents and keep the result as a NEW Word document that
// shows the differences as tracked changes (a redline). The base document is
// the original; the other is the negotiated version. Both are read, never
// written: no new version, same bytes. Same project, folder of the base,
// version 1, `source` 'compared'.
//
// Who may compare is who may download BOTH documents (see them and their
// project, no trainee draft that is not approved), plus edit rights where the
// base lives. The two must be in the same project, so a comparison cannot
// carry text from one project into another.
//
// The engine (Docxodus, WebAssembly) runs in the isolated parser process; see
// lib/docxCompare.ts.

import type { DocumentCompareResult } from "@mike/contracts";
import { ConversionError } from "../../lib/convert";
import { packComparePair } from "../../lib/docxCompare";
import { loadActiveVersion, type ActiveVersion } from "../../lib/documentVersions";
import { ExtractionBusyError, ExtractionLimitError, runIsolatedExtraction } from "../../lib/extraction/isolated";
import { logError } from "../../lib/log";
import { readAnnexLocale, type MethodologyLocale } from "../../lib/methodology/locale";
import { can, DOCUMENT_EDIT_FORBIDDEN } from "../../lib/permissions";
import { safeError } from "../../lib/safeError";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { downloadFile } from "../../lib/storage";
import { assertVersionReleasable } from "../../lib/trainingRelease";
import { ensureDocumentAccess } from "./documents.access";
import { CONVERT_MAX_SOURCE_BYTES, namesInContainer, storeDerivedDocument, type DocRow } from "./documents.convert";
import type { Db } from "./documents.shared";

export const COMPARE_NOT_SUPPORTED_CODE = "compare_not_supported";
export const COMPARE_SOURCE_TOO_LARGE_CODE = "compare_source_too_large";
export const COMPARE_UNREADABLE_CODE = "compare_unreadable";
export const COMPARE_UNAVAILABLE_CODE = "compare_unavailable";

/** Largest source of each side. Both are held in memory and sent to the parser together. */
export const COMPARE_MAX_SOURCE_BYTES = CONVERT_MAX_SOURCE_BYTES;

const MAX_FILENAME_CHARS = 200;
const SUFFIX: Record<MethodologyLocale, string> = { "es-MX": "cambios", "en-US": "changes" };

const stem = (name: string | null) => (name ?? "").trim().replace(/\.[a-z0-9]{1,6}$/i, "") || "Untitled document";

/** `base vs other (cambios).docx`, then `… (cambios) (2).docx`… until it differs from every name taken. */
export function comparedFilename(
    base: string | null,
    other: string | null,
    locale: MethodologyLocale,
    taken: ReadonlySet<string>,
): string {
    const name = (counter: number) => {
        const tail = ` (${SUFFIX[locale]})${counter > 1 ? ` (${counter})` : ""}.docx`;
        const head = `${stem(base)} vs ${stem(other)}`;
        return `${head.slice(0, MAX_FILENAME_CHARS - tail.length).trimEnd()}${tail}`;
    };
    for (let counter = 1; ; counter++) {
        const candidate = name(counter);
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

type Side = { doc: DocRow; version: ActiveVersion; canEdit: boolean };

/** Open a document the way a download does: 404 without access, 409 for an unapproved trainee draft. */
async function openSide(
    db: Db,
    documentId: string,
    userId: string,
    userEmail: string | undefined,
): Promise<ServiceResult<Side>> {
    const access = await ensureDocumentAccess(documentId, userId, userEmail, db, {
        select:
            "id, user_id, project_id, org_id, workflow_id, current_version_id, folder_id, library_kind, library_folder_id, archived_at",
    });
    if (!access.ok) {
        if (access.kind === "error") return internalFailure(access.error);
        return failure("not_found", "Document not found");
    }
    const version = await loadActiveVersion(documentId, db);
    if (!version) return failure("not_found", "No file available");
    const releasable = await assertVersionReleasable(db, version);
    if (!releasable.ok) return releasable;
    return ok({ doc: access.doc as DocRow, version, canEdit: can(access.projectRole, "content.edit") });
}

const notSupported = () =>
    failure("validation", "These documents cannot be compared.", COMPARE_NOT_SUPPORTED_CODE);

const isComparableWord = ({ doc, version }: Side) =>
    (version.file_type ?? "").toLowerCase() === "docx" && !doc.workflow_id && (doc.library_kind ?? "file") === "file";

async function readSide(version: ActiveVersion): Promise<ServiceResult<ArrayBuffer>> {
    const tooLarge = failure("validation", "A document is too large to compare.", COMPARE_SOURCE_TOO_LARGE_CODE);
    if ((version.size_bytes ?? 0) > COMPARE_MAX_SOURCE_BYTES) return tooLarge;
    let bytes: ArrayBuffer | null;
    try {
        bytes = await downloadFile(version.storage_path);
    } catch (error) {
        return internalFailure(error);
    }
    if (!bytes) return failure("not_found", "Document bytes not available");
    return bytes.byteLength > COMPARE_MAX_SOURCE_BYTES ? tooLarge : ok(bytes);
}

function compareFailure(error: unknown): ServiceResult<never> {
    if (error instanceof ExtractionLimitError)
        return failure("validation", "A document is too large to compare.", COMPARE_SOURCE_TOO_LARGE_CODE);
    if (error instanceof ExtractionBusyError)
        return failure("unavailable", "Comparison is busy. Try again in a moment.", COMPARE_UNAVAILABLE_CODE);
    if (error instanceof ConversionError)
        return failure("unavailable", "Comparison is not available right now.", COMPARE_UNAVAILABLE_CODE);
    return failure("validation", "A document could not be read.", COMPARE_UNREADABLE_CODE);
}

/**
 * Compare the current version of the base document (the original) with the
 * current version of `againstDocumentId` (the negotiated one) into a new Word
 * document with tracked changes. Neither source changes.
 */
export async function compareDocuments(
    db: Db,
    args: { documentId: string; againstDocumentId: unknown; userId: string; userEmail: string | undefined },
): Promise<ServiceResult<DocumentCompareResult>> {
    if (typeof args.againstDocumentId !== "string" || !args.againstDocumentId)
        return failure("validation", "against_document_id is required.");

    const base = await openSide(db, args.documentId, args.userId, args.userEmail);
    if (!base.ok) return base;
    const other = await openSide(db, args.againstDocumentId, args.userId, args.userEmail);
    if (!other.ok) return other;

    const { doc } = base.data;
    if (
        args.againstDocumentId === args.documentId ||
        !isComparableWord(base.data) ||
        !isComparableWord(other.data) ||
        !doc.project_id ||
        doc.project_id !== other.data.doc.project_id
    )
        return notSupported();
    if (!base.data.canEdit) return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);

    const original = await readSide(base.data.version);
    if (!original.ok) return original;
    const negotiated = await readSide(other.data.version);
    if (!negotiated.ok) return negotiated;

    let filename: string;
    try {
        const locale = await readAnnexLocale(db, args.userId);
        filename = comparedFilename(
            base.data.version.filename,
            other.data.version.filename,
            locale,
            await namesInContainer(db, doc, args.userId),
        );
    } catch (error) {
        return internalFailure(error);
    }

    let redline: Uint8Array;
    try {
        redline = await runIsolatedExtraction(
            "docxCompare",
            async () => packComparePair(original.data, negotiated.data),
            { fileType: "docx" },
        );
    } catch (error) {
        logError("document-compare", safeError(error));
        return compareFailure(error);
    }

    return storeDerivedDocument(db, {
        doc,
        userId: args.userId,
        filename,
        bytes: Buffer.from(redline.buffer, redline.byteOffset, redline.byteLength),
        fileType: "docx",
        source: "compared",
    });
}
