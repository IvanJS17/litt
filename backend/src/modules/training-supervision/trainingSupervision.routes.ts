// Express routers for LiTT training layer 2 «Supervisión» (docs/training.md).
//
//   /training/me/supervision?org_id=          what my mentor sees of me there
//   /orgs/:orgId/training/pupils/:userId/passes   urgency passes (current mentor)
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    getMySupervision,
    grantUrgencyPass,
    listUrgencyPasses,
    revokeUrgencyPass,
} from "./trainingSupervision.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    if (result.data === null) return void res.status(204).send();
    res.status(status).json(result.data);
}

function mentorOf(req: { params: Record<string, string> }, res: Response) {
    return {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: String(req.params.orgId),
        traineeId: String(req.params.userId),
    };
}

export const trainingSupervisionRouter = Router();

trainingSupervisionRouter.get("/me/supervision", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMySupervision(createServerSupabase(), {
        userId: res.locals.userId as string,
        orgId: req.query.org_id,
    }));
}));

trainingSupervisionRouter.use(routerErrorHandler("[training-supervision]"));

export const orgTrainingSupervisionRouter = Router({ mergeParams: true });

orgTrainingSupervisionRouter.get("/pupils/:userId/passes", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listUrgencyPasses(createServerSupabase(), mentorOf(req, res)));
}));

orgTrainingSupervisionRouter.post("/pupils/:userId/passes", requireAuth, asyncRoute(async (req, res) => {
    send(res, await grantUrgencyPass(createServerSupabase(), {
        ...mentorOf(req, res),
        body: req.body,
    }), 201);
}));

orgTrainingSupervisionRouter.delete("/pupils/:userId/passes/:passId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await revokeUrgencyPass(createServerSupabase(), {
        ...mentorOf(req, res),
        passId: req.params.passId,
    }));
}));

orgTrainingSupervisionRouter.use(routerErrorHandler("[training-supervision]"));
