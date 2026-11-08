// Express routers for LiTT training layer 3 «Modo de rendir cuentas» (docs/training.md).
//
//   GET /training/me/chats/:chatId/backing[?message_id=]
//   PUT /training/me/chats/:chatId/backing/:checkId/conclusions/:conclusionId
//       the person's own checks, and «lo verifiqué» / why they keep a conclusion
//   GET /orgs/:orgId/training/pupils/:userId/backing
//       the pupil's current mentor's summary
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import { getMyChatBacking, getPupilBacking, markMyConclusion } from "./trainingBacking.service";

function send<T>(res: Response, result: ServiceResult<T>) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}

/** Mounted at /training/me/chats. */
export const myBackingRouter = Router();

myBackingRouter.get("/:chatId/backing", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMyChatBacking(createServerSupabase(), {
        userId: res.locals.userId as string,
        chatId: String(req.params.chatId),
        messageId: typeof req.query.message_id === "string" ? req.query.message_id : null,
    }));
}));

myBackingRouter.put("/:chatId/backing/:checkId/conclusions/:conclusionId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await markMyConclusion(createServerSupabase(), {
        userId: res.locals.userId as string,
        userEmail: (res.locals.userEmail as string | undefined) ?? null,
        chatId: String(req.params.chatId),
        checkId: String(req.params.checkId),
        conclusionId: String(req.params.conclusionId),
        body: req.body,
    }));
}));

myBackingRouter.use(routerErrorHandler("[training-backing]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/backing. */
export const pupilBackingRouter = Router({ mergeParams: true });

pupilBackingRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getPupilBacking(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: req.params.orgId,
        traineeId: req.params.userId,
    }));
}));

pupilBackingRouter.use(routerErrorHandler("[training-backing]"));
