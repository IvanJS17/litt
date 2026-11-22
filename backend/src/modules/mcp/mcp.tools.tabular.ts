// Tabular review (design §4.3): list and read reviews, create one over a set of
// documents, have LiTT fill it (mode A) and follow that run.
//
// Everything goes through the services behind the /tabular-review routes. A
// run is the same server-owned synchronous generation the web starts
// (`startTabularGeneration`, shared with POST /:reviewId/generate): it claims
// the review's lease, runs on the review's own model with the person's keys
// (no fallback: a review whose model has no usable key does not start), and its
// cells carry the citation checks the extraction already makes. The tool starts
// it, waits a little and otherwise answers `running` for the status tool.
//
// Cell text comes from documents, so it is returned as untrusted data and
// recorded as text leaving LiTT. Mode B for tabular (the client's AI fills the
// cells) is not part of this slice.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getActiveStreamRun } from "../../lib/streamRuns";
import { heldSince } from "../../lib/trainingRelease";
import {
    createTabularReview,
    getTabularReviewDetail,
    listTabularReviewChatSources,
    listTabularReviews,
    prepareTabularGenerate,
    preparedGenerateFailure,
    reviewRunKey,
    runTabularGeneration,
    savedTabularModel,
    startTabularGeneration,
    stopTabularGeneration,
    type TabularFailure,
} from "../tabular/tabular.service";
import { defineMcpTool, mcpText, McpToolError, type McpCall } from "./mcp.tools";
import {
    cursorSchema,
    decodeCursor,
    DEFAULT_PAGE,
    documentsOutsideGrant,
    encodeCursor,
    idSchema,
    inGrant,
    limitSchema,
    matterWorkspace,
    notFound,
    POLL_AFTER_SECONDS,
    serviceFailure,
    untrusted,
    UNTRUSTED_NOTICE,
    waitFor,
    workspaceOf,
} from "./mcp.toolkit";
import { decideReleases, decideReleasesSince, type Release } from "./mcp.release";
import { recordEgressOrFail } from "./mcp.tools.documents";

/** Text of cells per page of read_tabular_cells (the whole result stays under the net). */
const CELLS_PAGE_CHARS = 60_000;
const MAX_CELLS_PAGE = 50;
const MAX_DOCUMENTS = 200;
const MAX_COLUMNS = 30;

type Row = { id: string; label?: string | null; document_id?: string | null; source_document_ids?: string[]; sort_index?: number };
type Cell = {
    id?: string;
    row_id: string;
    column_index: number;
    document_id?: string | null;
    status: string;
    content: { summary: string; flag?: string; reasoning?: string } | null;
    citations?: unknown;
    review_refs?: unknown;
    created_at?: string | null;
};
type ColumnConfig = { index: number; name: string; prompt?: string; format?: string };
type Review = Record<string, unknown> & {
    id: string;
    title?: string | null;
    model?: string | null;
    org_id?: string | null;
    project_id?: string | null;
    columns_config?: ColumnConfig[] | null;
    access_role?: string;
    is_running?: boolean;
    updated_at?: string;
};
type Detail = { review: Review; cells: Cell[]; rows: Row[]; documents: { id: string; current_version_id?: string | null }[] };

/** A tabular service refusal, in the words the module authored, as a tool error. */
export function refuse(failure: TabularFailure): never {
    if (failure.kind === "error") throw serviceFailure("tabular review", failure.error);
    if (failure.kind === "status") {
        const body = failure.body as { code?: unknown; detail?: unknown };
        const detail = typeof body.detail === "string" ? body.detail : "The request was refused.";
        const code = typeof body.code === "string" ? body.code : failure.status === 404 ? "not_found" : failure.status === 403 ? "forbidden" : "request_refused";
        throw new McpToolError(code, detail, suggestion(code));
    }
    const code =
        failure.code ??
        ({ validation: "invalid_arguments", forbidden: "forbidden", not_found: "not_found", conflict: "conflict", unprocessable: "unprocessable", unavailable: "unavailable" } as const)[failure.kind];
    throw new McpToolError(code, failure.detail, suggestion(code));
}

function suggestion(code: string): string | undefined {
    switch (code) {
        case "review_running":
            return "Wait for the current run to finish (get_tabular_run_status) or stop it with stop_tabular_run.";
        case "model_required":
        case "model_unavailable":
        case "missing_api_key":
            return "Name a model the person has a key for, or add the key in LiTT's settings. LiTT does not switch models by itself.";
        default:
            return undefined;
    }
}

const rowDocs = (row: Row) => row.source_document_ids ?? (row.document_id ? [row.document_id] : []);

/** The review as the person reads it, once the grant covers the review's own workspace. */
async function loadReviewWhole(call: McpCall, reviewId: string): Promise<{ detail: Detail; workspace: string }> {
    const found = await getTabularReviewDetail(call.db, {
        reviewId,
        userId: call.principal.userId,
        userEmail: (await call.userEmail()) || undefined,
    });
    if (!found.ok) {
        if (found.kind === "error") throw serviceFailure("load review", found.error);
        throw notFound("The review");
    }
    const detail = found.data as unknown as Detail;
    const { review } = detail;
    // A review in a matter lives where the matter does.
    const workspace = review.project_id ? await matterWorkspace(call, review.project_id) : workspaceOf(review.org_id);
    if (!inGrant(call, workspace === "personal" ? null : workspace)) throw notFound("The review");
    return { detail, workspace };
}

/**
 * The review with its rows and cells, once the person can open it AND the grant
 * covers its workspace. A review the web built may hold a workflow's files from
 * another workspace, or a row whose document is gone: those rows (and their
 * cells and documents) are not here, because where their document lies cannot
 * be shown to be inside the connection.
 */
async function loadReview(call: McpCall, reviewId: string): Promise<{ detail: Detail; workspace: string }> {
    const { detail, workspace } = await loadReviewWhole(call, reviewId);
    const outside = await documentsOutsideGrant(call, detail.rows.flatMap(rowDocs));
    const covered = (row: Row) => rowDocs(row).length > 0 && !rowDocs(row).some((id) => outside.has(id));
    if (outside.size > 0 || !detail.rows.every(covered)) {
        detail.rows = detail.rows.filter(covered);
        const kept = new Set(detail.rows.map((row) => row.id));
        detail.cells = detail.cells.filter((cell) => kept.has(cell.row_id));
        detail.documents = detail.documents.filter((doc) => !outside.has(doc.id));
    }
    return { detail, workspace };
}

export const reviewWorkspace = async (call: McpCall, reviewId: string) => (await loadReview(call, reviewId)).workspace;

/**
 * Whether the thread of a review may be chatted with, or read, through this
 * connection. The assistant answers from every row the PERSON can read, not
 * from what the connection covers, and the stored answers can cite any of
 * them: so a review that holds any document outside the connection's
 * workspaces, a row whose document is gone, or a held draft of any workspace
 * does not leave. This looks at all of the review, not at what the grant leaves.
 */
export async function reviewChatRelease(call: McpCall, reviewId: string): Promise<Release> {
    const { detail } = await loadReviewWhole(call, reviewId);
    const rows = detail.rows.map(rowDocs);
    const sources = rows.some((docs) => docs.length === 0)
        ? null
        : [...new Set([...rows.flat(), ...detail.documents.map((doc) => doc.id)])].map((documentId) => ({ documentId }));
    return (await decideReleases(call, [sources]))[0];
}

/**
 * Whether one stored answer of a review's thread may leave through this
 * connection: both what the review holds NOW (`reviewChatRelease`: the
 * assistant composes from every row, so a review with anything outside the
 * connection does not leave) and what the answer was itself built from. The
 * thread's messages record their sources, cumulative over the thread, so
 * removing a row or superseding a draft afterwards does not release an
 * answer written over it; unknown sources are withheld. An answer is composed
 * from the cells as they were when it was written, and those may since have
 * been made again from another version, so it is held when any version its
 * documents ever had is held (`heldSince`, whole history). An answer not
 * stored yet has no text to show; it is judged on the whole thread so far.
 * Outside the connection is reported before held.
 */
export async function reviewAnswerRelease(call: McpCall, reviewId: string, chatId: string, messageId: string): Promise<Release> {
    const review = await reviewChatRelease(call, reviewId);
    const listed = await listTabularReviewChatSources(call.db, {
        reviewId,
        chatId,
        userId: call.principal.userId,
        userEmail: (await call.userEmail()) || undefined,
    });
    if (!listed.ok) {
        if (listed.kind === "error") throw serviceFailure("read the thread's sources", listed.error);
        if (listed.kind === "status" || listed.kind === "not_found") throw notFound("The conversation");
        refuse(listed);
    }
    const messages = listed.data;
    const found = messages.findIndex((message) => message.id === messageId);
    const answer = found >= 0 ? messages[found] : messages[messages.length - 1];
    const sources = answer ? answer.sources : [];
    const [own] = await decideReleasesSince(call, [sources && { documentIds: sources, wholeHistory: true }]);
    const decisions = [review, own];
    return decisions.find((d) => !d.ok && d.reason === "outside_connection") ?? decisions.find((d) => !d.ok) ?? { ok: true };
}

function progressOf(detail: Detail) {
    const columns = detail.review.columns_config ?? [];
    const total = detail.rows.length * columns.length;
    const done = detail.cells.filter((cell) => cell.status === "done" && cell.content).length;
    const failed = detail.cells.filter((cell) => cell.status === "error").length;
    return { done, total, failed, pending: Math.max(total - done - failed, 0) };
}

function runStatusOf(progress: ReturnType<typeof progressOf>, running: boolean) {
    if (running) return "running";
    return progress.pending === 0 && progress.failed === 0 && progress.total > 0 ? "completed" : "idle";
}

/** A workspace named by the call, or the matter's, as the tools that list or create reviews resolve it. */
export async function matterOrWorkspace(call: McpCall, matterId: string | undefined, workspaceArg: string | undefined): Promise<string> {
    if (matterId) return matterWorkspace(call, matterId);
    const workspace = workspaceArg || call.principal.defaultWorkspace;
    if (!call.principal.workspaces.some((w) => w.id === workspace))
        throw new McpToolError(
            "workspace_not_found",
            "That workspace is not part of this connection or you can no longer open it.",
            "Pick one of the workspaces listed by list_workspaces.",
        );
    return workspace;
}

const columnInput = z.object({
    name: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(4000).describe("What to extract from each document for this column."),
    format: z.enum(["text", "number", "date", "yes_no", "tags"]).optional(),
});

export const listTabularReviewsTool = defineMcpTool({
    name: "list_tabular_reviews",
    title: "List tabular reviews",
    description:
        "Lists the tabular reviews (a grid of documents by questions) the person can open in one workspace or one matter, newest first, with title, columns, how many documents and whether one is running.",
    inputSchema: z.object({
        matter_id: idSchema("matter_id").optional().describe("Only the reviews of this matter."),
        workspace: z.string().optional().describe("A workspace id from list_workspaces. Defaults to the connection's default workspace."),
        query: z.string().trim().max(200).optional().describe("Part of the title."),
        limit: limitSchema,
        cursor: cursorSchema,
    }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    auditRefs: (args) => ({ projectId: args.matter_id ?? null }),
    resolveWorkspace: (args, call) => matterOrWorkspace(call, args.matter_id, args.workspace),
    handler: async (args, call) => {
        const workspace = call.workspace!;
        const offset = decodeCursor(args.cursor);
        const limit = args.limit ?? DEFAULT_PAGE;
        const listed = await listTabularReviews(call.db, {
            userId: call.principal.userId,
            userEmail: (await call.userEmail()) || undefined,
            projectIdFilter: args.matter_id ?? null,
            scope: "all",
            // One more than asked tells whether there is another page.
            pagination: { limit: limit + 1, offset },
            searchTerm: args.query?.trim() || null,
            sort: { key: "created", direction: "desc" },
            workspace,
            includeStatus: true,
            ownerUserIdFilter: null,
        });
        if (!listed.ok) refuse(listed);
        const rows = (listed.data as unknown as (Review & { document_count?: number | null; is_complete?: boolean | null })[]).filter(
            (row) => !("org_id" in row) || workspaceOf(row.org_id) === workspace || !!row.project_id,
        );
        return mcpText({
            workspace,
            reviews: rows.slice(0, limit).map((row) => ({
                review_id: row.id,
                title: row.title ?? null,
                matter_id: row.project_id ?? null,
                columns: (row.columns_config ?? []).map((c) => ({ index: c.index, name: c.name })),
                document_count: row.document_count ?? null,
                role: row.access_role ?? null,
                is_running: row.is_running ?? false,
                is_complete: row.is_complete ?? null,
                created_at: row.created_at ?? null,
            })),
            next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        });
    },
});

/**
 * Creates a review in the call's workspace through `createTabularReview`, the
 * web's service. Shared by `create_tabular_review` and `run_workflow` (a
 * tabular workflow): the model is the one named or the person's saved one;
 * with neither the service answers `model_required` and nothing picks one.
 */
export async function createReviewFor(
    call: McpCall,
    args: {
        title: string;
        documentIds: string[];
        columns: { name: string; prompt: string; format?: string; tags?: string[] }[];
        matterId?: string;
        model?: string;
        workflowId?: string;
    },
) {
    const userId = call.principal.userId;
    const workspace = call.workspace!;
    const orgId = workspace === "personal" ? null : workspace;
    // The review holds only documents of its own workspace, and the connection must cover them.
    const outsideGrant = await documentsOutsideGrant(call, args.documentIds);
    if (outsideGrant.size > 0) throw notFound("The document");
    if ((await documentsOutsideGrant(call, args.documentIds, workspace)).size > 0)
        throw new McpToolError(
            "document_workspace_mismatch",
            "That document is in another workspace than the one this review is in.",
            "Pick documents of the same workspace (or matter) as the review.",
        );
    const model = args.model || (await savedTabularModel(call.db, userId, orgId)) || undefined;
    const created = await createTabularReview(call.db, {
        userId,
        userEmail: (await call.userEmail()) || undefined,
        title: args.title,
        document_ids: args.documentIds,
        columns_config: args.columns.map((column, index) => ({
            index,
            name: column.name,
            prompt: column.prompt,
            ...(column.format ? { format: column.format } : {}),
            ...(column.tags?.length ? { tags: column.tags } : {}),
        })),
        project_id: args.matterId,
        org_id: args.matterId ? undefined : orgId ?? undefined,
        model,
        ...(args.workflowId ? { workflow_id: args.workflowId } : {}),
    });
    if (!created.ok) refuse(created);
    const review = created.data as unknown as Review;
    return {
        review_id: review.id,
        title: review.title ?? args.title,
        workspace,
        matter_id: args.matterId ?? null,
        model: review.model ?? model ?? null,
        columns: args.columns.map((column, index) => ({ index, name: column.name })),
        document_count: Array.isArray(review.document_ids) ? (review.document_ids as unknown[]).length : args.documentIds.length,
        next_step: "Start the extraction with run_tabular_review.",
    };
}

export const createTabularReviewTool = defineMcpTool({
    name: "create_tabular_review",
    title: "Create a tabular review",
    description:
        "Creates a tabular review: one row per document and one column per question. It only sets the grid up and fills nothing; start the extraction with run_tabular_review. The documents must be in the review's workspace (the matter's, when matter_id is given).",
    inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        document_ids: z.array(idSchema("document_ids")).min(1).max(MAX_DOCUMENTS),
        columns: z.array(columnInput).min(1).max(MAX_COLUMNS),
        matter_id: idSchema("matter_id").optional().describe("Create it inside this matter."),
        workspace: z.string().optional().describe("Without a matter: the workspace. Defaults to the connection's default workspace."),
        model: z.string().trim().max(200).optional().describe("A model id the person has a key for. Defaults to the person's saved tabular model."),
    }),
    scope: "litt.write",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ projectId: args.matter_id ?? null }),
    resolveWorkspace: (args, call) => matterOrWorkspace(call, args.matter_id, args.workspace),
    handler: async (args, call) =>
        mcpText(
            await createReviewFor(call, {
                title: args.title,
                documentIds: args.document_ids,
                columns: args.columns,
                matterId: args.matter_id,
                model: args.model,
            }),
        ),
});

export const getTabularReviewTool = defineMcpTool({
    name: "get_tabular_review",
    title: "Get a tabular review",
    description:
        "Shows one tabular review: its columns, its rows (one per document) a page at a time, how far the extraction has got and whether a run is in progress. The cells' contents are read with read_tabular_cells.",
    inputSchema: z.object({ review_id: idSchema("review_id"), limit: limitSchema, cursor: cursorSchema }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    auditRefs: (args) => ({ reviewId: args.review_id }),
    resolveWorkspace: (args, call) => reviewWorkspace(call, args.review_id),
    handler: async (args, call) => {
        const { detail, workspace } = await loadReview(call, args.review_id);
        const columns = detail.review.columns_config ?? [];
        const offset = decodeCursor(args.cursor);
        const limit = args.limit ?? DEFAULT_PAGE;
        const rows = [...detail.rows].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
        const active = getActiveStreamRun(reviewRunKey(args.review_id));
        return mcpText({
            review_id: detail.review.id,
            title: detail.review.title ?? null,
            workspace,
            matter_id: detail.review.project_id ?? null,
            model: detail.review.model ?? null,
            role: detail.review.access_role ?? null,
            columns: columns.map((c) => ({ index: c.index, name: c.name, format: c.format ?? "text", prompt: untrusted(c.prompt ?? "") })),
            row_count: rows.length,
            rows: rows.slice(offset, offset + limit).map((row) => {
                const cells = detail.cells.filter((cell) => cell.row_id === row.id);
                return {
                    row_id: row.id,
                    // A document's file name.
                    label: row.label ?? null,
                    document_id: row.document_id ?? row.source_document_ids?.[0] ?? null,
                    cells_done: cells.filter((cell) => cell.status === "done" && cell.content).length,
                    cells_failed: cells.filter((cell) => cell.status === "error").length,
                };
            }),
            next_cursor: rows.length > offset + limit ? encodeCursor(offset + limit) : null,
            progress: progressOf(detail),
            is_running: detail.review.is_running === true,
            active_generation: active && !active.finished ? { id: active.id } : null,
            updated_at: detail.review.updated_at ?? null,
        });
    },
});

export const readTabularCells = defineMcpTool({
    name: "read_tabular_cells",
    title: "Read tabular review cells",
    description:
        "Reads the filled cells of a tabular review, a page at a time: for each cell the row's document, the column, its status and, as untrusted text taken from the documents, the answer, the reasoning and the citations with their checks. Narrow it with row_ids or column_indexes.",
    inputSchema: z.object({
        review_id: idSchema("review_id"),
        row_ids: z.array(idSchema("row_ids")).max(MAX_CELLS_PAGE).optional(),
        column_indexes: z.array(z.number().int().min(0).max(MAX_COLUMNS - 1)).max(MAX_COLUMNS).optional(),
        limit: z.number().int().min(1).max(MAX_CELLS_PAGE).optional().describe(`How many cells (1-${MAX_CELLS_PAGE}, default ${DEFAULT_PAGE}).`),
        cursor: cursorSchema,
    }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    // The cells' text comes from the documents and goes out to the client's AI.
    audit: "strict",
    auditRefs: (args) => ({ reviewId: args.review_id }),
    resolveWorkspace: (args, call) => reviewWorkspace(call, args.review_id),
    handler: async (args, call) => {
        const { detail } = await loadReview(call, args.review_id);
        const columns = new Map((detail.review.columns_config ?? []).map((c) => [c.index, c]));
        const rowsById = new Map(detail.rows.map((row) => [row.id, row]));
        const order = new Map([...detail.rows].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0)).map((row, i) => [row.id, i]));
        const wanted = detail.cells
            .filter((cell) => rowsById.has(cell.row_id))
            .filter((cell) => !args.row_ids || args.row_ids.includes(cell.row_id))
            .filter((cell) => !args.column_indexes || args.column_indexes.includes(cell.column_index))
            .sort((a, b) => (order.get(a.row_id)! - order.get(b.row_id)!) || a.column_index - b.column_index);
        const offset = decodeCursor(args.cursor);
        const limit = args.limit ?? DEFAULT_PAGE;

        const token = randomBytes(9).toString("base64url");
        const page: { cell: Cell; text: string }[] = [];
        let chars = 0;
        for (const cell of wanted.slice(offset, offset + limit)) {
            const text = JSON.stringify({
                answer: cell.content?.summary ?? null,
                flag: cell.content?.flag ?? null,
                reasoning: cell.content?.reasoning ?? null,
                citations: cell.citations ?? null,
                citation_checks: cell.review_refs ?? null,
            });
            if (page.length > 0 && chars + text.length > CELLS_PAGE_CHARS) break;
            page.push({ cell, text });
            chars += text.length;
        }
        // A pasante's draft a mentor has not approved stays in LiTT, in its cells too. A cell
        // records no version, only when it was made: it is held when any version of its
        // document not deleted before then is (see heldSince).
        const pairs = page.flatMap(({ cell }): { cell: Cell; documentId: string | null }[] => {
            const row = rowsById.get(cell.row_id);
            const sources = cell.document_id ? [cell.document_id] : row ? rowDocs(row) : [];
            return sources.length > 0 ? sources.map((documentId) => ({ cell, documentId })) : [{ cell, documentId: null }];
        });
        const judged = pairs.filter((pair): pair is { cell: Cell; documentId: string } => pair.documentId !== null);
        const heldPair = await heldSince(call.db, judged.map(({ cell, documentId }) => ({ documentId, since: cell.created_at })));
        const withheld = new Set<Cell>(pairs.filter((pair) => pair.documentId === null).map((pair) => pair.cell));
        judged.forEach(({ cell }, index) => heldPair[index] && withheld.add(cell));
        const versions = new Map(detail.documents.map((doc) => [doc.id, doc.current_version_id ?? doc.id]));
        // Record, per document, the text about to leave before it leaves.
        const perDocument = new Map<string, number>();
        for (const { cell, text } of page) {
            const row = rowsById.get(cell.row_id);
            const documentId = cell.document_id ?? row?.document_id ?? row?.source_document_ids?.[0];
            if (documentId && !withheld.has(cell)) perDocument.set(documentId, (perDocument.get(documentId) ?? 0) + text.length);
        }
        for (const [documentId, characters] of perDocument)
            await recordEgressOrFail(call, documentId, versions.get(documentId) ?? documentId, characters);

        return mcpText({
            review_id: args.review_id,
            cells: page.map(({ cell, text }) => {
                const row = rowsById.get(cell.row_id);
                return {
                    row_id: cell.row_id,
                    label: row?.label ?? null,
                    document_id: cell.document_id ?? row?.document_id ?? row?.source_document_ids?.[0] ?? null,
                    column_index: cell.column_index,
                    column_name: columns.get(cell.column_index)?.name ?? null,
                    status: cell.status,
                    data: cell.content && !withheld.has(cell) ? untrusted(text, token) : null,
                    ...(withheld.has(cell) ? { withheld_until_approved: true } : {}),
                };
            }),
            next_cursor: offset + page.length < wanted.length ? encodeCursor(offset + page.length) : null,
            notice: UNTRUSTED_NOTICE,
        });
    },
});

/**
 * Starts LiTT's extraction of a review (the web's generation) and waits a
 * little. Shared by `run_tabular_review` and `run_workflow` (a tabular workflow).
 */
export async function runReviewFor(call: McpCall, reviewId: string) {
    const userId = call.principal.userId;
    const userEmail = (await call.userEmail()) || undefined;
    // The checks POST /generate makes before it claims anything: edit standing,
    // columns, and a usable model with the person's key (no fallback).
    const prepared = await prepareTabularGenerate(call.db, { reviewId, userId, userEmail });
    if (!prepared.ok) refuse(preparedGenerateFailure(prepared));
    const started = await startTabularGeneration(call.db, {
        reviewId,
        userId,
        userEmail,
        // The tool works from the review as it is now.
        expectedUpdatedAt: String(prepared.data.review.updated_at),
        columns: prepared.data.columns,
        model: prepared.data.tabular_model,
        apiKeys: prepared.data.api_keys,
    });
    if (!started.ok) refuse(started);
    const generation = started.data;
    // The extraction is the server's and outlives this call: the slot stays until the run ends.
    call.heavy?.hold(() => !generation.run.finished);
    if (generation.aborted) {
        await generation.release();
        throw new McpToolError("generation_stopped", "The run was stopped before it began.");
    }
    // The run is the server's: it goes on without this call and ends by itself.
    void runTabularGeneration(generation);
    const finished = await waitFor(async () => (generation.run.finished ? true : null));
    const { detail } = await loadReview(call, reviewId);
    return {
        review_id: reviewId,
        generation_id: generation.generationId,
        // The same word get_tabular_run_status gives: a stopped run with cells left is not completed.
        status: finished ? runStatusOf(progressOf(detail), false) : "running",
        progress: progressOf(detail),
        ...(finished
            ? {}
            : {
                  poll_after_s: POLL_AFTER_SECONDS,
                  next_step: `The extraction continues in LiTT. Ask again with get_tabular_run_status in ${POLL_AFTER_SECONDS} seconds.`,
              }),
    };
}

export const runTabularReview = defineMcpTool({
    name: "run_tabular_review",
    title: "Run a tabular review (LiTT)",
    description:
        "Starts LiTT's extraction of a tabular review's cells that are not filled yet, with the review's own model and the person's AI key. Returns the progress; if it finishes within about 45 seconds status is completed, otherwise running and get_tabular_run_status follows it. A review already running answers review_running.",
    inputSchema: z.object({ review_id: idSchema("review_id") }),
    scope: "litt.run",
    lane: "write",
    heavy: "background",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ reviewId: args.review_id }),
    resolveWorkspace: (args, call) => reviewWorkspace(call, args.review_id),
    handler: async (args, call) => mcpText(await runReviewFor(call, args.review_id)),
});

export const getTabularRunStatus = defineMcpTool({
    name: "get_tabular_run_status",
    title: "Get a tabular run's status",
    description:
        "Shows how far a tabular review's extraction has got: cells done, failed and still to do, and whether a run is in progress. Read the finished cells with read_tabular_cells.",
    inputSchema: z.object({ review_id: idSchema("review_id") }),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    auditRefs: (args) => ({ reviewId: args.review_id }),
    resolveWorkspace: (args, call) => reviewWorkspace(call, args.review_id),
    handler: async (args, call) => {
        const { detail } = await loadReview(call, args.review_id);
        const progress = progressOf(detail);
        const active = getActiveStreamRun(reviewRunKey(args.review_id));
        const running = detail.review.is_running === true || (!!active && !active.finished);
        const columns = new Map((detail.review.columns_config ?? []).map((c) => [c.index, c.name]));
        return mcpText({
            review_id: args.review_id,
            status: runStatusOf(progress, running),
            progress,
            failed_cells: detail.cells
                .filter((cell) => cell.status === "error")
                .slice(0, 50)
                .map((cell) => ({ row_id: cell.row_id, column_index: cell.column_index, column_name: columns.get(cell.column_index) ?? null })),
            ...(running ? { poll_after_s: POLL_AFTER_SECONDS } : {}),
        });
    },
});

export const stopTabularRun = defineMcpTool({
    name: "stop_tabular_run",
    title: "Stop a tabular run",
    description:
        "Stops a tabular review's extraction that is running now. Cells already filled stay; the others go back to waiting.",
    inputSchema: z.object({ review_id: idSchema("review_id") }),
    scope: "litt.run",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ reviewId: args.review_id }),
    resolveWorkspace: (args, call) => reviewWorkspace(call, args.review_id),
    handler: async (args, call) => {
        const stopped = await stopTabularGeneration(call.db, {
            reviewId: args.review_id,
            userId: call.principal.userId,
            userEmail: (await call.userEmail()) || undefined,
        });
        if (!stopped.ok) refuse(stopped);
        return mcpText({ review_id: args.review_id, ...stopped.data });
    },
});
