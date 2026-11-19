// Reading scanned pages (OCR) and splitting a case file, as tools (design §4.6,
// layer 2b). Neither has a mode: no model of LiTT's or the client's sits in
// between. They are R2 because they SEND the document's pages or text to a
// third party (LandingAI) and spend the person's (or the firm's) own key.
//
// Cost confirmation (design §6.4 rule 3). A tool that sends refuses to run
// unless the call says `acknowledge_cost: true`, which the client's AI may only
// say after showing the person the estimate the matching `get_*_state` tool
// returned. The refusal happens in `resolveWorkspace`, BEFORE the strict audit
// row and before any service runs: no audit row, no key read, nothing sent. If
// the call also carries the estimate it was shown (`estimated_cost_usd`) and the
// current one is higher, the call is refused as `cost_changed`.
//
// The tools call the web's own services (`getScanReadingState`,
// `requestScanReading`, `getSplitState`, `proposeSplit`, `createSplitDocuments`,
// behind /single-documents/:id/ocr and …/split[/create]), so the rules are the
// web's: who may open the document, edit rights for anything that sends or
// creates, a version held for a pasante's training is not sent anywhere
// (`training_approval_required`), the key (`resolveScanKey`: the firm's, then
// the person's own) and the size caps. This module adds only the connection's
// fence: a document outside the workspaces the connection covers does not exist.

import { z } from "zod";
import {
    createSplitDocuments,
    getScanReadingState,
    getSplitState,
    proposeSplit,
    requestScanReading,
} from "../documents/documents.service";
import { documentUrl, emailOf, refuse } from "./mcp.tools.documentOps";
import { defineMcpTool, mcpText, McpToolError } from "./mcp.tools";
import { documentWorkspace, idSchema, POLL_AFTER_SECONDS, UNTRUSTED_NOTICE, untrusted } from "./mcp.toolkit";

const costArgs = {
    acknowledge_cost: z
        .boolean()
        .optional()
        .describe(
            "Must be true. Say true ONLY after showing the person the estimated cost the matching state tool returned and having their go-ahead: the pages or text are sent to LandingAI with their key and it costs credits. Without it nothing is sent.",
        ),
    estimated_cost_usd: z
        .number()
        .min(0)
        .max(1_000_000)
        .optional()
        .describe("The estimated_cost_usd the state tool returned and the person saw. If the estimate has grown since, the call is refused so they can confirm the new one."),
};

type CostArgs = { acknowledge_cost?: boolean; estimated_cost_usd?: number };

/** Refuses, before anything is recorded or sent, a call the person has not confirmed. */
function requireCostConfirmation(args: CostArgs, stateTool: string): void {
    if (args.acknowledge_cost !== true)
        throw new McpToolError(
            "cost_not_acknowledged",
            "This sends the document to LandingAI with the person's own key and has a cost. Nothing was sent.",
            `Call ${stateTool}, show the person the estimated cost, and call this tool again with acknowledge_cost: true once they agree.`,
        );
}

/** The estimate the person saw may not be lower than what it is now (half a cent of rounding aside). */
function requireEstimateHolds(args: CostArgs, current: number | null | undefined, stateTool: string): void {
    if (args.estimated_cost_usd === undefined || current === null || current === undefined) return;
    if (current > args.estimated_cost_usd + 0.005)
        throw new McpToolError(
            "cost_changed",
            `The estimated cost is now ${current.toFixed(2)} USD, more than the ${args.estimated_cost_usd.toFixed(2)} USD that was confirmed. Nothing was sent.`,
            `Call ${stateTool} again, show the person the new estimate and confirm it.`,
        );
}

// ---------------------------------------------------------------------------
// Scan reading (OCR)
// ---------------------------------------------------------------------------

export const getScanReadingStateTool = defineMcpTool({
    name: "get_scan_reading_state",
    title: "See a document's scanned pages",
    description:
        "Shows whether a PDF has pages without text (scans), the state of their reading (none, processing, ready, failed), the ESTIMATED COST in US dollars of reading them with LandingAI, and whether a LandingAI key is available for this person. Sends nothing anywhere. Use it before read_scanned_document and to follow a reading that was started. Same access as opening the document.",
    inputSchema: z.object({ document_id: idSchema("document_id") }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // Counts and a status only; no document text leaves LiTT.
    audit: "call",
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const result = await getScanReadingState(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
        });
        if (!result.ok) refuse(result, "get scan reading state");
        const state = result.data;
        const next = !state.applicable
            ? "Only a PDF can have scanned pages."
            : state.status === "processing"
              ? `The reading is running. Ask again with get_scan_reading_state in ${POLL_AFTER_SECONDS} seconds.`
              : state.needs_reading
                ? !state.key_available
                    ? "There are scanned pages but no LandingAI key: the person adds one in LiTT's Settings (Scan reading)."
                    : !state.can_edit
                      ? "There are scanned pages, but the person cannot edit this document, so they cannot start the reading."
                      : "Show the person the estimated_cost_usd. If they agree, call read_scanned_document with acknowledge_cost: true and that estimate."
                : "There are no scanned pages left to read.";
        return mcpText({
            document_id: args.document_id,
            applicable: state.applicable,
            status: state.status,
            error_code: state.error_code,
            key_available: state.key_available,
            can_edit: state.can_edit,
            needs_reading: state.needs_reading,
            page_count: state.page_count,
            pages_without_text: state.textless_page_count,
            estimated_cost_usd: state.estimated_cost_usd,
            credits_used_last_reading: state.credits,
            next_step: next,
        });
    },
});

export const readScannedDocumentTool = defineMcpTool({
    name: "read_scanned_document",
    title: "Read a document's scanned pages",
    description:
        "Starts reading a PDF's scanned pages (the ones without text) in the background by sending them to LandingAI with the person's own key (the firm's first). It COSTS CREDITS and the pages leave LiTT: call get_scan_reading_state first, show the person the estimated cost, and only with their go-ahead call this with acknowledge_cost: true (and the estimated_cost_usd they saw). Without that nothing is sent. Answers at once with the reading started; follow it with get_scan_reading_state. Needs the permission to edit the document. No AI model of LiTT is used.",
    inputSchema: z.object({ document_id: idSchema("document_id"), ...costArgs }),
    scope: "litt.write",
    lane: "write",
    heavy: "background",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id }),
    resolveWorkspace: async (args, call) => {
        // First, and without touching anything: no confirmation, no reading.
        requireCostConfirmation(args, "get_scan_reading_state");
        const workspace = await documentWorkspace(call, args.document_id);
        if (args.estimated_cost_usd !== undefined) {
            const current = await getScanReadingState(call.db, {
                documentId: args.document_id,
                userId: call.principal.userId,
                userEmail: await emailOf(call),
            });
            if (!current.ok) refuse(current, "check the scan reading estimate");
            requireEstimateHolds(args, current.data.estimated_cost_usd, "get_scan_reading_state");
        }
        return workspace;
    },
    handler: async (args, call) => {
        const result = await requestScanReading(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
        });
        if (!result.ok) refuse(result, "read scanned document");
        const state = result.data;
        // The reading is a queued job that outlives this call: the slot stays while it processes.
        if (state.status === "processing")
            call.heavy?.hold(async () => {
                const now = await getScanReadingState(call.db, {
                    documentId: args.document_id,
                    userId: call.principal.userId,
                    userEmail: await emailOf(call),
                });
                // A failed lookup cannot tell: the job counts as alive (mcp.heavy.ts), never freed by a blip.
                if (!now.ok) return true;
                return now.data.status === "processing";
            });
        return mcpText({
            document_id: args.document_id,
            status: state.status,
            pages_without_text: state.textless_page_count,
            estimated_cost_usd: state.estimated_cost_usd,
            poll_after_s: POLL_AFTER_SECONDS,
            next_step: `The reading runs in LiTT and takes a few minutes. Follow it with get_scan_reading_state in ${POLL_AFTER_SECONDS} seconds until status is ready.`,
        });
    },
});

// ---------------------------------------------------------------------------
// Case-file split
// ---------------------------------------------------------------------------

export const getCaseFileSplitStateTool = defineMcpTool({
    name: "get_case_file_split_state",
    title: "See what splitting a case file would do",
    description:
        "For a PDF that holds several documents (a case file): its pages, the characters of text that would be sent, the ESTIMATED COST in US dollars of proposing a split with LandingAI, the document types the split uses, how many pages are scanned and still unread (read them first), and whether a LandingAI key is available. Computed inside LiTT: nothing is sent to LandingAI. Same access as opening the document.",
    inputSchema: z.object({ document_id: idSchema("document_id") }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // Counts and the names of the person's own document types; no document text leaves LiTT.
    audit: "call",
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const result = await getSplitState(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
        });
        if (!result.ok) refuse(result, "get case file split state");
        const state = result.data;
        const next = state.too_large
            ? "This file is over what the split takes (400 pages, about 4 MB of text)."
            : state.needs_scan_reading
              ? "Some pages are scanned and unread: read them first with read_scanned_document (see get_scan_reading_state)."
              : !state.key_available
                ? "There is no LandingAI key: the person adds one in LiTT's Settings (Scan reading)."
                : !state.can_edit
                  ? "The person cannot edit this document, so they cannot propose a split."
                  : "Show the person the estimated_cost_usd. If they agree, call propose_case_file_split with acknowledge_cost: true and that estimate.";
        return mcpText({
            document_id: args.document_id,
            version_id: state.version_id,
            page_count: state.page_count,
            characters: state.characters,
            estimated_cost_usd: state.estimated_cost_usd,
            estimated_credits: state.estimated_credits,
            unread_pages: state.unread_pages,
            needs_scan_reading: state.needs_scan_reading,
            too_large: state.too_large,
            key_available: state.key_available,
            can_edit: state.can_edit,
            document_types: state.classes.map((c) => c.name),
            document_types_source: state.classes_source,
            next_step: next,
        });
    },
});

export const proposeCaseFileSplitTool = defineMcpTool({
    name: "propose_case_file_split",
    title: "Propose how to split a case file",
    description:
        "Asks LandingAI how a PDF that holds several documents should be split, and returns the proposal: groups of pages with a document type each. It SENDS THE DOCUMENT'S TEXT to LandingAI with the person's own key (the firm's first) and COSTS CREDITS: call get_case_file_split_state first, show the person the estimated cost, and only with their go-ahead call this with acknowledge_cost: true (and the estimated_cost_usd they saw). Without that nothing is sent. Nothing is stored or created: after the person reviews the groups, create_split_documents makes the new PDFs. Needs the permission to edit the document; scanned pages must have been read first (split_needs_scan_reading). No AI model of LiTT is used.",
    inputSchema: z.object({ document_id: idSchema("document_id"), ...costArgs }),
    scope: "litt.write",
    lane: "write",
    heavy: "sync",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id }),
    resolveWorkspace: async (args, call) => {
        requireCostConfirmation(args, "get_case_file_split_state");
        const workspace = await documentWorkspace(call, args.document_id);
        if (args.estimated_cost_usd !== undefined) {
            const current = await getSplitState(call.db, {
                documentId: args.document_id,
                userId: call.principal.userId,
                userEmail: await emailOf(call),
            });
            if (!current.ok) refuse(current, "check the split estimate");
            requireEstimateHolds(args, current.data.estimated_cost_usd, "get_case_file_split_state");
        }
        return workspace;
    },
    handler: async (args, call) => {
        const result = await proposeSplit(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
        });
        if (!result.ok) refuse(result, "propose case file split");
        const proposal = result.data;
        return mcpText({
            document_id: args.document_id,
            version_id: proposal.version_id,
            page_count: proposal.page_count,
            // The identifier is text LandingAI read out of the document: data, not instructions.
            groups: proposal.groups.map((g) => ({
                pages: g.pages,
                type: g.type,
                identifier: g.identifier ? untrusted(g.identifier) : null,
            })),
            document_types: proposal.classes.map((c) => c.name),
            credits_charged: proposal.credits,
            notice: UNTRUSTED_NOTICE,
            next_step:
                "Show the person the groups. With their go-ahead (and any changes they ask for) call create_split_documents with this document_id, this version_id and the groups {pages, name, type}.",
        });
    },
});

export const createSplitDocumentsTool = defineMcpTool({
    name: "create_split_documents",
    title: "Create the documents of a split",
    description:
        "Creates one NEW PDF per group the person confirmed, with the original's pages (version 1, marked as split), in the original's folder and matter. The original does not change and nothing is sent anywhere. groups: [{pages: [1,2,3], name, type}]; every page 1..page_count at most once, type one of document_types or null. version_id is the one returned by propose_case_file_split: if the document has changed since, the call is refused (document_version_conflict). Needs the permission to edit the document. No cost.",
    inputSchema: z.object({
        document_id: idSchema("document_id"),
        version_id: idSchema("version_id").describe("The version_id the split was proposed on."),
        groups: z
            .array(
                z.object({
                    pages: z.array(z.number().int().min(1).max(100_000)).min(1).max(100_000).describe("Page numbers of the original, 1-indexed."),
                    name: z.string().min(1).max(300).describe("The new document's file name."),
                    type: z.string().max(200).nullable().optional().describe("One of the document types, or null."),
                }),
            )
            .min(1)
            .max(400),
    }),
    scope: "litt.write",
    lane: "write",
    heavy: "sync",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ documentId: args.document_id, versionId: args.version_id }),
    resolveWorkspace: (args, call) => documentWorkspace(call, args.document_id),
    handler: async (args, call) => {
        const groups = args.groups.map((g) => ({ pages: g.pages, name: g.name, type: g.type ?? null }));
        const result = await createSplitDocuments(call.db, {
            documentId: args.document_id,
            userId: call.principal.userId,
            userEmail: await emailOf(call),
            versionId: args.version_id,
            body: { version_id: args.version_id, groups },
        });
        if (!result.ok) refuse(result, "create split documents");
        return mcpText({
            source_document_id: args.document_id,
            documents: result.data.documents.map((d) => ({
                document_id: d.document_id,
                version_id: d.version_id,
                filename: d.filename,
                file_type: d.file_type,
                size_bytes: d.size_bytes,
                matter_id: d.project_id,
                folder_id: d.folder_id,
                url: documentUrl(d.project_id),
            })),
            note: "New PDFs with the original's pages; the original is unchanged.",
        });
    },
});
