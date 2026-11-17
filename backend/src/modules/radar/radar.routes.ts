// HTTP layer of the radar module (docs/deadline-radar.md).
//
//   /projects/:projectId/matters/:matterId/radar   (matterRadarRouter)
//     GET  /                         the matter's items, computed now
//     POST /items/:itemKey/ack       seen (owner or editor)
//     POST /items/:itemKey/dismiss   not a deadline to track; body { reason } required
//     POST /items/:itemKey/done      handled
//
//   /orgs/:orgId/radar   (radarTodayRouter)
//     GET /today                     open items of the matters where the caller is an active member
//
// Thin handlers: parse, call the facade, map the ServiceResult. Nothing here
// touches the database.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { actOnRadarItem, getMatterRadar, getRadarToday } from "./radar.service";

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

export const matterRadarRouter = Router({ mergeParams: true });

matterRadarRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getMatterRadar(createServerSupabase(), matterActor(req, res)));
}));

for (const action of ["ack", "dismiss", "done"] as const) {
  matterRadarRouter.post(`/items/:itemKey/${action}`, requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
    send(res, await actOnRadarItem(createServerSupabase(), {
      ...matterActor(req, res),
      itemKey: req.params.itemKey,
      body: req.body,
    }, action));
  }));
}

matterRadarRouter.use(routerErrorHandler("[radar]"));

export const radarTodayRouter = Router({ mergeParams: true });

radarTodayRouter.get("/today", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getRadarToday(createServerSupabase(), {
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
    orgId: req.params.orgId as unknown,
  }));
}));

radarTodayRouter.use(routerErrorHandler("[radar-today]"));
