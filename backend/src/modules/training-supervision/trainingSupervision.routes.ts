// Express router for LiTT training layer 2 «Supervisión» (docs/training.md).
//
//   /training/me/supervision?org_id=   what my mentor sees of me there
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router } from "express";
import { sendServiceFailure } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import { getMySupervision } from "./trainingSupervision.service";

export const trainingSupervisionRouter = Router();

trainingSupervisionRouter.get("/me/supervision", requireAuth, asyncRoute(async (req, res) => {
    const result = await getMySupervision(createServerSupabase(), {
        userId: res.locals.userId as string,
        orgId: req.query.org_id,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

trainingSupervisionRouter.use(routerErrorHandler("[training-supervision]"));
