// Compare two Word documents and convert a document between Markdown, Word
// and PDF (design §4.6). Neither has a mode: they are deterministic server
// processes with no model in between, and no document text leaves LiTT (the
// result is a NEW document that stays in the matter).
//
// The tools call the web's own services (`compareDocuments`,
// `previewDocumentConversion`, `convertDocument`, behind POST
// /single-documents/:id/compare and …/convert[/preview]), so the rules are the
// web's: who may download the document (a pasante's unapproved draft is
// refused with `training_approval_required`, 409), who may edit where it
// lives, same matter for a comparison, the size caps and the busy parser. This
// module adds only the connection's fence: a document outside the workspaces
// the connection covers does not exist for it.

import { z } from "zod";
import type { DocumentConversionLoss } from "@mike/contracts";
import type { ServiceFailure } from "../../lib/serviceResult";
import {
    compareDocuments,
    convertDocument,
    previewDocumentConversion,
} from "../documents/documents.service";
import { mcpConfig } from "./mcp.config";
import { defineMcpTool, mcpText, McpToolError, type McpCall } from "./mcp.tools";
import { documentWorkspace, idSchema, notFound, serviceFailure } from "./mcp.toolkit";

const TARGETS = { markdown: "md", docx: "docx", pdf: "pdf" } as const;
const targetSchema = z
    .enum(["markdown", "docx", "pdf"])
    .describe("The format of the new document: markdown, docx (Word) or pdf. Which pairs exist depends on the source: Word to Markdown or PDF, Markdown to Word or PDF, PDF to Markdown.");

/** What each loss code means, in plain words for the person the client's AI talks to. */
const LOSS_TEXT: Record<DocumentConversionLoss, string> = {
    md_raw_html: "Raw HTML in the Markdown is not carried over.",
    md_formulas: "Formulas are not carried over.",
    md_house_style: "The result uses LiTT's own document style, not a custom one.",
    docx_comments: "Word comments are not carried over.",
    docx_tracked_changes: "Tracked changes are flattened, not kept as changes.",
    docx_headers_footers: "Headers and footers are not carried over.",
    docx_formatting: "Fine formatting (fonts, colours, spacing) is simplified.",
    docx_legal_numbering: "Legal numbering may be rewritten as plain text.",
    docx_images: "Images are not carried over.",
    docx_merged_cells: "Merged table cells are simplified.",
    docx_footnotes_as_list: "Footnotes become a list at the end.",
    pdf_fonts_and_breaks: "Fonts and page breaks may differ from the original.",
    pdf_tracked_changes_as_shown: "Tracked changes appear as they are shown, not as changes.",
    pdf_layout_lost: "The page layout is lost; only the text is kept.",
};

/** A document service's refusal, in the words the module authored (the web's 404/403/409/400/503). */
function refuse(failure: ServiceFailure, operation: string): never {
    if (failure.kind === "error") throw serviceFailure(operation, failure.error);
    if (failure.kind === "not_found") throw notFound("The document");
    if (failure.kind === "unavailable")
        throw new McpToolError(failure.code ?? "unavailable", failure.detail, "Try again in a moment.");
    const fallback: Record<string, string> = {
        validation: "invalid_request",
        forbidden: "forbidden",
        conflict: "conflict",
        unprocessable: "unprocessable",
    };
    const suggestion =
        failure.code === "training_approval_required"
            ? "A mentor has to approve this draft in LiTT before it can be used."
            : failure.code === "convert_pdf_without_text"
              ? "The PDF is a scan: read its pages in LiTT's web app first."
              : undefined;
    throw new McpToolError(failure.code ?? fallback[failure.kind] ?? "request_refused", failure.detail, suggestion);
}

const documentUrl = (projectId: string | null) =>
    `${mcpConfig().webUrl}${projectId ? `/projects/${projectId}` : "/library"}`;

async function emailOf(call: McpCall): Promise<string | undefined> {
    return (await call.userEmail()) || undefined;
}

export const compareDocumentsTool = defineMcpTool({
    name: "compare_documents",
    title: "Compare two Word documents",
    description:
        "Compares the current version of an original Word document with the current version of another (the negotiated one) and saves the differences as a NEW Word document with tracked changes, next to the original. Neither source changes. Both must be Word files in the same matter, the person must be able to download both and edit where the original lives. No AI model is used.",
    inputSchema: z.object({
        document_id: idSchema("document_id").describe("The original document."),
        against_document_id: idSchema("against_document_id").describe("The other document, compared against the original."),
    }),
    scope: "litt.write",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id }),
    resolveWorkspace: async (args, call) => {
        // Both documents must be ones this connection covers.
        const other = await documentWorkspace(call, args.against_document_id);
        const base = await documentWorkspace(call, args.document_id);
        if (other !== base) throw new McpToolError("compare_not_supported", "These documents cannot be compared.");
        return base;
    },
    handler: async (args, call) => {
        const result = await compareDocuments(call.db, {
            documentId: args.document_id,
            againstDocumentId: args.against_document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
        });
        if (!result.ok) refuse(result, "compare documents");
        return mcpText({
            document_id: result.data.document_id,
            version_id: result.data.version_id,
            filename: result.data.filename,
            file_type: result.data.file_type,
            size_bytes: result.data.size_bytes,
            matter_id: result.data.project_id,
            folder_id: result.data.folder_id,
            url: documentUrl(result.data.project_id),
            note: "A new Word document with the differences as tracked changes; the two sources are unchanged.",
        });
    },
});

export const previewDocumentConversionTool = defineMcpTool({
    name: "preview_document_conversion",
    title: "Preview a document conversion",
    description:
        "Shows what converting a document to another format would lose, before anything is created: the list of losses (with a plain sentence each), for a Word file the counts found inside it (comments, tracked changes, images, footnotes, headers and footers) and the name the new document would get. Creates nothing. Same access as downloading the document.",
    inputSchema: z.object({ document_id: idSchema("document_id"), target: targetSchema }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // Only counts and a file name come back; no document text leaves LiTT.
    audit: "call",
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const preview = await previewDocumentConversion(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
            target: TARGETS[args.target],
        });
        if (!preview.ok) refuse(preview, "preview document conversion");
        const data = preview.data;
        return mcpText({
            document_id: args.document_id,
            source_type: data.source_type,
            target: args.target,
            losses: data.losses.map((code) => ({ code, text: LOSS_TEXT[code] ?? code })),
            detected: data.detected,
            blocked: data.blocked,
            ...(data.blocked === "pdf_without_text"
                ? { next_step: "This PDF has no text (a scan). Its pages have to be read in LiTT's web app before it can be converted." }
                : { next_step: "Create the new document with convert_document." }),
            textless_page_count: data.textless_page_count,
            new_filename: data.new_filename,
        });
    },
});

export const convertDocumentTool = defineMcpTool({
    name: "convert_document",
    title: "Convert a document",
    description:
        "Converts a document's current version to Markdown, Word or PDF and saves the result as a NEW document next to the original (version 1, marked as converted). The original does not change. Needs the permission to add files where the original lives. A pasante's draft that a mentor has not approved is refused. Use preview_document_conversion first to see what would be lost. No AI model is used.",
    inputSchema: z.object({ document_id: idSchema("document_id"), target: targetSchema }),
    scope: "litt.write",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id }),
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const result = await convertDocument(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
            target: TARGETS[args.target],
        });
        if (!result.ok) refuse(result, "convert document");
        const { data } = result;
        return mcpText({
            document_id: data.document_id,
            version_id: data.version_id,
            filename: data.filename,
            file_type: data.file_type,
            size_bytes: data.size_bytes,
            matter_id: data.project_id,
            folder_id: data.folder_id,
            source_document_id: args.document_id,
            url: documentUrl(data.project_id),
        });
    },
});
