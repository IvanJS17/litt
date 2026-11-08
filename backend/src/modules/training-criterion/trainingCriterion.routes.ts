// Express routers for LiTT training layer 3 «Criterio» (docs/training.md).
//
//   /orgs/:orgId/training/pupils/:userId/notes
//       PUT /:noteId/verdict     the pupil's current mentor corrects a verdict
//   /training/me
//       GET  /criterion?org_id=      my map, calibration, hints and retakes
//       POST /retakes                ask for the retake of a weak topic
//       PUT  /retakes/:id/answer     answer it; judged once
//   /orgs/:orgId/training/pupils/:userId/criterion
//       GET                          the same, for the pupil's current mentor
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import type { TrainingRetakeAnswerBody, TrainingRetakeStartBody } from "@mike/contracts";
import { Router, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    answerRetake,
    getMyCriterion,
    getPupilCriterion,
    overrideNoteVerdict,
    startRetake,
} from "./trainingCriterion.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(status).json(result.data);
}

const person = (res: Response) => ({
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
});

/** Mounted at /orgs/:orgId/training/pupils/:userId/notes. */
export const pupilNotesRouter = Router({ mergeParams: true });

pupilNotesRouter.put("/:noteId/verdict", requireAuth, asyncRoute(async (req, res) => {
    const result = await overrideNoteVerdict(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: req.params.orgId,
        traineeId: req.params.userId,
        noteId: req.params.noteId,
        body: req.body,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

pupilNotesRouter.use(routerErrorHandler("[training-criterion]"));

/** Mounted at /training. */
export const trainingCriterionRouter = Router();

trainingCriterionRouter.get("/me/criterion", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMyCriterion(createServerSupabase(), { userId: res.locals.userId as string, orgId: req.query.org_id }));
}));

trainingCriterionRouter.post("/me/retakes", requireAuth, asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Partial<TrainingRetakeStartBody>;
    send(res, await startRetake(createServerSupabase(), { ...person(res), orgId: body.org_id, body }), 201);
}));

trainingCriterionRouter.put("/me/retakes/:retakeId/answer", requireAuth, asyncRoute(async (req, res) => {
    send(res, await answerRetake(createServerSupabase(), {
        ...person(res),
        retakeId: req.params.retakeId,
        body: (req.body ?? {}) as Partial<TrainingRetakeAnswerBody>,
    }));
}));

trainingCriterionRouter.use(routerErrorHandler("[training-criterion]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/criterion. */
export const pupilCriterionRouter = Router({ mergeParams: true });

pupilCriterionRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getPupilCriterion(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: String(req.params.orgId),
        traineeId: String(req.params.userId),
    }));
}));

pupilCriterionRouter.use(routerErrorHandler("[training-criterion]"));
