import {
    attachAssistantTurnSse,
    getActiveAssistantTurn,
    getAssistantTurnRun,
} from "../../lib/assistantTurnRuns";
// HTTP layer for the chat module.
//
// Route handlers parse params/query/body, call the chat.service functions,
// and map their typed results onto status codes and JSON. POST /chat is the
// thin adapter of the chat turn (chat.turn.ts): it parses, starts the turn,
// attaches the response to the turn's run, and runs the generation loop,
// which writes frames to the run rather than to `res`.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import {
    parseOptionalModel,
    parseOptionalReasoning,
    parseOptionalProjectId,
    requestIdOf,
} from "./engine/index";
import { setOperation } from "../../lib/observability/report";
import { mayDeleteChat, normalizeEmail } from "../../lib/access";
import { withReadableChatTitles } from "../../lib/chatReadAccess";
import { teamOrgIdOf } from "../../lib/personalOrgs";
import { can } from "../../lib/permissions";
import { sendInternalError } from "../../lib/httpError";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
    abandonChatTurn,
    parseChatTurnRequest,
    runChatTurn,
    startChatTurn,
} from "./chat.turn";
import {
    createChat,
    deleteChat,
    getAccessibleChat,
    getChatMessages,
    grantChatAccess,
    listChatGrants,
    listChatPeople,
    listChats,
    revokeChatAccess,
    leaveChat,
    withChatLeaveAccess,
    updateChatSettings,
} from "./chat.service";
import {
    resolveWorkspaceFilter,
    sendWorkspaceFailure,
} from "../../lib/workspace";

export const chatRouter = Router();

// GET /chat
// Lists every chat the caller could open: the RPC's predicate mirrors
// ensureChatAccess branch for branch (creator, direct grant, accessible
// project), so the list and GET /chat/:chatId can never disagree
// about what exists. Each row carries is_owner so the sidebar can tell the
// caller's own chats from colleagues' ones — provenance, not a role.
chatRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const requestedOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : null;
    const offset =
        Number.isFinite(requestedOffset) && requestedOffset > 0
            ? requestedOffset
            : 0;
    const beforeUpdatedAt =
        typeof req.query.before_updated_at === "string"
            ? req.query.before_updated_at
            : null;
    const beforeId =
        typeof req.query.before_id === "string" ? req.query.before_id : null;
    if ((beforeUpdatedAt === null) !== (beforeId === null)) {
        return void res.status(400).json({
            detail: "before_updated_at and before_id must be provided together",
        });
    }
    if (
        beforeUpdatedAt !== null &&
        (!Number.isFinite(Date.parse(beforeUpdatedAt)) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                beforeId!,
            ))
    ) {
        return void res.status(400).json({ detail: "Invalid chat cursor" });
    }

    const workspace = await resolveWorkspaceFilter(
        db,
        userId,
        req.query.workspace,
    );
    if (!workspace.ok) return void sendWorkspaceFailure(res, workspace);

    const result = await listChats(db, {
        userId,
        userEmail,
        limit,
        offset,
        beforeUpdatedAt,
        beforeId,
        workspace: workspace.workspace,
    });
    if (!result.ok) return void sendInternalError(res, result.error);
    res.json(result.data);
}));

// POST /chat/create
chatRouter.post("/create", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const parsedProjectId = parseOptionalProjectId(req.body?.project_id);
    if (!parsedProjectId.ok) {
        return void res.status(400).json({ detail: parsedProjectId.detail });
    }
    const projectId = parsedProjectId.value.projectId;
    const db = createServerSupabase();

    const result = await createChat(db, {
        userId,
        userEmail,
        projectId,
        orgId: req.body?.org_id,
    });
    if (!result.ok) {
        if (result.kind === "error")
            return void sendInternalError(res, result.error);
        return void res.status(result.status).json({ detail: result.detail });
    }
    res.json({ id: result.id });
}));

// GET /chat/:chatId
chatRouter.get("/:chatId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();

    // Reading a chat only needs visibility (project.view) — org viewers
    // are allowed here even though they cannot write to the chat.
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });

    const leaveAccess = await withChatLeaveAccess(
        db,
        [{ ...access.chat, access_role: access.projectRole }],
        userEmail,
    );
    if (!leaveAccess.ok) return void sendServiceFailure(res, leaveAccess);
    const messages = await getChatMessages(db, chatId, { userId, userEmail });
    // access_role/is_owner mirror the project and review detail responses so
    // the client can render per-role affordances instead of re-deriving them.
    // origin_grant_id links the chat to an MCP grant: not for chat readers.
    const { origin_grant_id: _originGrantId, ...chatForReader } = access.chat as typeof access.chat & { origin_grant_id?: unknown };
    const [titledChat] = await withReadableChatTitles(db, { userId, userEmail }, [chatForReader]);
    res.json({
        chat: { ...titledChat, can_leave: leaveAccess.data[0].can_leave },
        is_owner: access.isCreator,
        access_role: access.projectRole,
        messages,
        // A turn still generating into this chat, so a client that has just
        // loaded (a refresh, a second tab) can attach to it instead of
        // showing the hidden reservation as "no answer".
        active_turn: getActiveAssistantTurn(chatId),
    });
}));

// POST /chat/:chatId/leave — revoke only the authenticated recipient.
chatRouter.post("/:chatId/leave", requireAuth, asyncRoute(async (req, res) => {
    const result = await leaveChat(createServerSupabase(), {
        chatId: req.params.chatId,
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(204).end();
}));

// GET /chat/:chatId/turn/:turnId/stream?from=<seq>
// Attach to a turn that is (or was, within the retention window) generating
// into this chat. Frames with a sequence number >= `from` are replayed, then
// the live ones follow until the turn ends. Visibility is enough to watch,
// as it is for reading the transcript. Project chats use this too: the turn
// is keyed by chat, not by the route that started it.
chatRouter.get("/:chatId/turn/:turnId/stream", requireAuth, asyncRoute(async (req, res) => {
    setOperation("chat.turn");
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId, turnId } = req.params;
    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    const run = getAssistantTurnRun(turnId);
    if (!run || run.chatId !== chatId) {
        return void res.status(404).json({
            code: "turn_not_found",
            detail: "This response is no longer being generated.",
        });
    }
    const rawFrom = Number.parseInt(String(req.query.from ?? "1"), 10);
    const from = Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : 1;
    attachAssistantTurnSse(res, run, from);
}));

// POST /chat/:chatId/turn/:turnId/stop
// The one way to cut a generation short. Closing the SSE socket no longer
// does it, so the client's Stop control calls this. Stopping needs the same
// standing as sending: the thread's creator, or content.edit on the project.
chatRouter.post("/:chatId/turn/:turnId/stop", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId, turnId } = req.params;
    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    if (!access.isCreator && !can(access.projectRole, "content.edit")) {
        return void res.status(403).json({
            code: "chat_write_forbidden",
            detail: "Only the chat's creator or a project editor can stop this response.",
        });
    }
    const run = getAssistantTurnRun(turnId);
    if (!run || run.chatId !== chatId) {
        return void res.status(404).json({
            code: "turn_not_found",
            detail: "This response is no longer being generated.",
        });
    }
    if (run.finished) return void res.json({ stopped: false, finished: true });
    run.stop();
    res.json({ stopped: true, finished: false });
}));

// GET /chat/:chatId/people
// The chat's creator + every direct grantee, resolved to
// {email, display_name, role} — the same roster shape as
// GET /projects/:projectId/people, including its nullable `owner` (a chat in
// an organization project outlives its author's account). Visible to anyone
// who can see the chat.
chatRouter.get("/:chatId/people", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();

    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });

    const people = await listChatPeople(db, access.chat);
    if (!people.ok) return void sendInternalError(res, people.detail);
    res.json(people);
}));

// GET /chat/:chatId/access — role-aware direct grants, admin-only.
chatRouter.get("/:chatId/access", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    if (!can(access.projectRole, "access.manage"))
        return void res.status(403).json({
            detail: "Only a chat owner can change who has access.",
        });
    if (access.chat.project_id)
        return void res.json({
            scope: "project",
            inherited_from_project_id: access.chat.project_id,
            org_id: access.chat.org_id ?? null,
            access_role: access.projectRole,
            grants: [],
        });
    const listed = await listChatGrants(db, chatId);
    if (!listed.ok) return void sendInternalError(res, listed.detail);
    res.json({
        scope: "direct",
        // The organization whose members it can be shared with, or null for
        // a personal chat, which can be shared with anyone.
        org_id: await teamOrgIdOf(db, access.chat.org_id),
        access_role: access.projectRole,
        grants: listed.grants,
    });
}));

// POST /chat/:chatId/access — grant or re-role one recipient.
chatRouter.post("/:chatId/access", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    if (!can(access.projectRole, "access.manage"))
        return void res.status(403).json({
            detail: "Only a chat owner can change who has access.",
        });
    if (access.chat.project_id)
        return void res.status(409).json({
            code: "access_inherited",
            detail: "Project-owned chats inherit access from their project.",
        });
    const email = normalizeEmail(
        typeof req.body?.email === "string" ? req.body.email : null,
    );
    if (email && normalizeEmail(userEmail) === email)
        return void res
            .status(400)
            .json({ detail: "You cannot share a chat with yourself." });
    if (req.body?.role === "deny")
        return void res.status(400).json({
            detail: "Deny is only available for organization members",
        });
    const result = await grantChatAccess(db, {
        chatId,
        chat: access.chat,
        userId,
        email: req.body?.email,
        role: req.body?.role,
    });
    if (!result.ok) {
        if (result.kind === "validation")
            return void res.status(400).json({ detail: result.detail });
        return void sendInternalError(res, result.detail);
    }
    res.status(201).json(result.grant);
}));

// DELETE /chat/:chatId/access/:email — revoke one recipient.
chatRouter.delete("/:chatId/access/:email", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    if (!can(access.projectRole, "access.manage"))
        return void res.status(403).json({
            detail: "Only a chat owner can change who has access.",
        });
    if (access.chat.project_id)
        return void res.status(409).json({
            code: "access_inherited",
            detail: "Project-owned chats inherit access from their project.",
        });
    const result = await revokeChatAccess(db, {
        chatId,
        email: decodeURIComponent(req.params.email),
    });
    if (!result.ok) return void sendInternalError(res, result.detail);
    if (!result.removed)
        return void res.status(404).json({ detail: "Access grant not found" });
    res.status(204).send();
}));

// PATCH /chat/:chatId — rename and/or edit sharing.
chatRouter.patch("/:chatId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    let title: string | undefined;
    const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>)
            : {};

    // Validate the SHAPE of what arrived instead of coercing it.
    // `String(req.body.title)` accepts anything: `{}` becomes the literal
    // title "[object Object]" and `42` becomes "42", so a client bug is
    // stored as data and discovered later by a human reading a nonsense chat
    // name. Refusing names the problem while it is still fixable.
    if (body.title != null) {
        if (typeof body.title !== "string")
            return void res
                .status(400)
                .json({ detail: "title must be a string" });
        const trimmed = body.title.trim();
        if (!trimmed)
            return void res.status(400).json({ detail: "title is required" });
        title = trimmed;
    }
    if ("shared_with" in body)
        return void res.status(400).json({
            detail:
                "shared_with is no longer supported; use the chat access endpoints.",
        });
    const hasModel = req.body.model != null;
    const parsedModel = parseOptionalModel(req.body.model);
    if (hasModel && !parsedModel.ok) {
        return void res.status(400).json({ detail: parsedModel.detail });
    }
    const hasReasoning = req.body.reasoningLevel != null;
    const parsedReasoning = parseOptionalReasoning(req.body.reasoningLevel);
    if (hasReasoning && !parsedReasoning.ok) {
        return void res.status(400).json({ detail: parsedReasoning.detail });
    }

    if (title === undefined && !hasModel && !hasReasoning)
        return void res.status(400).json({
            detail: "title, model or reasoningLevel is required",
        });

    const db = createServerSupabase();
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    // Managing the chat title belongs to owners; editors can still send
    // messages and choose the model/reasoning used for their responses.
    if (title != null && !can(access.projectRole, "access.manage"))
        return void res
            .status(403)
            .json({ detail: "You do not have permission to modify this chat" });
    if ((hasModel || hasReasoning) && !can(access.projectRole, "content.edit"))
        return void res
            .status(403)
            .json({ detail: "You do not have permission to modify this chat" });

    const result = await updateChatSettings(db, {
        chatId,
        userId,
        chatModel: access.chat.model,
        chatRow: access.chat,
        orgId: access.chat.org_id ?? null,
        ...(title !== undefined ? { title } : {}),
        ...(hasModel
            ? {
                  requestedModel: parsedModel.ok
                      ? parsedModel.value
                      : undefined,
              }
            : {}),
        ...(hasReasoning && parsedReasoning.ok && parsedReasoning.value
            ? { reasoningLevel: parsedReasoning.value }
            : {}),
    });
    if (!result.ok) {
        if (result.kind === "model")
            return void res
                .status(result.status)
                .json({ code: result.code, detail: result.detail });
        if (result.kind === "error")
            return void sendInternalError(res, result.error);
        return void res.status(404).json({ detail: "Chat not found" });
    }
    res.json(result.data);
}));

// DELETE /chat/:chatId
chatRouter.delete("/:chatId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();
    // Owners may delete any chat. An editor may delete a chat they started;
    // authorship never restores write access after a downgrade to Viewer.
    const access = await getAccessibleChat(db, { chatId, userId, userEmail });
    if (!access.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    if (!mayDeleteChat(access))
        return void res
            .status(403)
            .json({ detail: "You do not have permission to delete this chat" });

    const result = await deleteChat(db, { chatId });
    if (!result.ok) return void sendInternalError(res, result.error);
    res.status(204).send();
}));

// POST /chat — streaming
chatRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    setOperation("chat.turn");
    const parsed = parseChatTurnRequest(req.body);
    if (!parsed.ok) {
        return void res.status(parsed.status).json({ detail: parsed.detail });
    }
    const db = createServerSupabase();
    const turn = await startChatTurn(db, {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        requestId: requestIdOf(res),
        parsed: parsed.value,
    });
    if (!turn.ok) {
        if ("internal" in turn) return void sendInternalError(res, turn.error);
        return void res.status(turn.status).json({
            ...(turn.code ? { code: turn.code } : {}),
            detail: turn.detail,
        });
    }
    // The browser is one reader of the turn's run: it gets every frame from
    // the first, then the live ones. The loop does not know it is there.
    try {
        attachAssistantTurnSse(res, turn.started.run);
    } catch (error) {
        await abandonChatTurn(db, turn.started);
        throw error;
    }
    await runChatTurn(db, turn.started);
}));

chatRouter.use(routerErrorHandler("[chat]"));
