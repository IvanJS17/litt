// Express routers for LiTT training (docs/training.md).
//
//   /training                         the caller's own training
//   /orgs/:orgId/training             mentors, pupils and stages in one org
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import type {
    TrainingAssignPupilBody,
    TrainingDesignateMentorBody,
    TrainingSetStageBody,
} from "@mike/contracts";
import { Router, type Response } from "express";
import type { ServiceResult } from "../../lib/serviceResult";
import { sendServiceFailure } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    assignPupil,
    designateMentor,
    getEffectiveTrainingStage,
    getMyPupils,
    getMyTraining,
    getOrgTraining,
    releasePupil,
    removeMentor,
    removeStage,
    setStage,
} from "./training.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    if (result.data === null) return void res.status(204).send();
    res.status(status).json(result.data);
}

function actorOf(req: { params: Record<string, string> }, res: Response) {
    return {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: String(req.params.orgId),
    };
}

export const trainingRouter = Router();

// GET /training/me — my mentor and stages, and whether I mentor, per organization.
trainingRouter.get("/me", requireAuth, asyncRoute(async (_req, res) => {
    send(res, await getMyTraining(createServerSupabase(), { userId: res.locals.userId as string }));
}));

// GET /training/stage?org_id=&project_id= | ?surface=word — my effective stage there.
trainingRouter.get("/stage", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getEffectiveTrainingStage(createServerSupabase(), {
        userId: res.locals.userId as string,
        userEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: req.query.org_id,
        projectId: req.query.project_id,
        surface: req.query.surface,
        chatId: req.query.chat_id,
    }));
}));

trainingRouter.use(routerErrorHandler("[training]"));

export const orgTrainingRouter = Router({ mergeParams: true });

orgTrainingRouter.get("/mentors", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getOrgTraining(createServerSupabase(), actorOf(req, res)));
}));

orgTrainingRouter.post("/mentors", requireAuth, asyncRoute(async (req, res) => {
    send(res, await designateMentor(createServerSupabase(), {
        ...actorOf(req, res),
        userId: (req.body as Partial<TrainingDesignateMentorBody> | undefined)?.user_id,
    }), 201);
}));

orgTrainingRouter.delete("/mentors/:userId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await removeMentor(createServerSupabase(), {
        ...actorOf(req, res),
        userId: req.params.userId,
    }));
}));

orgTrainingRouter.get("/pupils", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMyPupils(createServerSupabase(), actorOf(req, res)));
}));

orgTrainingRouter.post("/pupils", requireAuth, asyncRoute(async (req, res) => {
    send(res, await assignPupil(createServerSupabase(), {
        ...actorOf(req, res),
        userId: (req.body as Partial<TrainingAssignPupilBody> | undefined)?.user_id,
        mentorUserId: (req.body as Partial<TrainingAssignPupilBody> | undefined)?.mentor_user_id,
    }), 201);
}));

orgTrainingRouter.delete("/pupils/:userId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await releasePupil(createServerSupabase(), {
        ...actorOf(req, res),
        userId: req.params.userId,
    }));
}));

orgTrainingRouter.put("/pupils/:userId/stages", requireAuth, asyncRoute(async (req, res) => {
    send(res, await setStage(createServerSupabase(), {
        ...actorOf(req, res),
        userId: req.params.userId,
        practice: (req.body as Partial<TrainingSetStageBody> | undefined)?.practice,
        stage: (req.body as Partial<TrainingSetStageBody> | undefined)?.stage,
    }));
}));

// DELETE …/stages?practice=<name>; without `practice`, the stage that covers every practice area.
orgTrainingRouter.delete("/pupils/:userId/stages", requireAuth, asyncRoute(async (req, res) => {
    send(res, await removeStage(createServerSupabase(), {
        ...actorOf(req, res),
        userId: req.params.userId,
        practice: req.query.practice,
    }));
}));

orgTrainingRouter.use(routerErrorHandler("[training]"));
