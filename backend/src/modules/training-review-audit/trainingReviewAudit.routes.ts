// Express routers for LiTT training layer 3, bulk review designer
// (docs/training.md).
//
//   /tabular-review/:reviewId/training-audit            the junior's own
//       GET                                  the design review, and the audit if any
//       POST                                 start the audit (the server draws the sample)
//       PUT    /cells/:key                   mark one sampled cell (`<row id>:<column index>`)
//       POST   /complete                     finish it once every cell is marked
//   /orgs/:orgId/training/pupils/:userId/review-audits  the pupil's current mentor's only
//       GET                                  the person's audits
//       PUT    /:auditId/evaluation          «adequate» or «needs work», a note
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    completeReviewAudit,
    evaluateReviewAudit,
    getReviewAudit,
    listPupilReviewAudits,
    markReviewAuditCell,
    startReviewAudit,
} from "./trainingReviewAudit.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(status).json(result.data);
}

const juniorOf = (req: Request, res: Response) => ({
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
    reviewId: req.params.reviewId,
});

/** Mounted at /tabular-review/:reviewId/training-audit. */
export const reviewAuditRouter = Router({ mergeParams: true });

reviewAuditRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getReviewAudit(createServerSupabase(), juniorOf(req, res)));
}));

reviewAuditRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    const result = await startReviewAudit(createServerSupabase(), juniorOf(req, res));
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(result.data.created ? 201 : 200).json(result.data.audit);
}));

reviewAuditRouter.put("/cells/:key", requireAuth, asyncRoute(async (req, res) => {
    send(res, await markReviewAuditCell(createServerSupabase(), {
        ...juniorOf(req, res),
        cellKey: req.params.key,
        body: req.body,
    }));
}));

reviewAuditRouter.post("/complete", requireAuth, asyncRoute(async (req, res) => {
    send(res, await completeReviewAudit(createServerSupabase(), juniorOf(req, res)));
}));

reviewAuditRouter.use(routerErrorHandler("[training-review-audit]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/review-audits. */
export const pupilReviewAuditsRouter = Router({ mergeParams: true });

const mentorOf = (req: Request, res: Response) => ({
    actorId: res.locals.userId as string,
    actorEmail: (res.locals.userEmail as string | undefined) ?? null,
    orgId: String(req.params.orgId),
    traineeId: String(req.params.userId),
});

pupilReviewAuditsRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listPupilReviewAudits(createServerSupabase(), mentorOf(req, res)));
}));

pupilReviewAuditsRouter.put("/:auditId/evaluation", requireAuth, asyncRoute(async (req, res) => {
    send(res, await evaluateReviewAudit(createServerSupabase(), {
        ...mentorOf(req, res),
        auditId: req.params.auditId,
        body: req.body,
    }));
}));

pupilReviewAuditsRouter.use(routerErrorHandler("[training-review-audit]"));
