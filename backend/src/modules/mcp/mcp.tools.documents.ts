// Documents: list a matter's, search text, read text, list versions (design §4.1).
//
// Reads go through the services behind the web's directory listing, version
// list and document access, and through the same stored-text functions the
// chat assistant reads with. Document text that leaves LiTT is recorded
// (strict audit plus an egress event), kept under the 25 000-token ceiling of
// a tool result, and handed over as marked, untrusted data (§7.6).

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadActiveVersion } from "../../lib/documentVersions";
import { isVersionHeld, assertVersionReleasable } from "../../lib/trainingRelease";
import { TRAINING_APPROVAL_REQUIRED_CODE } from "../../lib/httpError";
import { getProjectDirectoryLevel } from "../projects/projects.service";
import {
    findDocumentText,
    listVersions,
    readStoredDocumentText,
} from "../documents/documents.service";
import { recordMcpEgress } from "./mcp.calls";
import { defineMcpTool, mcpText, McpToolError, type McpCall } from "./mcp.tools";
import {
    cursorSchema,
    decodeCursor,
    DEFAULT_PAGE,
    documentWorkspace,
    encodeCursor,
    idSchema,
    limitSchema,
    loadDocument,
    matterWorkspace,
    notFound,
    serviceFailure,
    untrusted,
    UNTRUSTED_NOTICE,
    windowOf,
} from "./mcp.toolkit";

/** The largest window read_document returns; its default is half of it. */
export const READ_MAX_CHARS = 60_000;
export const READ_DEFAULT_CHARS = 30_000;

type DocRow = {
    id: string;
    filename?: string | null;
    file_type?: string | null;
    folder_id?: string | null;
    status?: string | null;
    current_version_id?: string | null;
    active_version_number?: number | null;
    latest_version_number?: number | null;
    size_bytes?: number | null;
    page_count?: number | null;
    textless_page_count?: number | null;
    training_held?: boolean | null;
    updated_at?: string | null;
};

/**
 * The stored text of a document version the person can open and that may leave
 * LiTT: the live version (the current one unless named), not a pasante's draft
 * still waiting for a mentor, with its text ready. Shared by every tool that
 * hands document text to the client's AI.
 */
export async function loadReleasableText(call: McpCall, documentId: string, versionIdArg?: string) {
    const userId = call.principal.userId;
    const userEmail = await call.userEmail();
    const { doc } = await loadDocument(call, documentId);
    const versionId = versionIdArg ?? doc.current_version_id ?? null;
    if (!versionId) throw new McpToolError("no_version", "This document has no version to read yet.");
    // The version must be live and belong to this document.
    const version = await loadActiveVersion(documentId, call.db, versionId);
    if (!version) throw notFound("That version");

    // A pasante's draft stays inside LiTT until a mentor approves it.
    const releasable = await assertVersionReleasable(call.db, {
        id: version.id,
        training_stage: version.training_stage,
        content_sha256: version.content_sha256,
    });
    if (!releasable.ok) {
        if (releasable.kind === "conflict")
            throw new McpToolError(releasable.code ?? TRAINING_APPROVAL_REQUIRED_CODE, releasable.detail);
        throw serviceFailure("check training release", releasable.kind === "error" ? releasable.error : releasable.detail);
    }

    const stored = await readStoredDocumentText(call.db, {
        userId,
        userEmail,
        documentId: documentId,
        versionId: version.id,
    });
    if (!stored) throw notFound("That version");
    if (stored.status === "pending" || stored.status === "processing")
        throw new McpToolError(
            "text_not_ready",
            "The text of this document is still being prepared.",
            "Try again in a minute.",
        );
    if (stored.status !== "ready")
        throw new McpToolError(
            "text_unavailable",
            "The text of this version could not be extracted.",
            "Open the document in LiTT; a scanned file may need to be read there first.",
        );
    return { doc, version, stored };
}

export const listMatterDocuments = defineMcpTool({
    name: "list_matter_documents",
    title: "List a matter's documents",
    description:
        "Lists the documents and sub-folders at one level of a matter (its top level, or one folder), newest first. Shows each document's current version, processing status and whether some of its pages are scans without text.",
    inputSchema: z.object({
        matter_id: idSchema("matter_id"),
        folder_id: idSchema("folder_id").optional().describe("A folder id from get_matter or a previous listing. Omit for the matter's top level."),
        limit: limitSchema,
        cursor: cursorSchema,
    }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    auditRefs: (args) => ({ projectId: args.matter_id }),
    resolveWorkspace: (args, call) => matterWorkspace(call, args.matter_id),
    handler: async (args, call) => {
        const offset = decodeCursor(args.cursor);
        const limit = args.limit ?? DEFAULT_PAGE;
        const result = await getProjectDirectoryLevel(call.db, {
            projectId: args.matter_id,
            userId: call.principal.userId,
            userEmail: await call.userEmail(),
            parentFolderId: args.folder_id ?? null,
            pagination: { limit, offset },
        });
        if (!result.ok) {
            if (result.kind === "forbidden") throw notFound("The matter");
            throw serviceFailure("list matter documents", result.error);
        }
        const { documents, folders, documentsHasMore } = result.body;
        return mcpText({
            matter_id: args.matter_id,
            folder_id: args.folder_id ?? null,
            documents: (documents as DocRow[]).map((doc) => ({
                id: doc.id,
                filename: doc.filename ?? null,
                file_type: doc.file_type ?? null,
                folder_id: doc.folder_id ?? null,
                status: doc.status ?? null,
                current_version_id: doc.current_version_id ?? null,
                version_number: doc.active_version_number ?? doc.latest_version_number ?? null,
                size_bytes: doc.size_bytes ?? null,
                page_count: doc.page_count ?? null,
                has_scan_pages: (doc.textless_page_count ?? 0) > 0,
                // A pasante's draft still waiting for approval: its text cannot be read from here.
                training_held: doc.training_held === true,
                updated_at: doc.updated_at ?? null,
            })),
            // Sub-folders of this level (all of them; they are few).
            folders: (folders as { id: string; name: string }[]).map((folder) => ({ id: folder.id, name: folder.name })),
            next_cursor: documentsHasMore ? encodeCursor(offset + limit) : null,
        });
    },
});

const SEARCH_SCOPES = ["matter", "document", "library"] as const;

export const searchDocuments = defineMcpTool({
    name: "search_documents",
    title: "Search document text",
    description:
        "Finds a phrase in the stored text of documents: inside one matter, inside one document, or in the person's own library of one workspace. Returns where it occurs (document, version, character offsets) with a short excerpt. The match is literal and case-insensitive; the phrase needs at least 2 characters.",
    inputSchema: z.object({
        query: z.string().trim().min(2).max(500),
        scope: z.enum(SEARCH_SCOPES).describe("matter: needs matter_id. document: needs document_id. library: the person's own files in one workspace."),
        matter_id: idSchema("matter_id").optional(),
        document_id: idSchema("document_id").optional(),
        workspace: z.string().optional().describe("Only for scope library. Defaults to the connection's default workspace."),
        limit: z.number().int().min(1).max(20).optional().describe("How many matches (1-20, default 10)."),
        cursor: cursorSchema,
    }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // Excerpts are document text leaving LiTT.
    audit: "strict",
    auditRefs: (args) => ({ projectId: args.matter_id ?? null, documentId: args.document_id ?? null }),
    resolveWorkspace: async (args, call) => {
        if (args.scope === "matter") {
            if (!args.matter_id) throw missing("matter_id", "matter");
            return matterWorkspace(call, args.matter_id);
        }
        if (args.scope === "document") {
            if (!args.document_id) throw missing("document_id", "document");
            return documentWorkspace(call, args.document_id);
        }
        const workspace = args.workspace || call.principal.defaultWorkspace;
        if (!call.principal.workspaces.some((w) => w.id === workspace))
            throw new McpToolError(
                "workspace_not_found",
                "That workspace is not part of this connection or you can no longer open it.",
                "Pick one of the workspaces listed by list_workspaces.",
            );
        return workspace;
    },
    handler: async (args, call) => {
        const offset = decodeCursor(args.cursor);
        const found = await findDocumentText(call.db, {
            userId: call.principal.userId,
            userEmail: await call.userEmail(),
            workspace: call.workspace,
            scope: args.scope === "matter" ? "project" : args.scope,
            query: args.query,
            projectId: args.scope === "matter" ? args.matter_id : null,
            documentId: args.scope === "document" ? args.document_id : null,
            limit: args.limit ?? 10,
            offset,
        });
        if (!found.ok) {
            if (found.kind === "validation") throw new McpToolError("invalid_arguments", found.detail);
            throw serviceFailure("search documents", found.kind === "error" ? found.error : found.detail);
        }
        // A pasante's unapproved draft may not leave LiTT, in a search result either.
        const versions = [...new Set(found.data.matches.map((match) => match.version_id))];
        const held = new Set<string>();
        for (const id of versions) if (await isVersionHeld(call.db, id)) held.add(id);
        const visible = found.data.matches.filter((match) => !held.has(match.version_id));
        // Excerpts are about to leave: record each document's share first, or do not return them.
        const sent = new Map<string, { documentId: string; versionId: string; characters: number }>();
        for (const match of visible) {
            const entry = sent.get(match.version_id) ?? { documentId: match.document_id, versionId: match.version_id, characters: 0 };
            entry.characters += match.excerpt.length;
            sent.set(match.version_id, entry);
        }
        for (const entry of sent.values()) await recordEgressOrFail(call, entry.documentId, entry.versionId, entry.characters);
        const token = randomBytes(9).toString("base64url");
        return mcpText({
            query: args.query,
            matches: visible.map((match) => ({
                document_id: match.document_id,
                version_id: match.version_id,
                version_number: match.version_number,
                filename: match.filename,
                file_type: match.file_type,
                // Zero-based Unicode code-point offsets into the document's text.
                start_char: match.start_char,
                end_char: match.end_char,
                excerpt_start_char: match.excerpt_start_char,
                excerpt: untrusted(match.excerpt, token),
            })),
            withheld_until_approved: held.size > 0 ? found.data.matches.length - visible.length : 0,
            coverage: found.data.coverage,
            next_cursor: found.data.next_offset == null ? null : encodeCursor(found.data.next_offset),
            notice: UNTRUSTED_NOTICE,
        });
    },
});

function missing(field: string, scope: string): McpToolError {
    return new McpToolError("invalid_arguments", `${field} is required when scope is ${scope}.`);
}

export async function recordEgressOrFail(
    call: McpCall,
    documentId: string,
    versionId: string,
    characters: number,
): Promise<void> {
    try {
        await recordMcpEgress(call.db, {
            principal: call.principal,
            workspace: call.workspace,
            documentId,
            versionId,
            characters,
        });
    } catch (error) {
        throw serviceFailure("record egress", error);
    }
}

export const readDocument = defineMcpTool({
    name: "read_document",
    title: "Read a document",
    description:
        "Reads the stored text of one document version (the current one unless version_id is given), a window at a time. Offsets count Unicode characters, so a passage can be cited as version_id plus start and end offset; continue with next_offset until it is null.",
    inputSchema: z.object({
        document_id: idSchema("document_id"),
        version_id: idSchema("version_id").optional().describe("Defaults to the document's current version."),
        offset: z.number().int().min(0).max(100_000_000).optional().describe("First character to return (default 0)."),
        limit_chars: z
            .number()
            .int()
            .min(1)
            .max(READ_MAX_CHARS)
            .optional()
            .describe(`How many characters (1-${READ_MAX_CHARS}, default ${READ_DEFAULT_CHARS}).`),
    }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // The text of a document leaves LiTT for the client's AI.
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id, versionId: args.version_id ?? null }),
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const { version, stored } = await loadReleasableText(call, args.document_id, args.version_id);
        const text = stored.text ?? "";
        const window = windowOf(text, args.offset ?? 0, args.limit_chars ?? READ_DEFAULT_CHARS);
        // Record what leaves before it leaves.
        await recordEgressOrFail(call, args.document_id, version.id, window.slice.length);
        const scanned = (stored.textless_page_count ?? 0) > 0;
        return mcpText({
            document_id: args.document_id,
            version_id: version.id,
            version_number: version.version_number,
            filename: version.filename,
            file_type: version.file_type,
            // Zero-based Unicode code points into the version's extracted text.
            offset: window.start,
            end_offset: window.end,
            next_offset: window.end < window.total ? window.end : null,
            total_chars: window.total,
            has_scan_pages: scanned,
            ...(scanned
                ? {
                      scan_notice: `${stored.textless_page_count} page(s) have no text layer and are not included. Ask the person to have LiTT read the scanned pages first.`,
                  }
                : {}),
            content: untrusted(window.slice),
            notice: UNTRUSTED_NOTICE,
        });
    },
});

export const listDocumentVersions = defineMcpTool({
    name: "list_document_versions",
    title: "List a document's versions",
    description:
        "Lists the versions of one document, oldest first: number, where each came from (upload, conversion, edit...), when, size and whether it is waiting for a mentor's approval.",
    inputSchema: z.object({ document_id: idSchema("document_id") }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    auditRefs: (args) => ({ documentId: args.document_id }),
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const result = await listVersions(args.document_id, call.principal.userId, await call.userEmail(), call.db);
        if (!result.ok) throw notFound("The document");
        return mcpText({
            document_id: args.document_id,
            current_version_id: result.current_version_id,
            versions: (result.versions as Record<string, unknown>[]).map((version) => ({
                id: version.id,
                version_number: version.version_number ?? null,
                // upload, converted, compared, split, user_edit, mcp_client...
                source: version.source ?? null,
                created_at: version.created_at ?? null,
                filename: version.filename ?? null,
                file_type: version.file_type ?? null,
                size_bytes: version.size_bytes ?? null,
                page_count: version.page_count ?? null,
                has_scan_pages: ((version.textless_page_count as number | null) ?? 0) > 0,
                deleted: !!version.deleted_at,
                training_held: version.training_held === true,
            })),
        });
    },
});
