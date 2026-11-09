// Express routers for LiTT training layer 4, the gym (docs/training.md).
//
//   /orgs/:orgId/training/gym/cases                 a mentor's own cases
//       GET | POST
//       POST /draft                                 an AI draft; saves nothing
//       PUT | DELETE /:caseId                       the author only
//   /orgs/:orgId/training/pupils/:userId/gym/attempts   the pupil's current mentor
//       GET | POST {case_id}                        list; assign or give another attempt
//   /training/me/gym/attempts                       the pupil's own
//       GET ?org_id= | GET /:id
//       POST /:id/start | PUT /:id/findings | POST /:id/hint | POST /:id/submit
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    assignAttempt,
    createCase,
    deleteCase,
    draftCase,
    getOwnAttempt,
    listCases,
    listOwnAttempts,
    listPupilAttempts,
    revealHint,
    saveFindings,
    startAttempt,
    submitAttempt,
    updateCase,
} from "./trainingGym.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    if (result.data === null) return void res.status(204).send();
    res.status(status).json(result.data);
}

const user = (res: Response) => ({
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
});
const actor = (res: Response) => ({
    actorId: res.locals.userId as string,
    actorEmail: (res.locals.userEmail as string | undefined) ?? null,
});
const mentorOf = (req: Request, res: Response) => ({
    ...actor(res),
    orgId: String(req.params.orgId),
    traineeId: String(req.params.userId),
});

/** Mounted at /orgs/:orgId/training/gym/cases. */
export const gymCasesRouter = Router({ mergeParams: true });

gymCasesRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listCases(createServerSupabase(), { ...actor(res), orgId: req.params.orgId }));
}));
gymCasesRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await createCase(createServerSupabase(), { ...actor(res), orgId: req.params.orgId, body: req.body }), 201);
}));
gymCasesRouter.post("/draft", requireAuth, asyncRoute(async (req, res) => {
    send(res, await draftCase(createServerSupabase(), { ...actor(res), orgId: req.params.orgId, body: req.body }));
}));
gymCasesRouter.put("/:caseId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await updateCase(createServerSupabase(), {
        ...actor(res),
        orgId: req.params.orgId,
        caseId: req.params.caseId,
        body: req.body,
    }));
}));
gymCasesRouter.delete("/:caseId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await deleteCase(createServerSupabase(), { ...actor(res), orgId: req.params.orgId, caseId: req.params.caseId }));
}));
gymCasesRouter.use(routerErrorHandler("[training-gym]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/gym/attempts. */
export const pupilGymRouter = Router({ mergeParams: true });

pupilGymRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listPupilAttempts(createServerSupabase(), mentorOf(req, res)));
}));
pupilGymRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await assignAttempt(createServerSupabase(), { ...mentorOf(req, res), body: req.body }), 201);
}));
pupilGymRouter.use(routerErrorHandler("[training-gym]"));

/** Mounted at /training/me/gym/attempts. */
export const myGymRouter = Router();

const mine = (req: Request, res: Response) => ({ ...user(res), attemptId: req.params.attemptId });

myGymRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
    send(res, await listOwnAttempts(createServerSupabase(), { userId: res.locals.userId as string, orgId: req.query.org_id }));
}));
myGymRouter.get("/:attemptId", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getOwnAttempt(createServerSupabase(), mine(req, res)));
}));
myGymRouter.post("/:attemptId/start", requireAuth, asyncRoute(async (req, res) => {
    send(res, await startAttempt(createServerSupabase(), mine(req, res)));
}));
myGymRouter.put("/:attemptId/findings", requireAuth, asyncRoute(async (req, res) => {
    send(res, await saveFindings(createServerSupabase(), { ...mine(req, res), body: req.body }));
}));
myGymRouter.post("/:attemptId/hint", requireAuth, asyncRoute(async (req, res) => {
    send(res, await revealHint(createServerSupabase(), mine(req, res)));
}));
myGymRouter.post("/:attemptId/submit", requireAuth, asyncRoute(async (req, res) => {
    send(res, await submitAttempt(createServerSupabase(), mine(req, res)));
}));
myGymRouter.use(routerErrorHandler("[training-gym]"));
