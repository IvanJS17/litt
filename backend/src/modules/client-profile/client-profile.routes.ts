// HTTP layer of the client-profile module (docs/client-profile.md).
//
//   /projects/:projectId/matters/:matterId/profile   (clientProfileRouter)
//     GET    /                        the facts, their state and the versions a fact can cite
//     POST   /facts                   capture a fact (a citation is required)
//     POST   /facts/:factId/confirm   the lawyer confirms it
//     POST   /facts/:factId/reject    the lawyer rejects it
//
// Thin handlers: parse, call the facade, map the ServiceResult. Nothing here
// touches the database.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import {
  confirmProfileFact,
  createProfileFact,
  getClientProfile,
  rejectProfileFact,
} from "./client-profile.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
  if (!result.ok) return void sendServiceFailure(res, result);
  res.status(status).json(result.data);
}

const matterActor = (req: Request, res: Response) => ({
  userId: res.locals.userId as string,
  userEmail: (res.locals.userEmail as string | undefined) ?? null,
  projectId: req.params.projectId as unknown,
  matterId: req.params.matterId as unknown,
});

export const clientProfileRouter = Router({ mergeParams: true });

clientProfileRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getClientProfile(createServerSupabase(), matterActor(req, res)));
}));

clientProfileRouter.post("/facts", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await createProfileFact(createServerSupabase(), { ...matterActor(req, res), body: req.body }), 201);
}));

clientProfileRouter.post("/facts/:factId/confirm", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await confirmProfileFact(createServerSupabase(), {
    ...matterActor(req, res),
    factId: req.params.factId,
    body: req.body,
  }));
}));

clientProfileRouter.post("/facts/:factId/reject", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await rejectProfileFact(createServerSupabase(), {
    ...matterActor(req, res),
    factId: req.params.factId,
    body: req.body,
  }));
}));

clientProfileRouter.use(routerErrorHandler("[client-profile]"));
