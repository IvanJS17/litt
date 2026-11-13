// Split a case file (layer 7, docs/document-split.md). A PDF that holds several
// documents is split in three steps, none of which touches the original:
//
//   getSplitState        GET   local only: pages, characters, estimated cost,
//                              the types, whether a key is there. Nothing leaves LiTT.
//   proposeSplit         POST  sends the TEXT of the document to LandingAI Split
//                              (synchronously, only when the person asks) and returns its
//                              proposal. Nothing is stored.
//   createSplitDocuments POST  receives the groups the person confirmed (page
//                              numbers, names, types) and makes one NEW PDF per group with the
//                              original pages, version 1, source 'split'. The text already
//                              read (scan reading) is copied to each new document at no cost.
//
// Nothing the client sends is trusted but page numbers, names and types: the
// version, the access, the key and the types are all checked again here.
import { recordAudit } from "../../lib/audit";
import type { DocumentSplitCreateGroup, DocumentSplitCreateResult, DocumentSplitProposal, DocumentSplitState } from "@mike/contracts";
import { loadActiveVersion, type ActiveVersion } from "../../lib/documentVersions";
import { ExtractionBusyError, ExtractionLimitError, runIsolatedExtraction } from "../../lib/extraction/isolated";
import { logError } from "../../lib/log";
import { resolveScanKey } from "../../lib/ocr/key";
import { OcrError, type OcrErrorCode } from "../../lib/ocr/landingai";
import { splitWithLandingAi } from "../../lib/ocr/landingaiSplit";
import { SPLIT_MAX_MARKDOWN_BYTES, SPLIT_MAX_PAGES, buildSplitMarkdown, estimateSplitCost, type OcrFill } from "../../lib/ocr/pages";
import { resolveSplitClasses } from "../../lib/ocr/splitClassStore";
import { can, DOCUMENT_EDIT_FORBIDDEN } from "../../lib/permissions";
import { safeError } from "../../lib/safeError";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { downloadFile } from "../../lib/storage";
import { assertVersionReleasable } from "../../lib/trainingRelease";
import { ensureDocumentAccess } from "./documents.access";
import { CONVERT_MAX_SOURCE_BYTES, namesInContainer, storeDerivedDocument, type DocRow } from "./documents.convert";
import { VERSION_CONFLICT_CODE } from "./documents.markdown";
import { OCR_KEY_MISSING_CODE, publishReading } from "./documents.ocr";
import { copyReadingToSplitVersion, loadReadScan, loadScanRow } from "./documents.ocr.state";
import { deleteDocumentAndVersionFiles, type Db } from "./documents.shared";

export const SPLIT_NOT_SUPPORTED_CODE = "split_not_supported";
export const SPLIT_TOO_LARGE_CODE = "split_too_large";
export const SPLIT_NEEDS_SCAN_READING_CODE = "split_needs_scan_reading";
export const SPLIT_INVALID_GROUPS_CODE = "split_invalid_groups";

const MAX_NAME_CHARS = 150;

type Args = { documentId: string; userId: string; userEmail: string | undefined };

type Target = { doc: DocRow; version: ActiveVersion; canEdit: boolean };

/** Open the document the way a download does; a PDF filed as a document, and not held for training. */
async function openTarget(db: Db, args: Args): Promise<ServiceResult<Target>> {
    const access = await ensureDocumentAccess(args.documentId, args.userId, args.userEmail, db, {
        select: "id, user_id, project_id, org_id, workflow_id, current_version_id, folder_id, library_kind, library_folder_id, archived_at",
    });
    if (!access.ok) {
        if (access.kind === "error") return internalFailure(access.error);
        return failure("not_found", "Document not found");
    }
    const version = await loadActiveVersion(args.documentId, db);
    if (!version) return failure("not_found", "No file available");
    // A version held for training is not sent anywhere, nor copied, until it is approved.
    const releasable = await assertVersionReleasable(db, version);
    if (!releasable.ok) return releasable;
    const doc = access.doc as DocRow;
    const filedAsDocument = !doc.workflow_id && (doc.library_kind ?? "file") === "file";
    if ((version.file_type ?? "").toLowerCase() !== "pdf" || !filedAsDocument)
        return failure("validation", "Only a PDF can be split.", SPLIT_NOT_SUPPORTED_CODE);
    return ok({ doc, version, canEdit: can(access.projectRole, "content.edit") });
}

const tooLarge = () => failure("validation", "The document is too large to split.", SPLIT_TOO_LARGE_CODE);

function extractionFailure(error: unknown): ServiceResult<never> {
    if (error instanceof ExtractionLimitError) return tooLarge();
    if (error instanceof ExtractionBusyError) return failure("unavailable", "Splitting is busy. Try again in a moment.", "ocr_unavailable");
    logError("document-split", safeError(error));
    return failure("validation", "The document could not be read.", SPLIT_NOT_SUPPORTED_CODE);
}

async function readSource(version: ActiveVersion): Promise<ServiceResult<ArrayBuffer>> {
    if ((version.size_bytes ?? 0) > CONVERT_MAX_SOURCE_BYTES) return tooLarge();
    let bytes: ArrayBuffer | null;
    try {
        bytes = await downloadFile(version.storage_path);
    } catch (error) {
        return internalFailure(error);
    }
    if (!bytes) return failure("not_found", "Document bytes not available");
    return bytes.byteLength > CONVERT_MAX_SOURCE_BYTES ? tooLarge() : ok(bytes);
}

type Text = { bytes: ArrayBuffer; pages: string[]; unread: number[]; markdown: string; ocr: OcrFill | null };

/** The text Split would read: pdf.js where a page has text, the scan reading where it has not. */
async function readText(db: Db, version: ActiveVersion): Promise<ServiceResult<Text>> {
    const source = await readSource(version);
    if (!source.ok) return source;
    try {
        const ocr = version.text_revision ? await loadReadScan(db, version.id, version.text_revision) : null;
        const read = await runIsolatedExtraction("pdfPageTexts", async () => source.data, ocr ? { fileType: "pdf", ocr } : { fileType: "pdf" });
        return ok({ bytes: source.data, pages: read.pages, unread: read.unread, markdown: buildSplitMarkdown(read.pages), ocr });
    } catch (error) {
        return extractionFailure(error);
    }
}

const overLimits = (text: Text) => text.pages.length > SPLIT_MAX_PAGES || Buffer.byteLength(text.markdown) > SPLIT_MAX_MARKDOWN_BYTES;

// --- GET: what splitting would do, locally -----------------------------------

export async function getSplitState(db: Db, args: Args): Promise<ServiceResult<DocumentSplitState>> {
    try {
        const opened = await openTarget(db, args);
        if (!opened.ok) return opened;
        const { doc, version, canEdit } = opened.data;
        const text = await readText(db, version);
        if (!text.ok) return text;
        const classes = await resolveSplitClasses(db, args.userId, doc.org_id);
        const characters = text.data.markdown.length;
        const cost = estimateSplitCost(characters);
        return ok({
            version_id: version.id,
            page_count: text.data.pages.length,
            characters,
            estimated_credits: cost.credits,
            estimated_cost_usd: cost.usd,
            unread_pages: text.data.unread.length,
            needs_scan_reading: text.data.unread.length > 0,
            too_large: overLimits(text.data),
            key_available: (await resolveScanKey(db, args.userId, doc.org_id)) !== null,
            can_edit: canEdit,
            classes: classes.classes,
            classes_source: classes.source,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

// --- POST: the proposal ------------------------------------------------------

function splitCallFailure(error: unknown): ServiceResult<never> {
    if (!(error instanceof OcrError)) return internalFailure(error);
    const messages: Record<OcrErrorCode, string> = {
        ocr_key_invalid: "LandingAI did not accept the key.",
        ocr_no_credits: "The LandingAI account has no credits.",
        ocr_unavailable: "LandingAI is not available right now.",
        ocr_too_large: "The document is too large to split.",
        ocr_not_supported: "LandingAI could not split this document.",
        split_too_large: "The document is too large to split.",
    };
    return failure(error.code === "ocr_unavailable" ? "unavailable" : "validation", messages[error.code], error.code);
}

/**
 * Ask LandingAI to propose how to split the document. Called only when the
 * person presses the button (no preloading, no retries). The proposal is
 * returned, never stored.
 */
export async function proposeSplit(db: Db, args: Args): Promise<ServiceResult<DocumentSplitProposal>> {
    try {
        const opened = await openTarget(db, args);
        if (!opened.ok) return opened;
        const { doc, version, canEdit } = opened.data;
        if (!canEdit) return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);
        // The same key as the scan reading: the firm's first, then the member's own where the firm allows it.
        const key = await resolveScanKey(db, args.userId, doc.org_id);
        if (key === null) return failure("conflict", "Add a LandingAI key in Settings to split a document.", OCR_KEY_MISSING_CODE);
        const text = await readText(db, version);
        if (!text.ok) return text;
        if (text.data.unread.length > 0)
            return failure("conflict", "Read the scanned pages first.", SPLIT_NEEDS_SCAN_READING_CODE);
        if (overLimits(text.data)) return tooLarge();

        const { classes } = await resolveSplitClasses(db, args.userId, doc.org_id);
        let result;
        try {
            result = await splitWithLandingAi(key, text.data.markdown, text.data.pages.length, classes);
        } catch (error) {
            return splitCallFailure(error);
        }
        await recordAudit(db, {
            userId: args.userId,
            userEmail: args.userEmail ?? null,
            action: "document.split_sent",
            // Which document and how much; never the text, the key or the file name.
            detail: { document_id: doc.id, version_id: version.id, org_id: doc.org_id ?? null, characters: text.data.markdown.length, credits: result.credits },
        });
        return ok({ version_id: version.id, page_count: text.data.pages.length, groups: result.groups, classes, credits: result.credits });
    } catch (error) {
        return internalFailure(error);
    }
}

// --- POST: create the documents ----------------------------------------------

const invalid = (detail: string) => failure("validation", detail, SPLIT_INVALID_GROUPS_CODE);

/** A file name a person typed, made safe: no path, no control characters, no .pdf twice. */
export function cleanSplitName(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.pdf$/i, "")
        .trim()
        .slice(0, MAX_NAME_CHARS)
        .trim();
}

/** `name.pdf`, then `name (2).pdf`… until it differs from every name taken; the chosen name joins `taken`. */
export function uniquePdfName(name: string, taken: Set<string>): string {
    for (let counter = 1; ; counter++) {
        const candidate = `${name}${counter > 1 ? ` (${counter})` : ""}.pdf`;
        if (!taken.has(candidate.toLowerCase())) {
            taken.add(candidate.toLowerCase());
            return candidate;
        }
    }
}

type CheckedGroup = { pages: number[]; name: string };

/** Only page numbers, names and types are read from the body; everything is checked against this exact version. */
function checkGroups(body: unknown, pageCount: number, typeNames: ReadonlySet<string>): ServiceResult<CheckedGroup[]> {
    const groups = (body as { groups?: unknown } | null)?.groups as DocumentSplitCreateGroup[] | undefined;
    if (!Array.isArray(groups) || groups.length === 0) return invalid("Choose at least one document to create.");
    if (groups.length > pageCount) return invalid("There are more documents than pages.");
    const seen = new Set<number>();
    const checked: CheckedGroup[] = [];
    for (const group of groups) {
        if (!group || typeof group !== "object") return invalid("Each document needs pages, a name and a type.");
        const { pages, type } = group;
        if (!Array.isArray(pages) || pages.length === 0) return invalid("Each document needs at least one page.");
        for (const page of pages) {
            if (!Number.isInteger(page) || page < 1 || page > pageCount) return invalid("A page is not in this document.");
            if (seen.has(page)) return invalid("A page cannot be in two documents.");
            seen.add(page);
        }
        if (type !== null && (typeof type !== "string" || !typeNames.has(type))) return invalid("The type is not in the list.");
        const name = cleanSplitName(group.name);
        if (!name) return invalid("Each document needs a name.");
        checked.push({ pages: [...pages].sort((a, b) => a - b), name });
    }
    // In the order of the original.
    return ok(checked.sort((a, b) => a.pages[0] - b.pages[0]));
}

/** The number of pages of the exact version, from what the upload recorded or, failing that, from the file. */
async function pageCountOf(version: ActiveVersion, bytes: ArrayBuffer): Promise<number> {
    if (version.page_count && version.page_count > 0) return version.page_count;
    return (await runIsolatedExtraction("pdfTextlessPages", async () => bytes, { fileType: "pdf" })).total;
}

export async function createSplitDocuments(
    db: Db,
    args: Args & { versionId: unknown; body: unknown },
): Promise<ServiceResult<DocumentSplitCreateResult>> {
    try {
        const opened = await openTarget(db, args);
        if (!opened.ok) return opened;
        const { doc, version, canEdit } = opened.data;
        if (!canEdit) return failure("forbidden", DOCUMENT_EDIT_FORBIDDEN);
        // The proposal was made on one version; if another is current now, its pages may be other pages.
        if (typeof args.versionId !== "string" || args.versionId !== version.id)
            return failure("conflict", "The document changed after the proposal. Split it again.", VERSION_CONFLICT_CODE);

        const source = await readSource(version);
        if (!source.ok) return source;
        let pageCount: number;
        try {
            pageCount = await pageCountOf(version, source.data);
        } catch (error) {
            return extractionFailure(error);
        }
        const { classes } = await resolveSplitClasses(db, args.userId, doc.org_id);
        const checked = checkGroups(args.body, pageCount, new Set(classes.map((c) => c.name)));
        if (!checked.ok) return checked;

        let files: Uint8Array[];
        try {
            files = await runIsolatedExtraction("pdfCopyPages", async () => source.data, {
                fileType: "pdf",
                args: { groups: checked.data.map((g) => g.pages) },
            });
        } catch (error) {
            return extractionFailure(error);
        }

        const taken = await namesInContainer(db, doc, args.userId);
        const reading = version.text_revision ? await loadScanRow(db, version.id) : null;
        const usable = reading && reading.source_revision === version.text_revision && reading.pages !== null ? reading : null;
        const created: DocumentSplitCreateResult["documents"] = [];
        // All or nothing: if one document cannot be made, the ones already made are removed.
        const rollback = async () => {
            for (const made of created) {
                const removed = await deleteDocumentAndVersionFiles(db, made.document_id);
                if (removed.error) logError("document-split", safeError(removed.error));
            }
        };
        for (const [index, group] of checked.data.entries()) {
            const stored = await storeDerivedDocument(db, {
                doc,
                userId: args.userId,
                filename: uniquePdfName(group.name, taken),
                bytes: Buffer.from(files[index]),
                fileType: "pdf",
                source: "split",
                pageCount: group.pages.length,
            });
            if (!stored.ok) {
                await rollback();
                return stored;
            }
            created.push(stored.data);
            if (usable) {
                try {
                    await copyReadingToSplitVersion(db, { from: usable, sourcePages: group.pages, versionId: stored.data.version_id, userId: args.userId });
                } catch (error) {
                    await rollback();
                    return internalFailure(error);
                }
            }
        }
        // The text of each new document is read once more, now with its copied reading,
        // which also leaves the right count of pages without text. The queued extraction
        // does the same; this makes the result independent of which runs first.
        for (const made of created) await publishNewVersion(db, made.version_id);
        return ok({ documents: created });
    } catch (error) {
        return internalFailure(error);
    }
}

async function publishNewVersion(db: Db, versionId: string): Promise<void> {
    try {
        const { data } = await db.from("document_versions").select("text_revision,storage_path,content_sha256").eq("id", versionId).maybeSingle();
        const row = data as { text_revision?: string; storage_path?: string; content_sha256?: string | null } | null;
        if (!row?.text_revision || !row.storage_path) return;
        await publishReading(db, { versionId, revision: row.text_revision, storage_path: row.storage_path, content_sha256: row.content_sha256 ?? null });
    } catch (error) {
        // Not fatal: the extraction job the new version queued does the same work.
        logError("document-split", safeError(error));
    }
}
