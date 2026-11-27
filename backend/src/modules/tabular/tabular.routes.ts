import { BACKEND_REPORTING_OWNER } from "../../lib/reportedUpstreamCodes";
// HTTP layer of the tabular-review module. Handlers parse and validate the
// request, call the module's service files, and map their typed results onto
// status codes. No handler queries the database.
//
// One endpoint keeps more than that, because streaming is an HTTP concern a
// return value cannot express: POST /:reviewId/generate keeps its SSE loop and
// abort/heartbeat wiring. POST /:reviewId/chat attaches the turn's run to the
// response and runs tabular.chatTurn.ts, which has no `res` (so the same turn
// can run behind any transport). Everything either of them does before the
// first frame and after the last one is a service call. (The async generate stream's loop is the module's one
// documented layering exception and lives in tabular.generateStream.ts — see
// the note in that file's header.)

import { Router, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../../middleware/auth";
import {
    attachStreamRunSse,
    getActiveStreamRun,
} from "../../lib/streamRuns";
import {
    attachAssistantTurnSse,
    getActiveAssistantTurn,
    getAssistantTurnRun,
} from "../../lib/assistantTurnRuns";
import { openAssistantSse } from "../../lib/assistantSse";
import { mayWatchRun } from "../../lib/tabularReadAccess";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { recordAudit } from "../../lib/audit";
import { sendInternalError } from "../../lib/httpError";
import { isReported, reportError, setOperation } from "../../lib/observability/report";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
    ASSISTANT_ERROR_MESSAGE,
} from "../chat/chat.service";
import {
    finishGeneration,
    startGenerationHeartbeat,
    type TabularFailure,
} from "./tabular.shared";
import {
    claimTabularGeneration,
    loadTabularGenerateWork,
    preparedGenerateFailure,
    prepareTabularGenerate,
    prepareTabularRunView,
} from "./tabular.generate";
import {
    reviewRunKey,
    runTabularGeneration,
    startTabularGeneration,
    stopTabularGeneration,
} from "./tabular.generation";
import {
    streamTabularGenerateAsync,
    streamTabularRunView,
} from "./tabular.generateStream";
import { type ReviewRow } from "./tabular.rows";
import {
    createTabularReview,
    deleteTabularReview,
    getTabularReviewAccess,
    getTabularReviewDetail,
    getTabularReviewPeople,
    getTabularReviewHistoryStatuses,
    grantTabularReviewAccess,
    listProjectReviewCreators,
    listTabularReviewIds,
    listTabularReviews,
    revokeTabularReviewAccess,
    updateTabularReview,
    type DocumentGrouping,
} from "./tabular.reviews";
import {
    clearTabularReviewCells,
    regenerateTabularCell,
} from "./tabular.cells";
import {
    deleteTabularReviewChat,
    ensureReviewChatReadAccess,
    ensureReviewChatWriteAccess,
    listTabularReviewChatMessages,
    listTabularReviewChats,
    updateTabularReviewChat,
} from "./tabular.chats";
import {
    abandonTabularChatTurn,
    parseTabularChatRequest,
    runTabularChatTurn,
    startTabularChatTurn,
} from "./tabular.chatTurn";
import { draftColumnPrompt } from "./tabular.prompt";
import { parsePaginationQuery } from "../../lib/pagination";
import { normalizeSearchTerm } from "../../lib/search";
import {
    resolveWorkspaceFilter,
    sendWorkspaceFailure,
} from "../../lib/workspace";
import { parseTabularReviewSort } from "../../lib/sort";
import { parseTabularReviewScope } from "./tabular.overview";

export const tabularRouter = Router();
// The lease timings live in modules/tabular/tabular.shared.ts because the queue
// workers hold the same lease on the async path and must agree on them.

/**
 * Map a tabular service failure onto the response.
 *
 * Most failures speak the shared `ServiceFailure` vocabulary and go through
 * `sendServiceFailure`. `kind: "status"` carries the handful this module
 * answers with a status/body the shared table does not name — see the note in
 * tabular.shared.ts.
 */
function sendTabularFailure(res: Response, failure: TabularFailure): void {
    if (failure.kind === "status") {
        res.status(failure.status).json(failure.body);
        return;
    }
    sendServiceFailure(res, failure);
}

/** `?owner_user_id=` as a creator filter, or null when absent or empty. */
function ownerUserIdFilterOf(query: Record<string, unknown>): string | null {
    return typeof query.owner_user_id === "string" && query.owner_user_id
        ? query.owner_user_id
        : null;
}

/** `?project_id=` as a filter, or null when it is absent or empty. */
function projectIdFilterOf(query: Record<string, unknown>): string | null {
    return typeof query.project_id === "string" && query.project_id
        ? query.project_id
        : null;
}

// GET /tabular-review
tabularRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const db = createServerSupabase();
    const userId = res.locals.userId as string;
    const workspace = await resolveWorkspaceFilter(db, userId, query.workspace);
    if (!workspace.ok) return void sendWorkspaceFailure(res, workspace);
    const result = await listTabularReviews(db, {
        userId,
        userEmail: res.locals.userEmail as string | undefined,
        projectIdFilter: projectIdFilterOf(query),
        scope: parseTabularReviewScope(query.scope),
        pagination: parsePaginationQuery(query),
        searchTerm: normalizeSearchTerm(query.search),
        sort: parseTabularReviewSort(query),
        workspace: workspace.workspace,
        includeStatus: query.include === "status",
        ownerUserIdFilter: ownerUserIdFilterOf(query),
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// Only small status snapshots; the RPC rechecks review access for every id.
tabularRouter.get("/history-status", requireAuth, asyncRoute(async (req, res) => {
    const ids = typeof req.query.ids === "string" ? req.query.ids.split(",") : [];
    if (ids.length === 0 || ids.length > 100 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
        return void res.status(400).json({ detail: "Provide between 1 and 100 valid review ids" });
    }
    const result = await getTabularReviewHistoryStatuses(
        createServerSupabase(), res.locals.userId as string,
        res.locals.userEmail as string | undefined, [...new Set(ids)],
    );
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// GET /tabular-review/ids (must come before /:reviewId routes)
// Lightweight id + owner list for every review matching the current
// filters — backs "select all matching" bulk actions so the client doesn't
// have to page through full review payloads just to collect checkboxes.
tabularRouter.get("/ids", requireAuth, asyncRoute(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const db = createServerSupabase();
    const userId = res.locals.userId as string;
    const workspace = await resolveWorkspaceFilter(db, userId, query.workspace);
    if (!workspace.ok) return void sendWorkspaceFailure(res, workspace);
    const result = await listTabularReviewIds(db, {
        userId,
        userEmail: res.locals.userEmail as string | undefined,
        projectIdFilter: projectIdFilterOf(query),
        scope: parseTabularReviewScope(query.scope),
        searchTerm: normalizeSearchTerm(query.search),
        workspace: workspace.workspace,
        ownerUserIdFilter: ownerUserIdFilterOf(query),
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// GET /tabular-review/creators?project_id= (must come before /:reviewId)
// The people behind a project's reviews, for its Creator filter.
tabularRouter.get("/creators", requireAuth, asyncRoute(async (req, res) => {
    const projectId = projectIdFilterOf(req.query as Record<string, unknown>);
    if (!projectId) return void res.status(400).json({ detail: "project_id is required" });
    const result = await listProjectReviewCreators(createServerSupabase(), {
        projectId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// POST /tabular-review
tabularRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    const {
        title,
        document_ids,
        columns_config,
        workflow_id,
        project_id,
        org_id,
        document_grouping,
        model,
    } = req.body as {
        title?: string;
        document_ids: string[];
        columns_config: { index: number; name: string; prompt: string }[];
        workflow_id?: string;
        project_id?: string;
        org_id?: unknown;
        document_grouping?: DocumentGrouping;
        model?: string;
    };

    const result = await createTabularReview(createServerSupabase(), {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        title,
        document_ids,
        columns_config,
        workflow_id,
        project_id,
        org_id,
        document_grouping,
        model,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.status(201).json(result.data);
}));

// POST /tabular-review/prompt (must come before /:reviewId routes)
tabularRouter.post("/prompt", requireAuth, asyncRoute(async (req, res) => {
    const result = await draftColumnPrompt(createServerSupabase(), {
        userId: res.locals.userId as string,
        title: typeof req.body.title === "string" ? req.body.title.trim() : "",
        format: typeof req.body.format === "string" ? req.body.format : "text",
        documentName:
            typeof req.body.documentName === "string"
                ? req.body.documentName.trim()
                : "",
        tags: Array.isArray(req.body.tags)
            ? req.body.tags.filter((t: unknown) => typeof t === "string")
            : [],
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// GET /tabular-review/:reviewId
tabularRouter.get("/:reviewId", requireAuth, asyncRoute(async (req, res) => {
    const { reviewId } = req.params;
    const db = createServerSupabase();
    const reader = {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    };
    const result = await getTabularReviewDetail(db, { reviewId, ...reader });
    if (!result.ok) return void sendTabularFailure(res, result);
    // A generation this process is running, so a client that has just loaded
    // (a refresh, a second tab) knows to attach to it — and that it may stop
    // it. `review.is_running` is the lease, which an async or another
    // replica's run also holds; this is the stronger, stoppable statement.
    // Only a reader who may watch the run is told about it.
    const run = getActiveStreamRun(reviewRunKey(reviewId));
    res.json({
        ...result.data,
        active_generation:
            run && !run.finished && (await mayWatchRun(db, run, reader))
                ? { id: run.id, seq: run.seq }
                : null,
    });
}));

// GET /tabular-review/:reviewId/people
// Owner email + display_name plus member display_names — the analog of
// /projects/:id/people. Used by the standalone TR detail page's People
// modal so the roster can show display_names alongside emails.
tabularRouter.get("/:reviewId/people", requireAuth, asyncRoute(async (req, res) => {
    const result = await getTabularReviewPeople(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// GET /tabular-review/:reviewId/access — role-aware direct grants, admin-only.
tabularRouter.get("/:reviewId/access", requireAuth, asyncRoute(async (req, res) => {
    const result = await getTabularReviewAccess(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// POST /tabular-review/:reviewId/access — grant or re-role one recipient.
tabularRouter.post("/:reviewId/access", requireAuth, asyncRoute(async (req, res) => {
    const result = await grantTabularReviewAccess(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        email: req.body?.email,
        role: req.body?.role,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.status(201).json(result.data);
}));

// DELETE /tabular-review/:reviewId/access/:email — revoke one recipient.
tabularRouter.delete(
    "/:reviewId/access/:email",
    requireAuth,
    asyncRoute(async (req, res) => {
        const result = await revokeTabularReviewAccess(createServerSupabase(), {
            reviewId: req.params.reviewId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            email: decodeURIComponent(req.params.email),
        });
        if (!result.ok) return void sendTabularFailure(res, result);
        res.status(204).send();
    }),
);

// PATCH /tabular-review/:reviewId
tabularRouter.patch("/:reviewId", requireAuth, asyncRoute(async (req, res) => {
    const result = await updateTabularReview(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        body: (req.body ?? {}) as Record<string, unknown>,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.json(result.data);
}));

// DELETE /tabular-review/:reviewId
tabularRouter.delete("/:reviewId", requireAuth, asyncRoute(async (req, res) => {
    const result = await deleteTabularReview(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.status(204).send();
}));

// POST /tabular-review/:reviewId/clear-cells
// Reset cells to an empty/pending state for the given row_ids. Does not
// delete the rows — it blanks `content` and sets `status` back to "pending".
tabularRouter.post("/:reviewId/clear-cells", requireAuth, asyncRoute(async (req, res) => {
    const { row_ids } = req.body as { row_ids?: string[] };
    if (!Array.isArray(row_ids) || row_ids.length === 0)
        return void res.status(400).json({ detail: "row_ids is required" });

    const result = await clearTabularReviewCells(createServerSupabase(), {
        reviewId: req.params.reviewId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        rowIds: row_ids,
        log: console,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    res.status(204).send();
}));

// POST /tabular-review/:reviewId/regenerate-cell
tabularRouter.post(
    "/:reviewId/regenerate-cell",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("tabular.cell");
        const { row_id, column_index } = req.body as {
            row_id?: string;
            column_index: number;
        };
        if (!row_id || column_index == null)
            return void res
                .status(400)
                .json({ detail: "row_id and column_index are required" });

        const result = await regenerateTabularCell(createServerSupabase(), {
            reviewId: req.params.reviewId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            rowId: row_id,
            columnIndex: column_index,
            log: console,
        });
        if (!result.ok) return void sendTabularFailure(res, result);
        res.status(result.data.status).json(result.data.body);
    }),
);

// POST /tabular-review/:reviewId/generate
tabularRouter.post("/:reviewId/generate", requireAuth, asyncRoute(async (req, res) => {
    setOperation("tabular.run");
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();
    // Phase 1 (the pre-lease guards) is still tied to the request: nothing has
    // been claimed yet, so a caller that walks away costs nothing to drop.
    // Once the lease is claimed the SYNCHRONOUS path hands ownership to a
    // server-owned run and this controller stops being consulted (see
    // tabular.generation.ts, which the MCP tools share); the async path keeps
    // it, because there the request is only a view over the queue.
    const requestAbort = new AbortController();
    const asyncPath = process.env.ASYNC_TABULAR_EXTRACTION === "true";
    req.on("aborted", () => requestAbort.abort());

    // Pre-lease guards only (review, access, columns, model policy). Row and
    // cell state is deliberately NOT read here — see the note at the lease
    // claim.
    const prepared = await prepareTabularGenerate(db, {
        reviewId,
        userId,
        userEmail,
    });
    if (!prepared.ok)
        return void sendTabularFailure(res, preparedGenerateFailure(prepared));
    const { columns, tabular_model, api_keys } = prepared.data;

    const expectedUpdatedAt = req.body?.expected_updated_at;
    if (
        typeof expectedUpdatedAt !== "string" ||
        !Number.isFinite(Date.parse(expectedUpdatedAt))
    ) {
        return void res.status(400).json({
            detail: "expected_updated_at must be a valid timestamp",
        });
    }
    if (requestAbort.signal.aborted || res.destroyed) return;

    if (!asyncPath) {
        const started = await startTabularGeneration(db, {
            reviewId,
            userId,
            userEmail,
            expectedUpdatedAt,
            columns,
            model: tabular_model,
            apiKeys: api_keys,
        });
        if (!started.ok) return void sendTabularFailure(res, started);
        const generation = started.data;
        if (generation.aborted) {
            await generation.release();
            if (!res.writableEnded) res.end();
            return;
        }
        // Only now does the response become a stream: everything above can
        // still answer with a status code, and attaching earlier would make
        // an internal error unreportable.
        attachStreamRunSse(res, generation.run, 1, () =>
            mayWatchRun(db, generation.run, { userId, userEmail }),
        );
        await runTabularGeneration(generation);
        if (!res.writableEnded) res.end();
        return;
    }

    const generationId = randomUUID();
    let leaseHeartbeat: ReturnType<typeof setInterval> | null = null;
    const claim = await claimTabularGeneration(db, {
        reviewId,
        expectedUpdatedAt,
        generationId,
    });
    if (!claim.ok) return void sendTabularFailure(res, claim);

    const generationSignal = requestAbort.signal;
    const abortGeneration = () => requestAbort.abort();

    // Everything used to decide which cells need work is loaded only after
    // the atomic lease claim. Otherwise, a request can snapshot pending cells
    // while another run is finishing, acquire the newly released lease, and
    // regenerate results that were completed after its stale snapshot.
    let rows: ReviewRow[] = [];
    let cellMap = new Map<string, Record<string, unknown>>();

    // The async path hands the lease to the queue workers (they renew it, and
    // the last one out releases it) because the work outlives this request.
    // While that is true this handler must neither release the lease nor end
    // the response in its `finally`.
    let leaseHandedOff = false;
    let streamFinished = false;
    res.on("close", () => {
        if (!streamFinished) requestAbort.abort();
    });

    try {
        // Losing the lease means a successor now owns these cells, so the
        // only safe response is to stop writing: abort, and let `finally`
        // close the stream.
        leaseHeartbeat = startGenerationHeartbeat({
            db,
            reviewId,
            generationId,
            skip: () => generationSignal.aborted,
            onLost: abortGeneration,
        });

        const work = await loadTabularGenerateWork(db, {
            reviewId,
            userId,
            userEmail,
        });
        if (!work.ok) {
            sendInternalError(res, work.error);
            return;
        }
        rows = work.data.rows;
        cellMap = work.data.cellMap;

        if (generationSignal.aborted || res.destroyed) return;

        // Hand extraction to the durable queue and turn this request into a
        // reconnectable view that tails progress. The work survives a
        // disconnect and retries on failure.
        // The workers renew the lease from here on, so stop our heartbeat
        // before handing over — two renewers would just race each other.
        if (leaseHeartbeat) {
            clearInterval(leaseHeartbeat);
            leaseHeartbeat = null;
        }
        leaseHandedOff = await streamTabularGenerateAsync({
            res,
            db,
            reviewId,
            userId,
            userEmail,
            generationId,
            columns,
            rows,
            cellMap,
            log: console,
        });
        void recordAudit(db, {
            userId,
            userEmail,
            action: "tabular.generated",
            surface: "tabular",
            reviewId,
        });
    } catch (err) {
        if (!generationSignal.aborted) {
            if (!isReported(err)) reportError(err, { tags: { operation: "tabular.generate", stage: "generation-stream" } });
            console.error("[tabular/generate] stream error", err);
            if (res.headersSent) {
                try {
                    res.write(
                        `data: ${JSON.stringify({ type: "error", message: ASSISTANT_ERROR_MESSAGE, reporting_owner: BACKEND_REPORTING_OWNER })}\n\ndata: [DONE]\n\n`,
                    );
                } catch {
                    /* ignore */
                }
            } else if (!res.destroyed && !res.writableEnded) {
                res.status(500).json({
                    detail: "Failed to prepare tabular review generation",
                    reporting_owner: BACKEND_REPORTING_OWNER,
                });
            }
        }
    } finally {
        streamFinished = true;
        if (leaseHeartbeat) clearInterval(leaseHeartbeat);
        // On the async path the lease now belongs to the workers and the SSE
        // view is still tailing them, so neither is ours to close.
        if (!leaseHandedOff) {
            await finishGeneration(
                db,
                reviewId,
                generationId,
                console,
                "[tabular/generate]",
            );
            if (!res.writableEnded) res.end();
        }
    }
}));

// POST /tabular-review/:reviewId/generate/stop
// The one way to cut a synchronous generation short. Closing the SSE socket
// no longer does it, so the client's Stop control calls this. Stopping is a
// write on the review, so it needs exactly what starting the run needed —
// a viewer is refused here as they are at POST /generate.
//
// A deployment running the async path (ASYNC_TABULAR_EXTRACTION) registers no
// run: its work belongs to the queue, so there is nothing in this process to
// stop and the answer is 404 generation_not_found. The same answer covers a
// run owned by another replica.
tabularRouter.post(
    "/:reviewId/generate/stop",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("tabular.run");
        const stopped = await stopTabularGeneration(createServerSupabase(), {
            reviewId: req.params.reviewId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!stopped.ok) return void sendTabularFailure(res, stopped);
        res.json(stopped.data);
    }),
);

// GET /tabular-review/:reviewId/generate/stream — reconnect to an in-flight (or
// just-finished) generate run without re-triggering work. A client whose POST
// /generate stream dropped can resume here and catch up on the remaining cells.
// Pure observer: it never enqueues and takes NO generation lease, so watching a
// run can never block it or make a legitimate POST 409. (Registered before the
// /:reviewId/chats group; no path collision since the segments differ.)
tabularRouter.get(
    "/:reviewId/generate/stream",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("tabular.run");
        const { reviewId } = req.params;
        const db = createServerSupabase();
        const view = await prepareTabularRunView(db, {
            reviewId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!view.ok) return void sendTabularFailure(res, view);

        // An in-process run is the better answer: it has every frame this
        // generation has emitted, so a client that dropped replays from the
        // sequence number it last saw and then tails the live ones. Replaying
        // `cell_update` frames is idempotent, so `from` defaults to the start.
        const run = getActiveStreamRun(reviewRunKey(reviewId));
        if (
            run &&
            (await mayWatchRun(db, run, {
                userId: res.locals.userId as string,
                userEmail: res.locals.userEmail as string | undefined,
            }))
        ) {
            const rawFrom = Number.parseInt(String(req.query.from ?? "1"), 10);
            const from = Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : 1;
            const reader = {
                userId: res.locals.userId as string,
                userEmail: res.locals.userEmail as string | undefined,
            };
            return void attachStreamRunSse(res, run, from, () =>
                mayWatchRun(db, run, reader),
            );
        }

        // No run here: the async path (the work is the queue's), another
        // replica, a lease with nothing attached, or a run this reader may
        // not watch (it is built from documents they cannot read). Tail the
        // DB instead, which shows them only their own view of the rows.
        await streamTabularRunView({
            res,
            db,
            reviewId,
            columns: view.data.columns,
            rows: view.data.rows,
            cellMap: view.data.cellMap,
            log: console,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
    }),
);

// GET /tabular-review/:reviewId/chats — list chats (metadata only, no messages)
tabularRouter.get("/:reviewId/chats", requireAuth, asyncRoute(async (req, res) => {
    const db = createServerSupabase();
    const reader = {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    };
    const result = await listTabularReviewChats(db, {
        reviewId: req.params.reviewId,
        ...reader,
    });
    if (!result.ok) return void sendTabularFailure(res, result);
    // Each row carries the turn this process is still generating into it, if
    // any, so a panel that has just loaded (a refresh, a second tab, a chat
    // opened from the list while its answer runs elsewhere) attaches instead
    // of showing a finished-looking transcript with the answer missing. The
    // messages endpoint keeps its bare array shape: it is the transcript, and
    // the transcript does not have the running turn in it yet.
    // Only a reader who may watch the turn is told about it.
    res.json(
        await Promise.all(
            result.data.map(async (chat) => {
                const active = getActiveAssistantTurn(chat.id, "tabular");
                const run = active && getAssistantTurnRun(active.id, "tabular");
                return {
                    ...chat,
                    active_turn:
                        run && (await mayWatchRun(db, run, reader)) ? active : null,
                };
            }),
        ),
    );
}));

// GET /tabular-review/:reviewId/chats/:chatId/turn/:turnId/stream?from=<seq>
// Attach to a turn that is (or was, within the retention window) generating
// into this review chat. Frames with a sequence number >= `from` are
// replayed, then the live ones follow until the turn ends. Seeing the review
// is enough to watch, exactly as it is enough to read the transcript.
tabularRouter.get(
    "/:reviewId/chats/:chatId/turn/:turnId/stream",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("tabular.chat");
        const { reviewId, chatId, turnId } = req.params;
        const db = createServerSupabase();
        const reader = {
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        };
        const gate = await ensureReviewChatReadAccess(
            db,
            reviewId,
            chatId,
            reader.userId,
            reader.userEmail,
        );
        if (!gate.ok) return void sendTabularFailure(res, gate);

        const run = getAssistantTurnRun(turnId, "tabular");
        // A turn the reader may not watch answers like one that is gone.
        if (!run || run.chatId !== chatId || !(await mayWatchRun(db, run, reader))) {
            return void res.status(404).json({
                code: "turn_not_found",
                detail: "This response is no longer being generated.",
            });
        }
        const rawFrom = Number.parseInt(String(req.query.from ?? "1"), 10);
        const from = Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : 1;
        attachAssistantTurnSse(res, run, from);
    }),
);

// POST /tabular-review/:reviewId/chats/:chatId/turn/:turnId/stop
// The one way to cut a review-chat answer short. Closing the SSE socket no
// longer does it, so the panel's Stop control calls this. Stopping needs the
// same standing as sending into the thread: review chats are creator-write,
// so this is the gate PATCH and DELETE use.
tabularRouter.post(
    "/:reviewId/chats/:chatId/turn/:turnId/stop",
    requireAuth,
    asyncRoute(async (req, res) => {
        setOperation("tabular.chat");
        const { reviewId, chatId, turnId } = req.params;
        const gate = await ensureReviewChatWriteAccess(
            createServerSupabase(),
            reviewId,
            chatId,
            res.locals.userId as string,
            res.locals.userEmail as string | undefined,
        );
        if (!gate.ok) return void sendTabularFailure(res, gate);

        const run = getAssistantTurnRun(turnId, "tabular");
        if (!run || run.chatId !== chatId) {
            return void res.status(404).json({
                code: "turn_not_found",
                detail: "This response is no longer being generated.",
            });
        }
        if (run.finished) return void res.json({ stopped: false, finished: true });
        run.stop();
        res.json({ stopped: true, finished: false });
    }),
);

// DELETE /tabular-review/:reviewId/chats/:chatId — delete a single chat
tabularRouter.delete(
    "/:reviewId/chats/:chatId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const result = await deleteTabularReviewChat(createServerSupabase(), {
            reviewId: req.params.reviewId,
            chatId: req.params.chatId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
        });
        if (!result.ok) return void sendTabularFailure(res, result);
        res.status(204).send();
    }),
);

// PATCH /tabular-review/:reviewId/chats/:chatId — update chat settings
tabularRouter.patch(
    "/:reviewId/chats/:chatId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const result = await updateTabularReviewChat(createServerSupabase(), {
            reviewId: req.params.reviewId,
            chatId: req.params.chatId,
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            body:
                req.body &&
                typeof req.body === "object" &&
                !Array.isArray(req.body)
                    ? (req.body as Record<string, unknown>)
                    : {},
        });
        if (!result.ok) return void sendTabularFailure(res, result);
        res.json(result.data);
    }),
);

// GET /tabular-review/:reviewId/chats/:chatId/messages — messages for a single chat
tabularRouter.get(
    "/:reviewId/chats/:chatId/messages",
    requireAuth,
    asyncRoute(async (req, res) => {
        const result = await listTabularReviewChatMessages(
            createServerSupabase(),
            {
                reviewId: req.params.reviewId,
                chatId: req.params.chatId,
                userId: res.locals.userId as string,
                userEmail: res.locals.userEmail as string | undefined,
            },
        );
        if (!result.ok) return void sendTabularFailure(res, result);
        res.json(result.data);
    }),
);

// ---------------------------------------------------------------------------
// POST /tabular-review/:reviewId/chat — agentic streaming
// ---------------------------------------------------------------------------

// POST /tabular-review/:reviewId/chat
tabularRouter.post("/:reviewId/chat", requireAuth, asyncRoute(async (req, res) => {
    setOperation("tabular.chat");
    const parsed = parseTabularChatRequest(req.body);
    if (!parsed.ok) {
        return void res.status(parsed.status).json({ detail: parsed.detail });
    }
    const db = createServerSupabase();
    const turn = await startTabularChatTurn(db, {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        reviewId: req.params.reviewId,
        parsed: parsed.value,
    });
    if (!turn.ok) {
        if (turn.kind === "turn_in_progress") {
            return void res.status(409).json({
                code: "turn_in_progress",
                detail: "A response is already being generated for this chat.",
            });
        }
        return void sendTabularFailure(res, turn);
    }
    // `prepareTabularChat` is allowed to return no chat id (chat creation was
    // skipped); there is then no thread to key a run on and nothing that
    // could ever attach to it, so THAT request alone keeps the old
    // single-socket contract: closing the socket aborts it.
    let sink;
    try {
        sink = turn.started.run
            ? attachAssistantTurnSse(res, turn.started.run)
            : openAssistantSse(res);
    } catch (error) {
        await abandonTabularChatTurn(db, turn.started);
        throw error;
    }
    await runTabularChatTurn(db, turn.started, turn.started.run ?? sink);
}));

tabularRouter.use(routerErrorHandler("[tabular]"));
