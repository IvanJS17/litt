// HTTP layer for the downloads module.
//
// Route handlers parse params, call the downloads.service functions, and map
// their typed results onto status codes, headers, and JSON.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import {
    StorageOperationError,
    buildContentDisposition,
} from "../../lib/storage";
import { sendServiceFailure } from "../../lib/serviceResult";
import { pipeToResponse } from "../../lib/pipeToResponse";
import { abortOnClose } from "../../lib/responseClosed";
import {
    resolveTokenDownload,
    type ObjectDownload,
} from "./downloads.service";

export const downloadsRouter = Router();

/**
 * Answer a download by streaming the object to the client, so a large file
 * costs a few chunks of memory rather than the whole object.
 *
 * - A matching If-None-Match answers 304, and HEAD answers headers only,
 *   both without reading the object.
 * - The object is opened before any header is written, so a store that
 *   cannot serve it fails into the router's error handler as an ordinary
 *   500 instead of a dropped connection.
 * - A failure after the first byte can no longer change the status: the
 *   socket and the storage read are destroyed (the client sees a short body
 *   against its Content-Length), and the error is reported.
 * - A client that disconnects aborts the storage read; that is not a
 *   failure, so nothing is reported.
 */
async function sendObject(
    req: Request,
    res: Response,
    download: ObjectDownload,
): Promise<void> {
    if (download.etag) {
        res.setHeader("ETag", download.etag);
        if (req.fresh) return void res.status(304).end();
    }
    const headers = () => {
        res.setHeader("Content-Type", download.contentType);
        res.setHeader("Content-Length", String(download.size));
        res.setHeader(
            "Content-Disposition",
            buildContentDisposition("attachment", download.filename),
        );
    };
    if (req.method === "HEAD") {
        headers();
        return void res.end();
    }

    // Already aborted for a client that left before this ran: no read is opened for it.
    const clientGone = abortOnClose(res);
    if (clientGone.aborted) return;
    let body;
    try {
        body = await download.open(clientGone);
    } catch (error) {
        // The error answer is JSON, not this object: drop its validator.
        res.removeHeader("ETag");
        throw error;
    }
    headers();
    try {
        // Not `pipeline(body, res)`: see pipeToResponse.
        await pipeToResponse(body, res);
    } catch (error) {
        if (!(error instanceof StorageOperationError)) {
            // The client going away mid-transfer (premature close, EPIPE):
            // the storage read has already been released.
            return;
        }
        if (!res.headersSent) {
            // Nothing is on the wire, so the error answer is JSON: drop the
            // headers that describe the object.
            for (const name of [
                "ETag",
                "Content-Type",
                "Content-Length",
                "Content-Disposition",
            ]) {
                res.removeHeader(name);
            }
        }
        throw error;
    }
}

// GET /download/:token
downloadsRouter.get("/:token", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    const result = await resolveTokenDownload(db, {
        token: req.params.token,
        userId,
        userEmail,
    });
    if (!result.ok && (result.kind === "conflict" || result.kind === "error"))
        return void sendServiceFailure(res, result);
    if (!result.ok)
        return void res.status(404).json({
            detail:
                result.kind === "invalid_link" ? "Invalid link" : "File not found",
        });
    await sendObject(req, res, result.download);
}));

downloadsRouter.use(routerErrorHandler("[downloads]"));
