// Express router for the firm's criteria (LiTT training layer 3,
// docs/training.md, "One mold of criterion"), mounted at
// /orgs/:orgId/firm-criteria.
//
//   GET     /          the organization's criteria and what the caller may do
//   POST    /          write one (a member with no training stage)
//   PUT     /:id       change one of mine
//   DELETE  /:id       remove one (its author, or an owner or admin)
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    createFirmCriterion,
    deleteFirmCriterion,
    listFirmCriteria,
    updateFirmCriterion,
} from "./firmCriteria.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(status).json(result.data);
}

const actor = (req: Request, res: Response) => ({
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
    orgId: req.params.orgId as unknown,
});

export const firmCriteriaRouter = Router({ mergeParams: true });

firmCriteriaRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listFirmCriteria(createServerSupabase(), actor(req, res)));
}));

firmCriteriaRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await createFirmCriterion(createServerSupabase(), { ...actor(req, res), body: req.body }), 201);
}));

firmCriteriaRouter.put("/:criterionId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await updateFirmCriterion(createServerSupabase(), {
        ...actor(req, res),
        criterionId: req.params.criterionId,
        body: req.body,
    }));
}));

firmCriteriaRouter.delete("/:criterionId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await deleteFirmCriterion(createServerSupabase(), {
        ...actor(req, res),
        criterionId: req.params.criterionId,
    }));
}));

firmCriteriaRouter.use(routerErrorHandler("[firm-criteria]"));
