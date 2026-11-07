// Express routers for LiTT training layer 2 «Supervisión» (docs/training.md).
//
//   /training/me/supervision?org_id=        what my mentor sees of me there
//   /orgs/:orgId/training/pupils/:userId/works
//       GET                                 my pupil's works and reviews
//       POST   /:surface/:chatId/review     generate or regenerate a review
//       PUT    /:surface/:chatId/review/reviewed   mark it reviewed
//
// The /orgs routes are the pupil's current mentor's only. Thin handlers:
// parse, call the facade, map the ServiceResult.

import type { TrainingWorkReviewBody } from "@mike/contracts";
import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    generateWorkReview,
    getMySupervision,
    listPupilWorks,
    markWorkReviewed,
} from "./trainingSupervision.service";

function send<T>(res: Response, result: ServiceResult<T>) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}

export const trainingSupervisionRouter = Router();

trainingSupervisionRouter.get("/me/supervision", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMySupervision(createServerSupabase(), {
        userId: res.locals.userId as string,
        orgId: req.query.org_id,
    }));
}));

trainingSupervisionRouter.use(routerErrorHandler("[training-supervision]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/works. */
export const pupilWorksRouter = Router({ mergeParams: true });

function mentorOf(req: Request, res: Response) {
    return {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: String(req.params.orgId),
        traineeId: String(req.params.userId),
    };
}

pupilWorksRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listPupilWorks(createServerSupabase(), mentorOf(req, res)));
}));

pupilWorksRouter.post("/:surface/:chatId/review", requireAuth, asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as TrainingWorkReviewBody;
    send(res, await generateWorkReview(createServerSupabase(), {
        ...mentorOf(req, res),
        surface: req.params.surface,
        chatId: req.params.chatId,
        credentialRef: body.credential_ref,
    }));
}));

pupilWorksRouter.put("/:surface/:chatId/review/reviewed", requireAuth, asyncRoute(async (req, res) => {
    send(res, await markWorkReviewed(createServerSupabase(), {
        ...mentorOf(req, res),
        surface: req.params.surface,
        chatId: req.params.chatId,
    }));
}));

pupilWorksRouter.use(routerErrorHandler("[training-supervision]"));
