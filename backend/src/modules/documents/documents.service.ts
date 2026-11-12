// Business logic + data-access for the documents module.
//
// These functions are the service layer behind documents.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the storage / version / conversion orchestration, and RETURN values or
// typed error results. They never touch req/res — the thin route handlers map
// the results onto HTTP status codes, headers, and response bodies.
//
// This file is the module's stable facade: the implementation is decomposed
// into cohesive sibling files and re-exported here so importers never change.
//
//   documents.shared.ts    — shared types and helpers
//   documents.access.ts    — access guards + list/delete document
//   documents.download.ts  — display bytes, zip bundling, signed URLs, raw file
//   documents.versions.ts  — version lifecycle (list/create/rename/delete)
//   documents.edits.ts     — tracked-change ids + accept/reject edits
//   documents.trackedEdits.ts — apply tracked-change edits as a new version
//   documents.trainingApproval.ts — approve a pasante's sealed version
//   documents.authorship.ts — estimated authorship of a version (training)
//   documents.convert.ts   — convert between Markdown, Word and PDF as a new document
//   documents.compare.ts   — compare two Word files into a new one with tracked changes
//
// Upload sessions own transport and destination authorization; version metadata
// creation, activation, replacement, copying, and cleanup use this facade.

export {
    getDocument,
    deleteDocument,
} from "./documents.access";

export {
    getDisplayableVersion,
    resolveZipExportDocuments,
    getDownloadUrl,
    getFileStreamSource,
} from "./documents.download";

export {
    listVersions,
    createVersionFromDocument,
    renameVersion,
    deleteVersion,
} from "./documents.versions";

export {
    resolveEdit,
} from "./documents.edits";

export {
    applyTrackedEditsToDocument,
    loadCurrentVersionBytes,
} from "./documents.trackedEdits";

export {
    saveMarkdownEdit,
    compareVersionTexts,
    isVersionConflict,
    VERSION_CONFLICT_CODE,
} from "./documents.markdown";

export {
    previewDocumentConversion,
    convertDocument,
} from "./documents.convert";

export { compareDocuments } from "./documents.compare";

export { renameDocument } from "./documents.rename";
export { deleteCollectionDocuments } from "./documents.cleanup";

export { handleDocumentPrecomputeText } from "./documents.textJobs";
export { handleConversionConvert, markConversionFailed } from "./documents.conversionJobs";
export { sweepStaleProcessingDocuments } from "./documents.maintenance";

export { createDocumentVersion } from "./documents.lifecycle";
export { handleDocumentCleanup } from "./documents.cleanupJobs";
export { copyDocumentVersionFiles } from "./documents.copyFiles";
export { captureInlineDocumentCleanup, completeInlineDocumentCleanup } from "./documents.cleanupJobs";
export { createDocumentVersions, activateDocumentVersion, updateDocumentVersion } from "./documents.lifecycle";
export type { VersionAuthorship } from "./documents.lifecycle";
export { approveTrainingVersion } from "./documents.trainingApproval";
export { getDocumentAuthorship } from "./documents.authorship";

export { runConversionJob, setDocumentTerminalStatus } from "./documents.conversion";

export { handleDocumentExtractText, markDocumentTextFailed, backfillDocumentText } from "./documents.indexing";
export { findDocumentText, readStoredDocumentText, storedDocumentTextCurrent } from "./documents.textSearch";

export { getDocumentStatuses } from "./documents.status";
