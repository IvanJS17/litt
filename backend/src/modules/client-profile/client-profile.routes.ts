// HTTP layer of the client-profile module (docs/client-profile.md).
//
//   /projects/:projectId/matters/:matterId/profile   (clientProfileRouter)
//     GET    /                        the facts, their state and the versions a fact can cite
//     POST   /facts                   capture a fact (a citation is required)
//     POST   /facts/:factId/confirm   the lawyer confirms it
//     POST   /facts/:factId/reject    the lawyer rejects it
//     POST   /facts/batch             confirm or reject several (each one its own decision)
//     GET    /extraction              where a version's text would go (null: no button)
//     POST   /versions/:versionId/extract   the space's AI proposes facts from one version
//
// Thin handlers: parse, call the facade, map the ServiceResult. Nothing here
// touches the database.

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { rateLimitedBody } from "../../lib/httpError";
import { envInt } from "../../lib/runtimeConfig";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import {
  confirmProfileFact,
  createProfileFact,
  decideProfileFacts,
  extractProfileFacts,
  getClientProfile,
  getExtractionRoute,
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

// One run is one model call on the person's key, with a whole document in it:
// a lane per person (not per address), after authentication.
const extractLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_PROFILE_EXTRACT_WINDOW_MINUTES", 15) * 60 * 1000,
  max: envInt("RATE_LIMIT_PROFILE_EXTRACT_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (_req, res) => String(res.locals.userId),
  message: rateLimitedBody("Too many extraction requests. Please try again later."),
});

clientProfileRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getClientProfile(createServerSupabase(), matterActor(req, res)));
}));

clientProfileRouter.post("/facts", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await createProfileFact(createServerSupabase(), { ...matterActor(req, res), body: req.body }), 201);
}));

clientProfileRouter.post("/facts/batch", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await decideProfileFacts(createServerSupabase(), { ...matterActor(req, res), body: req.body }));
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

clientProfileRouter.get("/extraction", requireAuth, asyncRoute(async (req, res) => {
  const result = await getExtractionRoute(createServerSupabase(), matterActor(req, res));
  send(res, result.ok ? { ok: true, data: { route: result.data } } : result);
}));

clientProfileRouter.post("/versions/:versionId/extract", requireAuth, requireMfaIfEnrolled, extractLimiter, asyncRoute(async (req, res) => {
  send(res, await extractProfileFacts(createServerSupabase(), {
    ...matterActor(req, res),
    versionId: req.params.versionId,
  }));
}));

clientProfileRouter.use(routerErrorHandler("[client-profile]"));
