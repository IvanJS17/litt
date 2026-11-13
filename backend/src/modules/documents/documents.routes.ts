// HTTP layer for the documents module. Handlers parse params/query/body,
// call the service functions behind documents.service.ts, and map their typed
// results onto status codes, headers, and response bodies. The one piece of
// logic that stays here is the download-zip streaming loop, because it exists
// to apply `res` backpressure to the object-storage reads.

import { Router } from "express";
import type { ParamsFlatDictionary } from "express-serve-static-core";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import { sendInternalError } from "../../lib/httpError";
import { setOperation } from "../../lib/observability/report";
import { buildContentDisposition, createFileReadStream } from "../../lib/storage";
import { sendDocumentDisplay } from "../../lib/documentDisplay";
import { contentTypeForDocumentType } from "../../lib/documentTypes";
import { uniqueArchiveFilename } from "../../lib/zipExport";
import {
    getDocument,
    getDocumentStatuses,
    deleteDocument,
    getDisplayableVersion,
    resolveZipExportDocuments,
    getDownloadUrl,
    getFileStreamSource,
    listVersions,
    createVersionFromDocument,
    renameVersion,
    deleteVersion,
    resolveEdit,
    approveTrainingVersion,
    getDocumentAuthorship,
    saveMarkdownEdit,
    compareVersionTexts,
    previewDocumentConversion,
    convertDocument,
    compareDocuments,
    getScanReadingState,
    requestScanReading,
    getSplitState,
    proposeSplit,
    createSplitDocuments,
} from "./documents.service";

export const documentsRouter = Router();

// One bounded poll replaces a request per converting document.
documentsRouter.post("/status", requireAuth, asyncRoute(async (req, res) => {
    const result = await getDocumentStatuses(createServerSupabase(), {
        documentIds: req.body?.document_ids,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

// GET /single-documents/:documentId
// One document, same shape as a list entry — the client polls this while a
// deferred conversion runs instead of refetching the whole collection.
documentsRouter.get("/:documentId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();

    const result = await getDocument(documentId, userId, userEmail, db);
    if (!result.ok) {
        if (result.kind === "error") return void sendInternalError(res, result.error);
        if (result.kind === "forbidden")
            return void res.status(403).json({ detail: "You do not have access to this document." });
        return void res.status(404).json({ detail: "Document not found" });
    }
    res.json(result.doc);
}));

// POST /single-documents is intentionally absent: multipart upload was
// replaced by the direct object-storage upload-session protocol, and app.ts
// answers 410 on the former path before any body parser reads file bytes.

// DELETE /single-documents/:documentId
documentsRouter.delete("/:documentId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();

    const result = await deleteDocument(documentId, userId, db, userEmail);
    if (!result.ok) {
        if ("kind" in result && result.kind === "forbidden")
            return void res.status(403).json({ detail: result.detail });
        if (result.error) return void sendInternalError(res, result.error);
        return void res.status(404).json({ detail: "Document not found" });
    }
    res.status(204).send();
}));

// GET /single-documents/:documentId/display
// Optional ?version_id= renders a historical version. Defaults to the
// document's current_version_id.
documentsRouter.get("/:documentId/display", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;
    const { documentId } = req.params;
    const versionIdParam =
        typeof req.query.version_id === "string" ? req.query.version_id : null;
    const db = createServerSupabase();

    const result = await getDisplayableVersion(
        documentId,
        userId,
        userEmail,
        versionIdParam,
        db,
    );
    if (!result.ok) {
        if (result.kind === "error")
            return void sendInternalError(res, result.error);
        return void res.status(404).json({ detail: result.detail });
    }
    if (result.held) res.setHeader("Cache-Control", "no-store");
    sendDocumentDisplay(res, result.display);
}));

// GET /single-documents/:documentId/file
// Streams the active version's source bytes, or a specific version selected
// with ?version_id=. Unlike /display, this never substitutes a generated PDF
// rendition. Proxying through the API also lets browser viewers and editors
// fetch the file without depending on cross-origin access to signed R2 URLs.
// The service locates and sizes the object; the stream is opened here so
// `res` is what applies backpressure to the object-storage read.
documentsRouter.get("/:documentId/file", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const versionIdParam =
        typeof req.query.version_id === "string" ? req.query.version_id : null;
    const db = createServerSupabase();

    const result = await getFileStreamSource(
        documentId,
        userId,
        userEmail,
        versionIdParam,
        db,
    );
    if (!result.ok)
        return void res.status(404).json({ detail: result.detail });

    res.setHeader("Content-Type", contentTypeForDocumentType(result.fileType));
    res.setHeader("Content-Length", result.size);
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("inline", result.filename),
    );
    // A pasante's unapproved draft is viewed, not kept (docs/training.md).
    if (result.held) res.setHeader("Cache-Control", "no-store");
    const source = createFileReadStream(result.storagePath);
    try {
        await pipeline(source, res);
    } catch (error) {
        source.destroy();
        if (!res.headersSent && !res.destroyed) {
            return void sendInternalError(res, error);
        }
    }
}));

// POST /single-documents/download-zip
// Accepts `document_ids` and/or `folder_ids`; folders expand to every
// document beneath them. Synchronous zip, kept for small selections (instant
// download, no polling). Large selections go through the durable
// "documents-zip" export job instead.
documentsRouter.post("/download-zip", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { document_ids, folder_ids } = req.body as {
        document_ids?: string[];
        folder_ids?: string[];
    };
    const documentIds = Array.isArray(document_ids)
        ? [...new Set(document_ids.filter((id) => typeof id === "string"))]
        : [];
    const folderIds = Array.isArray(folder_ids)
        ? [...new Set(folder_ids.filter((id) => typeof id === "string"))]
        : [];

    if (documentIds.length === 0 && folderIds.length === 0)
        return void res
            .status(400)
            .json({ detail: "document_ids or folder_ids is required" });

    const db = createServerSupabase();
    const result = await resolveZipExportDocuments(
        { documentIds, folderIds, userId, userEmail },
        db,
    );
    if (!result.ok) {
        if (result.kind === "internal")
            return void sendInternalError(res, result.error);
        if (result.kind === "conflict")
            return void sendServiceFailure(res, result);
        const status = result.kind === "limit" ? 413 : 404;
        return void res.status(status).json({ detail: result.detail });
    }

    // Streaming lives here rather than in the service: each entry is read
    // lazily from object storage and the archive is piped straight into `res`,
    // so the response object is what applies backpressure. Nothing is
    // buffered, and STORE (no deflate) keeps already-compressed office files
    // from being recompressed.
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const usedNames = new Set<string>();
    const fileStreams = result.entries.map((entry) => {
        const stream = createFileReadStream(entry.storagePath);
        zip.file(uniqueArchiveFilename(entry.filename, usedNames), stream, {
            compression: "STORE",
        });
        return stream;
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="documents.zip"');
    const archiveStream = zip.generateNodeStream({
        type: "nodebuffer",
        streamFiles: true,
        compression: "STORE",
    }) as Readable;
    try {
        await pipeline(archiveStream, res);
    } catch (error) {
        // Destroy the per-file readers so a failed archive does not leave
        // object-storage GETs open. Once bytes are on the wire the status is
        // already sent, so only a pre-headers failure can be reported.
        for (const stream of fileStreams) stream.destroy();
        if (!res.headersSent && !res.destroyed) {
            return void sendInternalError(res, error);
        }
    }
}));

// GET /single-documents/:documentId/url
// Optional ?version_id= selects a specific tracked-changes version.
// Otherwise falls back to documents.current_version_id, else the original upload.
documentsRouter.get("/:documentId/url", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const versionIdParam =
        typeof req.query.version_id === "string" ? req.query.version_id : null;
    const db = createServerSupabase();

    const result = await getDownloadUrl(
        documentId,
        userId,
        userEmail,
        versionIdParam,
        db,
    );
    if (!result.ok) {
        if (result.kind === "storage")
            return void res.status(503).json({ detail: result.detail });
        if (result.kind === "not_found")
            return void res.status(404).json({ detail: result.detail });
        return void sendServiceFailure(res, result);
    }
    res.json(result.payload);
}));

// GET /single-documents/:documentId/versions
// Returns every version row for the document in document order, with
// the human-friendly version number when present.
documentsRouter.get("/:documentId/versions", requireAuth, asyncRoute(async (req, res) => {
    setOperation("documents.version");
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();

    const result = await listVersions(documentId, userId, userEmail, db);
    if (!result.ok)
        return void res.status(404).json({ detail: result.detail });

    res.json({
        current_version_id: result.current_version_id,
        versions: result.versions,
    });
}));

// POST /single-documents/:documentId/versions/from-document
// Create a new version of documentId from another existing document's active
// bytes. This keeps signed storage URLs out of the browser fetch path.
documentsRouter.post(
    "/:documentId/versions/from-document",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.version");
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { documentId } = req.params;
        const sourceDocumentId =
            typeof req.body?.source_document_id === "string"
                ? req.body.source_document_id
                : "";
        const db = createServerSupabase();

        if (!sourceDocumentId) {
            return void res
                .status(400)
                .json({ detail: "source_document_id is required" });
        }
        if (sourceDocumentId === documentId) {
            return void res
                .status(400)
                .json({ detail: "Source and target documents must be different." });
        }

        const result = await createVersionFromDocument(
            {
                documentId,
                sourceDocumentId,
                requestedFilename:
                    typeof req.body?.filename === "string"
                        ? req.body.filename
                        : null,
                userId,
                userEmail,
            },
            db,
        );
        if (!result.ok) {
            // The 500s carry their cause: one report, with the kind and the
            // failing dependency's code, instead of a bare detail string.
            if ("error" in result)
                return void sendInternalError(res, result.error);
            const status =
                result.kind === "source_not_owner" ||
                result.kind === "target_forbidden"
                    ? 403
                    : 404;
            return void res.status(status).json({ detail: result.detail });
        }
        res.status(201).json(result.version);
    }),
);

// GET /single-documents/:documentId/versions/compare?base=<id>&head=<id>
// Read-only: the stored text of two versions, for the compare view. Declared
// before the :versionId routes so "compare" is never read as a version id.
documentsRouter.get(
    "/:documentId/versions/compare",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.version_compare");
        const result = await compareVersionTexts(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            baseVersionId: req.query.base,
            headVersionId: req.query.head,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/versions/markdown
// Save an edit of a Markdown document as a new `user_edit` version. Body:
// { text, base_version_id }. 409 document_version_conflict when the base is
// no longer the current version.
documentsRouter.post(
    "/:documentId/versions/markdown",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.version_markdown");
        const result = await saveMarkdownEdit(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            text: req.body?.text,
            baseVersionId: req.body?.base_version_id,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.status(201).json(result.data);
    }),
);

// GET /single-documents/:documentId/convert/preview?target=md|docx|pdf
// What converting would lose, before anything is created. Same access as a
// download: 404 without access, 409 training_approval_required for a trainee's
// unapproved draft, 400 convert_not_supported for a pair that does not exist.
documentsRouter.get(
    "/:documentId/convert/preview",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.format_convert_preview");
        const result = await previewDocumentConversion(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            target: req.query.target,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/convert
// Body { target }. Creates a NEW document (version 1, source 'converted') in
// the original's project and folder; the original is not changed.
documentsRouter.post(
    "/:documentId/convert",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.format_convert");
        const result = await convertDocument(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            target: req.body?.target,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.status(201).json(result.data);
    }),
);

// GET /single-documents/:documentId/ocr
// Scan reading: whether pages without text can be read with the caller\'s own
// LandingAI key, whether a reading is running or failed, and its estimated cost.
// Same access as opening the document; the key itself is never returned.
documentsRouter.get(
    "/:documentId/ocr",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.ocr_state");
        const result = await getScanReadingState(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/ocr
// Starts reading the document\'s scanned pages in the background (202). Edit
// rights, as for converting; 409 training_approval_required for a version held
// for training; 409 ocr_key_missing without a usable key; 400 ocr_not_supported
// when there is nothing to read; 400 ocr_too_large over the size cap.
documentsRouter.post(
    "/:documentId/ocr",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.ocr_start");
        const result = await requestScanReading(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.status(202).json(result.data);
    }),
);

// GET /single-documents/:documentId/split
// Separar expediente, step 1 (docs/document-split.md): pages, characters, the
// estimated cost and the document types, computed here. Nothing is sent to
// LandingAI. Same access as opening the document.
documentsRouter.get(
    "/:documentId/split",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.split_state");
        const result = await getSplitState(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/split
// Step 2: sends the document's TEXT to LandingAI Split, with the caller's key
// or the firm's, only because the caller asked, and returns its proposal.
// Nothing is stored or created. Edit rights; 409 training_approval_required for
// a version held for training; 409 ocr_key_missing without a key; 409
// split_needs_scan_reading while scanned pages are unread; 400 split_too_large /
// split_not_supported; LandingAI's refusals as ocr_key_invalid / ocr_no_credits
// (400) and ocr_unavailable (503).
documentsRouter.post(
    "/:documentId/split",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.split_propose");
        const result = await proposeSplit(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/split/create
// Step 3. Body { version_id, groups: [{ pages, name, type }] }: the groups the
// person confirmed. Creates one NEW PDF per group with the original pages
// (version 1, source 'split') in the original's folder; the original does not
// change. 201. 409 document_version_conflict if version_id is no longer current;
// 400 split_invalid_groups.
documentsRouter.post(
    "/:documentId/split/create",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.split_create");
        const result = await createSplitDocuments(createServerSupabase(), {
            documentId: req.params.documentId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            versionId: req.body?.version_id,
            body: req.body,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.status(201).json(result.data);
    }),
);

// POST /single-documents/:documentId/compare
// Body { against_document_id }. Compares the current version of :documentId (the
// original) with that of the other document (the negotiated one) and creates a NEW
// Word document with the differences as tracked changes (version 1, source
// 'compared'). Neither source changes. Same access as a download for BOTH
// documents; edit rights where the original lives; both in the same project.
documentsRouter.post(
    "/:documentId/compare",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.compare");
        const result = await compareDocuments(createServerSupabase(), {
            documentId: req.params.documentId,
            againstDocumentId: req.body?.against_document_id,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.status(201).json(result.data);
    }),
);

// POST /single-documents/:documentId/versions/:versionId/training-approval
// Approve a pasante's version as it is now (docs/training.md).
documentsRouter.post(
    "/:documentId/versions/:versionId/training-approval",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.training_approval");
        const result = await approveTrainingVersion(createServerSupabase(), {
            documentId: req.params.documentId,
            versionId: req.params.versionId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.json(result.data);
    }),
);

// GET /single-documents/:documentId/versions/:versionId/authorship
// Estimated share of the version that came from the assistant, computed on
// request and never stored (docs/training.md). 404 for anybody who may not see it.
documentsRouter.get(
    "/:documentId/versions/:versionId/authorship",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.authorship");
        const result = await getDocumentAuthorship(createServerSupabase(), {
            documentId: req.params.documentId,
            versionId: req.params.versionId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.setHeader("Cache-Control", "no-store");
        res.json(result.data);
    }),
);

// POST /single-documents/:documentId/versions and
// PUT /single-documents/:documentId/versions/:versionId/file are intentionally
// absent for the same reason as POST /single-documents: multipart version
// upload and replacement moved to the upload-session protocol, and app.ts
// answers 410 on both former paths.

// PATCH /single-documents/:documentId/versions/:versionId
// Rename a version's filename. Pass `{ "filename": "…" }`.
documentsRouter.patch(
    "/:documentId/versions/:versionId",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.version");
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { documentId, versionId } = req.params;
        const db = createServerSupabase();

        const result = await renameVersion(
            {
                documentId,
                versionId,
                rawFilename: req.body?.filename,
                userId,
                userEmail,
            },
            db,
        );
        if (!result.ok)
            return void res
                .status(result.status ?? 404)
                .json({ detail: result.detail });
        res.json(result.version);
    }),
);

// DELETE /single-documents/:documentId/versions/:versionId
// Delete one version. The last remaining version cannot be deleted; if the
// deleted version is current, the newest remaining version becomes current.
documentsRouter.delete(
    "/:documentId/versions/:versionId",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("documents.version");
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { documentId, versionId } = req.params;
        const db = createServerSupabase();

        const result = await deleteVersion(
            documentId,
            versionId,
            userId,
            userEmail,
            db,
        );
        if (!result.ok) {
            if (result.kind === "db")
                return void sendInternalError(res, result.error);
            const status =
                result.kind === "doc_not_found" ||
                result.kind === "version_not_found"
                    ? 404
                    : result.kind === "version_forbidden"
                      ? 403
                      : 400;
            return void res.status(status).json({ detail: result.detail });
        }
        res.json(result.payload);
    }),
);

// POST /single-documents/:documentId/edits/:editId/accept
// POST /single-documents/:documentId/edits/:editId/reject
async function handleEditResolution(
    req: import("express").Request<ParamsFlatDictionary>,
    res: import("express").Response,
    mode: "accept" | "reject",
) {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId, editId } = req.params;
    const db = createServerSupabase();

    const result = await resolveEdit(
        mode,
        documentId,
        editId,
        userId,
        userEmail,
        db,
    );
    if (!result.ok) {
        if (result.error) return void sendInternalError(res, result.error);
        return void res
            .status(result.status ?? 404)
            .json({ detail: result.detail });
    }
    res.json(result.body);
}

documentsRouter.post(
    "/:documentId/edits/:editId/accept",
    requireAuth,
    asyncRoute(async (req, res) => handleEditResolution(req, res, "accept")),
);

documentsRouter.post(
    "/:documentId/edits/:editId/reject",
    requireAuth,
    asyncRoute(async (req, res) => handleEditResolution(req, res, "reject")),
);

documentsRouter.use(routerErrorHandler("[documents]"));
