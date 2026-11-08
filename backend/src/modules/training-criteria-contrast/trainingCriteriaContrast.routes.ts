// Express routers for LiTT training layer 3 «Contraste de criterios» (docs/training.md).
//
//   GET /training/me/criteria-contrasts[?chat_id=&org_id=]
//       the person's own contrasts, with the two analyses
//   GET /orgs/:orgId/training/pupils/:userId/criteria-contrasts
//       the pupil's current mentor's view
//
// The contrast itself is made by two chat turns (modes criteria_contrast and
// criteria_explain, lib/trainingTurn/criteria.ts); these routes only read it.
// Thin handlers: parse, call the service, map the ServiceResult.

import { Router, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import { getMyCriteriaContrasts, getPupilCriteriaContrasts } from "./trainingCriteriaContrast.service";

function send<T>(res: Response, result: ServiceResult<T>) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}

/** Mounted at /training/me/criteria-contrasts. */
export const myCriteriaContrastRouter = Router();

myCriteriaContrastRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMyCriteriaContrasts(createServerSupabase(), {
        userId: res.locals.userId as string,
        chatId: req.query.chat_id,
        orgId: req.query.org_id,
    }));
}));

myCriteriaContrastRouter.use(routerErrorHandler("[training-criteria-contrast]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/criteria-contrasts. */
export const pupilCriteriaContrastRouter = Router({ mergeParams: true });

pupilCriteriaContrastRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getPupilCriteriaContrasts(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: req.params.orgId,
        traineeId: req.params.userId,
    }));
}));

pupilCriteriaContrastRouter.use(routerErrorHandler("[training-criteria-contrast]"));
