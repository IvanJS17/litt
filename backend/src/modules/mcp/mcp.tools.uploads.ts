// Uploading a document into a matter (design §4.1).
//
// An MCP call cannot carry file bytes. The tool opens an ordinary upload
// session (the one the web uses: same manifest rules, same limits, same
// destination authorization) and hands back a one-time signed URL; the file
// goes to storage by PUT, from wherever the client can run one, and the
// upload worker turns it into a document through the documents module. No
// bytes pass through this server and nothing here writes a version.

import { z } from "zod";
import { storageEnabled } from "../../lib/storage";
import { uploadSessionRateLimitConfiguration } from "../../lib/runtimeConfig";
import {
    completeUploadSessionFile,
    getUploadSession,
    openUploadSession,
    type UploadFailure,
} from "../uploads/uploads.service";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "../../lib/documentTypes";
import { defineMcpTool, mcpText, McpToolError, type McpCall } from "./mcp.tools";
import { idSchema, matterWorkspace, notFound, serviceFailure } from "./mcp.toolkit";

/** An upload refusal the person can act on, in the words the uploads module authored. */
function uploadRefusal(failure: UploadFailure): never {
    if (failure.kind === "internal") throw serviceFailure("upload", failure.error);
    const body = failure.body as { code?: unknown; detail?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : "The upload was refused.";
    switch (failure.status) {
        case 403:
            throw new McpToolError("forbidden", detail);
        case 404:
            throw new McpToolError("not_found", detail);
        case 410:
            throw new McpToolError("upload_expired", detail, "Request a new upload.");
        case 413:
            throw new McpToolError(typeof body.code === "string" ? body.code : "upload_too_large", detail);
        case 429:
            throw new McpToolError("rate_limited", detail, "Try again later.");
        case 409:
            throw new McpToolError(
                typeof body.code === "string" ? body.code : "upload_conflict",
                detail,
                body.code === "upload_incomplete"
                    ? "Send the file with the PUT request first, then call complete_document_upload again."
                    : undefined,
            );
        default:
            throw new McpToolError(typeof body.code === "string" ? body.code : "invalid_upload", detail);
    }
}

type SessionFile = {
    id: string;
    filename: string;
    status: string;
    error_code?: string | null;
    expected_size_bytes?: number;
    result?: { id?: string } | null;
    upload?: { method: string; url: string; headers: Record<string, string>; expires_at: string };
};
type SessionBody = {
    session?: { id: string; status: string; expires_at: string; destination?: { project_id?: string } };
    files?: SessionFile[];
};

/** The session's matter, once the person can still open it and the grant covers it. */
async function sessionWorkspace(call: McpCall, sessionId: string): Promise<string> {
    const found = await getUploadSession(call.db, sessionId, call.principal.userId);
    if (!found.ok) {
        if (found.kind === "internal") throw serviceFailure("upload session", found.error);
        throw notFound("The upload");
    }
    const projectId = (found.data as SessionBody).session?.destination?.project_id;
    if (!projectId) throw notFound("The upload");
    return matterWorkspace(call, projectId);
}

export const requestDocumentUpload = defineMcpTool({
    name: "request_document_upload",
    title: "Request a document upload",
    description:
        "Opens an upload of one file into a matter and returns a one-time signed URL for it. The file bytes are sent to that URL with an HTTP PUT (not through this tool); then complete_document_upload tells LiTT to process it. Supported types and the 100 MB limit are the same as in the web app.",
    inputSchema: z.object({
        matter_id: idSchema("matter_id"),
        folder_id: idSchema("folder_id").optional().describe("A folder of the matter. Omit for its top level."),
        filename: z.string().trim().min(1).max(255).describe("Name with extension, e.g. contrato.docx."),
        size_bytes: z.number().int().positive().max(MAX_DOCUMENT_UPLOAD_BYTES).describe("Exact size of the file in bytes."),
    }),
    scope: "litt.write",
    lane: "write",
    readOnly: false,
    // It adds a document; it changes or deletes nothing that exists.
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ projectId: args.matter_id }),
    resolveWorkspace: (args, call) => matterWorkspace(call, args.matter_id),
    handler: async (args, call) => {
        if (!storageEnabled)
            throw new McpToolError("storage_unavailable", "File storage is not available right now.", "Try again later.");
        const opened = await openUploadSession(call.db, {
            userId: call.principal.userId,
            userEmail: await call.userEmail(),
            body: {
                purpose: "document_create",
                destination: {
                    scope: "project",
                    project_id: args.matter_id,
                    ...(args.folder_id ? { folder_id: args.folder_id } : {}),
                },
                files: [{ client_id: "mcp-upload", filename: args.filename, size_bytes: args.size_bytes }],
            },
            hourlySessionLimit: uploadSessionRateLimitConfiguration().sessionCreationMaxPerHour,
        });
        if (!opened.ok) uploadRefusal(opened);
        const body = opened.data as SessionBody;
        const file = body.files?.[0];
        if (!body.session || !file?.upload) throw serviceFailure("open upload session");
        return mcpText({
            upload_session_id: body.session.id,
            expires_at: body.session.expires_at,
            file: { filename: file.filename, size_bytes: file.expected_size_bytes ?? args.size_bytes },
            upload: file.upload,
            next_step:
                "Send the file's bytes to upload.url with the method and headers given, then call complete_document_upload.",
        });
    },
});

export const completeDocumentUpload = defineMcpTool({
    name: "complete_document_upload",
    title: "Complete a document upload",
    description:
        "Tells LiTT the file was sent to the signed URL of request_document_upload, so it verifies and processes it into a document. Safe to call again; use get_upload_status to follow the result.",
    inputSchema: z.object({ upload_session_id: idSchema("upload_session_id") }),
    scope: "litt.write",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    resolveWorkspace: (args, call) => sessionWorkspace(call, args.upload_session_id),
    handler: async (args, call) => {
        const userId = call.principal.userId;
        const found = await getUploadSession(call.db, args.upload_session_id, userId);
        if (!found.ok) uploadRefusal(found);
        const files = ((found.data as SessionBody).files ?? []).filter((file) =>
            ["pending_upload", "verifying", "uploaded"].includes(file.status),
        );
        let latest: SessionBody | null = null;
        for (const file of files) {
            const done = await completeUploadSessionFile(call.db, {
                sessionId: args.upload_session_id,
                fileId: file.id,
                userId,
                failed: false,
            });
            if (!done.ok) uploadRefusal(done);
            latest = done.data.body as SessionBody;
        }
        const body = latest ?? (found.data as SessionBody);
        return mcpText(statusOf(args.upload_session_id, body));
    },
});

function statusOf(sessionId: string, body: SessionBody) {
    return {
        upload_session_id: sessionId,
        status: body.session?.status ?? null,
        files: (body.files ?? []).map((file) => ({
            filename: file.filename,
            status: file.status,
            error_code: file.error_code ?? null,
            // Present once the document exists.
            document_id: file.status === "completed" ? (file.result?.id ?? null) : null,
        })),
    };
}

export const getUploadStatus = defineMcpTool({
    name: "get_upload_status",
    title: "Get an upload's status",
    description:
        "Shows where an upload started with request_document_upload stands: waiting for the file, processing, completed (with the new document's id) or failed.",
    inputSchema: z.object({ upload_session_id: idSchema("upload_session_id") }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    resolveWorkspace: (args, call) => sessionWorkspace(call, args.upload_session_id),
    handler: async (args, call) => {
        const found = await getUploadSession(call.db, args.upload_session_id, call.principal.userId);
        if (!found.ok) uploadRefusal(found);
        return mcpText(statusOf(args.upload_session_id, found.data as SessionBody));
    },
});
