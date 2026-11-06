// GET /training-notes/chats/:chatId — a pasante's private notes on a chat
// (docs/training.md). Thin handler: parse, call the facade, map the result.

import { Router } from "express";
import { sendServiceFailure } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import { getChatTurnNotes } from "./trainingNotes.service";

export const trainingNotesRouter = Router();

trainingNotesRouter.get("/chats/:chatId", requireAuth, asyncRoute(async (req, res) => {
    const result = await getChatTurnNotes(createServerSupabase(), {
        actorId: res.locals.userId as string,
        chatId: String(req.params.chatId),
        messageId: typeof req.query.message_id === "string" ? req.query.message_id : null,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

trainingNotesRouter.use(routerErrorHandler("[training-notes]"));
