// HTTP layer for the project-chat module.
//
// The route handler parses the request body and attaches the turn's run to
// the response; the turn itself (authorisation, preparation, the generation
// loop and its persistence) is projectChat.turn.ts, so the same turn can run
// behind any transport.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { setOperation } from "../../lib/observability/report";
import { attachAssistantTurnSse } from "../../lib/assistantTurnRuns";
import { requestIdOf } from "../chat/chat.service";
import { sendInternalError } from "../../lib/httpError";
import {
    abandonProjectChatTurn,
    parseProjectChatRequest,
    runProjectChatTurn,
    startProjectChatTurn,
} from "./projectChat.turn";

export const projectChatRouter = Router({ mergeParams: true });

// POST /projects/:projectId/chat — streaming
projectChatRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    setOperation("project_chat.turn");
    const parsed = parseProjectChatRequest(req.body);
    if (!parsed.ok) {
        return void res.status(parsed.status).json({ detail: parsed.detail });
    }
    const db = createServerSupabase();
    const turn = await startProjectChatTurn(db, {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
        requestId: requestIdOf(res),
        projectId: req.params.projectId,
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
        await abandonProjectChatTurn(db, turn.started);
        throw error;
    }
    await runProjectChatTurn(db, turn.started);
}));

projectChatRouter.use(routerErrorHandler("[project-chat]"));
