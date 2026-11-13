// Convert a document between Markdown, Word and PDF.
//
// The result is always a NEW document in the same project and folder, version
// 1, `source` 'converted'. The original is read, never written: no new
// version, same bytes. Who may convert is who may download (see and open the
// document, not a trainee's unapproved draft), and creating the new document
// asks for edit rights where the original lives.
//
//   md  → docx   marked + docx (lib/markdownDocx)
//   md  → pdf    md → docx, then LibreOffice
//   docx → md    mammoth + turndown (lib/docxMarkdown), in the extraction process
//   docx → pdf   the stored PDF of the version, else LibreOffice
//   pdf → md     the text layer (pdf.js); a PDF with no text needs OCR
//
// PDF → Word does not exist: a PDF keeps no paragraphs, tables or styles, so
// the result would be a misleading Word file.

import { randomUUID } from "node:crypto";
import type {
    DocumentConversionDetected,
    DocumentConversionLoss,
    DocumentConversionPreview,
    DocumentConversionResult,
    DocumentConversionType,
} from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { ConversionError, docxToPdf } from "../../lib/convert";
import { contentSha256, loadActiveVersion, type ActiveVersion } from "../../lib/documentVersions";
import { contentTypeForDocumentType, isMarkdownDocumentType } from "../../lib/documentTypes";
import { ExtractionBusyError, ExtractionLimitError, runIsolatedExtraction } from "../../lib/extraction/isolated";
import { logError } from "../../lib/log";
import { markdownToDocx } from "../../lib/markdownDocx";
import { readAnnexLocale, type MethodologyLocale } from "../../lib/methodology/locale";
import { can, DOCUMENT_EDIT_FORBIDDEN } from "../../lib/permissions";
import { uploadConversionTimeoutMs } from "../../lib/runtimeConfig";
import { safeError } from "../../lib/safeError";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { deleteFile, downloadFile, uploadFile, versionStorageKey } from "../../lib/storage";
import { selectAllByKey, selectInBatches } from "../../lib/batchedQuery";
import { assertVersionReleasable } from "../../lib/trainingRelease";
import type { OcrFill } from "../../lib/ocr/pages";
import { ensureDocumentAccess } from "./documents.access";
import { loadReadScan } from "./documents.ocr.state";
import { createDocumentVersion } from "./documents.lifecycle";
import { deleteDocumentAndVersionFiles, type Db } from "./documents.shared";

export const CONVERT_NOT_SUPPORTED_CODE = "convert_not_supported";
export const CONVERT_PDF_WITHOUT_TEXT_CODE = "convert_pdf_without_text";
export const CONVERT_SOURCE_TOO_LARGE_CODE = "convert_source_too_large";
export const CONVERT_UNREADABLE_CODE = "convert_unreadable";
export const CONVERT_UNAVAILABLE_CODE = "convert_unavailable";

/** Largest source a conversion reads. Markdown is parsed in this process, so its cap is lower. */
export const CONVERT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const CONVERT_MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

const TARGETS: readonly DocumentConversionType[] = ["md", "docx", "pdf"];

/** The fixed list of losses of each conversion, `source>target`. PDF → Word is absent on purpose. */
export const CONVERSION_LOSSES: Readonly<Record<string, readonly DocumentConversionLoss[]>> = {
    "md>docx": ["md_raw_html", "md_formulas", "md_house_style"],
    "md>pdf": ["md_raw_html", "md_formulas", "md_house_style", "pdf_fonts_and_breaks"],
    "docx>md": [
        "docx_comments",
        "docx_tracked_changes",
        "docx_headers_footers",
        "docx_formatting",
        "docx_legal_numbering",
        "docx_images",
        "docx_merged_cells",
        "docx_footnotes_as_list",
    ],
    "docx>pdf": ["pdf_fonts_and_breaks", "pdf_tracked_changes_as_shown"],
    "pdf>md": ["pdf_layout_lost"],
};

/** The targets a source type can be converted to. */
export function conversionTargets(source: DocumentConversionType): DocumentConversionType[] {
    return TARGETS.filter((target) => `${source}>${target}` in CONVERSION_LOSSES);
}

function sourceTypeOf(fileType: string | null): DocumentConversionType | null {
    const normalized = (fileType ?? "").toLowerCase();
    if (isMarkdownDocumentType(normalized)) return "md";
    return normalized === "docx" || normalized === "pdf" ? normalized : null;
}

function isTarget(value: unknown): value is DocumentConversionType {
    return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

// --- naming -----------------------------------------------------------------

/** "(de Word)" and its kin, in the person's language. */
const NAME_SUFFIX: Record<MethodologyLocale, Record<string, string>> = {
    "es-MX": {
        "docx>md": "de Word",
        "md>docx": "de Markdown",
        "md>pdf": "en PDF",
        "docx>pdf": "en PDF",
        "pdf>md": "de PDF",
    },
    "en-US": {
        "docx>md": "from Word",
        "md>docx": "from Markdown",
        "md>pdf": "as PDF",
        "docx>pdf": "as PDF",
        "pdf>md": "from PDF",
    },
};

const MAX_FILENAME_CHARS = 200;

/** `base (de Word).md`, then `base (de Word) (2).md`… until it differs from every name taken. */
export function convertedFilename(
    original: string | null,
    pair: string,
    locale: MethodologyLocale,
    taken: ReadonlySet<string>,
): string {
    const target = pair.split(">")[1];
    const base = (original ?? "").trim().replace(/\.[a-z0-9]{1,6}$/i, "") || "Untitled document";
    const suffix = NAME_SUFFIX[locale][pair];
    const name = (counter: number) => {
        const tail = ` (${suffix})${counter > 1 ? ` (${counter})` : ""}.${target}`;
        return `${base.slice(0, MAX_FILENAME_CHARS - tail.length).trimEnd()}${tail}`;
    };
    for (let counter = 1; ; counter++) {
        const candidate = name(counter);
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

export type DocRow = {
    id: string;
    user_id: string | null;
    project_id: string | null;
    org_id?: string | null;
    workflow_id?: string | null;
    current_version_id?: string | null;
    folder_id?: string | null;
    library_kind?: string | null;
    library_folder_id?: string | null;
};

/** The names already used by the documents in the folder the new one will land in. */
export async function namesInContainer(db: Db, doc: DocRow, userId: string): Promise<Set<string>> {
    const build = () => {
        let query = db
            .from("documents")
            .select("id, current_version_id")
            .is("archived_at", null);
        if (doc.project_id) {
            query = query.eq("project_id", doc.project_id);
            return doc.folder_id ? query.eq("folder_id", doc.folder_id) : query.is("folder_id", null);
        }
        query = query.eq("user_id", userId).is("project_id", null).eq("library_kind", "file");
        return doc.library_folder_id
            ? query.eq("library_folder_id", doc.library_folder_id)
            : query.is("library_folder_id", null);
    };
    const siblings = await selectAllByKey<{ id: string; current_version_id: string | null }>(
        "documents.convert.siblings",
        build,
    );
    const versions = await selectInBatches<{ filename: string | null }>(
        "documents.convert.names",
        siblings.map((row) => row.current_version_id),
        (batch) =>
            db.from("document_versions").select("filename").in("id", batch).is("deleted_at", null),
    );
    return new Set(versions.flatMap((v) => (v.filename ? [v.filename.toLowerCase()] : [])));
}

// --- the shared front: access, release, type --------------------------------

type Source = {
    doc: DocRow;
    version: ActiveVersion;
    sourceType: DocumentConversionType;
    pair: string;
    target: DocumentConversionType;
    canCreate: boolean;
};

/**
 * Open the document the way a download does, then check the pair. 404 for a
 * document the caller cannot see; 409 training_approval_required, as a download answers, for a
 * trainee's unapproved draft (a conversion is a copy that leaves the draft's seal behind).
 */
async function openSource(
    db: Db,
    args: { documentId: string; userId: string; userEmail: string | undefined; target: unknown },
): Promise<ServiceResult<Source>> {
    if (!isTarget(args.target)) return failure("validation", "target must be md, docx or pdf.");

    const access = await ensureDocumentAccess(args.documentId, args.userId, args.userEmail, db, {
        select:
            "id, user_id, project_id, org_id, workflow_id, current_version_id, folder_id, library_kind, library_folder_id, archived_at",
    });
    if (!access.ok) {
        if (access.kind === "error") return internalFailure(access.error);
        return failure("not_found", "Document not found");
    }
    const version = await loadActiveVersion(args.documentId, db);
    if (!version) return failure("not_found", "No file available");

    const releasable = await assertVersionReleasable(db, version);
    if (!releasable.ok) return releasable;

    const doc = access.doc as DocRow;
    const sourceType = sourceTypeOf(version.file_type);
    const pair = `${sourceType}>${args.target}`;
    // Workflow files and library templates are not filed like a person's documents.
    const filedAsDocument = !doc.workflow_id && (doc.library_kind ?? "file") === "file";
    if (!sourceType || !(pair in CONVERSION_LOSSES) || !filedAsDocument)
        return failure(
            "validation",
            "This document cannot be converted to that format.",
            CONVERT_NOT_SUPPORTED_CODE,
        );
    return ok({
        doc,
        version,
        sourceType,
        pair,
        target: args.target,
        canCreate: can(access.projectRole, "content.edit"),
    });
}

// --- preview ----------------------------------------------------------------

/**
 * What converting this document would lose, before anything is created: the
 * fixed list for the pair plus, for a Word file, the counts found inside it.
 */
export async function previewDocumentConversion(
    db: Db,
    args: { documentId: string; userId: string; userEmail: string | undefined; target: unknown },
): Promise<ServiceResult<DocumentConversionPreview>> {
    const opened = await openSource(db, args);
    if (!opened.ok) return opened;
    const { doc, version, sourceType, pair, target } = opened.data;

    let detected: DocumentConversionDetected | null = null;
    if (sourceType === "docx") {
        const bytes = await readSource(version, "docx");
        if (!bytes.ok) return bytes;
        try {
            // Unzipping a Word package is bounded only inside the parser process.
            detected = await runIsolatedExtraction("docxInventory", async () => bytes.data, { fileType: "docx" });
        } catch (error) {
            return conversionFailure(error);
        }
    }
    const textless = version.textless_page_count;
    const pages = version.page_count;
    const withoutText =
        sourceType === "pdf" && pages !== null && pages > 0 && textless !== null && textless >= pages;

    let newFilename: string;
    try {
        const locale = await readAnnexLocale(db, args.userId);
        newFilename = convertedFilename(
            version.filename,
            pair,
            locale,
            await namesInContainer(db, doc, args.userId),
        );
    } catch (error) {
        return internalFailure(error);
    }
    return ok({
        source_type: sourceType,
        target,
        losses: [...CONVERSION_LOSSES[pair]],
        detected,
        blocked: withoutText ? "pdf_without_text" : null,
        textless_page_count: sourceType === "pdf" ? textless : null,
        new_filename: newFilename,
    });
}

// --- conversion -------------------------------------------------------------

async function readSource(
    version: ActiveVersion,
    sourceType: DocumentConversionType,
): Promise<ServiceResult<ArrayBuffer>> {
    const cap = sourceType === "md" ? CONVERT_MAX_MARKDOWN_BYTES : CONVERT_MAX_SOURCE_BYTES;
    const tooLarge = failure(
        "validation",
        "The document is too large to convert.",
        CONVERT_SOURCE_TOO_LARGE_CODE,
    );
    if ((version.size_bytes ?? 0) > cap) return tooLarge;
    let bytes: ArrayBuffer | null;
    try {
        bytes = await downloadFile(version.storage_path);
    } catch (error) {
        return internalFailure(error);
    }
    if (!bytes) return failure("not_found", "Document bytes not available");
    return bytes.byteLength > cap ? tooLarge : ok(bytes);
}

/** A conversion that outlives the LibreOffice limit is abandoned, not awaited forever. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new ConversionError("conversion.timeout", "conversion timed out")),
                    uploadConversionTimeoutMs(),
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

type Converted = { bytes: Buffer; fileType: DocumentConversionType };

function pageLabels(markdown: string, locale: MethodologyLocale): string {
    // extractPdfMarkdown heads each page "## Page N"; in Spanish the new document says "Página".
    return locale === "es-MX" ? markdown.replace(/^## Page (\d+)$/gm, "## Página $1") : markdown;
}

async function produce(
    source: Source,
    bytes: ArrayBuffer,
    locale: MethodologyLocale,
    ocr: OcrFill | null,
): Promise<ServiceResult<Converted>> {
    const { pair, version } = source;
    const buffer = Buffer.from(bytes);
    switch (pair) {
        case "docx>md": {
            const text = await runIsolatedExtraction("docxMarkdown", async () => bytes, { fileType: "docx" });
            if (!text.trim())
                return failure("validation", "The Word file has no text to convert.", CONVERT_UNREADABLE_CODE);
            return ok({ bytes: Buffer.from(text, "utf8"), fileType: "md" });
        }
        case "pdf>md": {
            const text = await runIsolatedExtraction("documentMarkdown", async () => bytes, ocr ? { fileType: "pdf", ocr } : { fileType: "pdf" });
            if (!text.trim())
                return failure(
                    "validation",
                    "This PDF has no text, so it needs OCR before it can be converted.",
                    CONVERT_PDF_WITHOUT_TEXT_CODE,
                );
            return ok({ bytes: Buffer.from(pageLabels(text, locale), "utf8"), fileType: "md" });
        }
        case "md>docx":
            return ok({ bytes: await withTimeout(markdownToDocx(buffer.toString("utf8"))), fileType: "docx" });
        case "md>pdf": {
            const docx = await withTimeout(markdownToDocx(buffer.toString("utf8")));
            return ok({ bytes: await docxToPdf(docx), fileType: "pdf" });
        }
        default: {
            // docx>pdf: the version's own PDF when it has one.
            const stored = version.pdf_storage_path ? await downloadFile(version.pdf_storage_path) : null;
            return ok({ bytes: stored ? Buffer.from(stored) : await docxToPdf(buffer), fileType: "pdf" });
        }
    }
}

function conversionFailure(error: unknown): ServiceResult<never> {
    if (error instanceof ExtractionLimitError)
        return failure("validation", "The document is too large to convert.", CONVERT_SOURCE_TOO_LARGE_CODE);
    if (error instanceof ExtractionBusyError)
        return failure("unavailable", "Conversion is busy. Try again in a moment.", CONVERT_UNAVAILABLE_CODE);
    if (error instanceof ConversionError)
        return failure("unavailable", "Conversion is not available right now.", CONVERT_UNAVAILABLE_CODE);
    return failure("validation", "The document could not be read.", CONVERT_UNREADABLE_CODE);
}

/**
 * Convert the document's current version into a new document. Nothing about
 * the original changes. On any failure after the file was stored, the stored
 * file and the half-made document are removed.
 */
export async function convertDocument(
    db: Db,
    args: { documentId: string; userId: string; userEmail: string | undefined; target: unknown },
): Promise<ServiceResult<DocumentConversionResult>> {
    const opened = await openSource(db, args);
    if (!opened.ok) return opened;
    const source = opened.data;
    if (!source.canCreate) return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);

    const { doc, version, sourceType, pair } = source;
    if (
        sourceType === "pdf" &&
        version.page_count !== null &&
        version.page_count > 0 &&
        version.textless_page_count !== null &&
        version.textless_page_count >= version.page_count
    )
        return failure(
            "validation",
            "This PDF has no text, so it needs OCR before it can be converted.",
            CONVERT_PDF_WITHOUT_TEXT_CODE,
        );

    const bytes = await readSource(version, sourceType);
    if (!bytes.ok) return bytes;

    let locale: MethodologyLocale;
    let filename: string;
    try {
        locale = await readAnnexLocale(db, args.userId);
        filename = convertedFilename(version.filename, pair, locale, await namesInContainer(db, doc, args.userId));
    } catch (error) {
        return internalFailure(error);
    }

    let converted: ServiceResult<Converted>;
    try {
        const ocr =
            sourceType === "pdf" && version.text_revision
                ? await loadReadScan(db, version.id, version.text_revision)
                : null;
        converted = await produce(source, bytes.data, locale, ocr);
    } catch (error) {
        logError("document-convert", safeError(error));
        return conversionFailure(error);
    }
    if (!converted.ok) return converted;
    const { bytes: output, fileType } = converted.data;

    return storeDerivedDocument(db, {
        doc,
        userId: args.userId,
        filename,
        bytes: output,
        fileType,
        source: "converted",
    });
}

/**
 * Store `bytes` as a NEW document next to `doc` (same project and folder, or
 * the same library folder), version 1, with the given `source`. On a failure
 * after the file was stored, the stored file and the half-made document are
 * removed. Shared by the conversion, the comparison and the split.
 */
export async function storeDerivedDocument(
    db: Db,
    args: {
        doc: DocRow;
        userId: string;
        filename: string;
        bytes: Buffer;
        fileType: DocumentConversionType;
        source: "converted" | "compared" | "split";
        /** A PDF that is made from known pages (a split): its page count. */
        pageCount?: number;
    },
): Promise<ServiceResult<DocumentConversionResult>> {
    const { doc, filename, bytes: output, fileType, source } = args;
    const label = source === "compared" ? "compare" : source === "split" ? "split" : "convert";
    const documentId = randomUUID();
    const key = versionStorageKey(args.userId, documentId, randomUUID().replace(/-/g, ""), filename);
    try {
        await uploadFile(
            key,
            output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer,
            contentTypeForDocumentType(fileType),
        );
    } catch (error) {
        return internalFailure(
            new AppError("storage.write_failed", `[documents/${label}] storage write failed`, { cause: error }),
        );
    }
    const discard = async () => {
        await deleteFile(key).catch((err) => logError(`document-${label}`, safeError(err)));
    };

    const { error: insertError } = await db.from("documents").insert({
        id: documentId,
        project_id: doc.project_id,
        org_id: doc.org_id ?? null,
        user_id: args.userId,
        status: "ready",
        folder_id: doc.project_id ? (doc.folder_id ?? null) : null,
        library_kind: "file",
        library_folder_id: doc.project_id ? null : (doc.library_folder_id ?? null),
    });
    if (insertError) {
        await discard();
        return internalFailure(insertError);
    }

    const { data: created, error: versionError } = await createDocumentVersion(db, {
        authorship: { kind: "author", userId: args.userId },
        document_id: documentId,
        storage_path: key,
        pdf_storage_path: null,
        source,
        version_number: 1,
        filename,
        file_type: fileType,
        size_bytes: output.byteLength,
        page_count: args.pageCount ?? null,
        textless_page_count: null,
        content_sha256: contentSha256(output),
    });
    if (versionError || !created) {
        const removed = await deleteDocumentAndVersionFiles(db, documentId);
        if (removed.error) logError(`document-${label}`, safeError(removed.error));
        await discard();
        return internalFailure(
            new AppError("db.rpc_failed", `[documents/${label}] version insert failed`, {
                cause: versionError ?? new Error("version_insert_returned_no_data"),
            }),
        );
    }
    return ok({
        document_id: documentId,
        version_id: created.id,
        filename,
        file_type: fileType,
        size_bytes: output.byteLength,
        project_id: doc.project_id,
        folder_id: doc.project_id ? (doc.folder_id ?? null) : (doc.library_folder_id ?? null),
    });
}
