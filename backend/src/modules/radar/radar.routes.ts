// HTTP layer of the radar module (docs/deadline-radar.md).
//
//   /projects/:projectId/matters/:matterId/radar   (matterRadarRouter)
//     GET  /                         the matter's items, computed now
//     POST /items/:itemKey/ack       seen (owner or editor)
//     POST /items/:itemKey/dismiss   not a deadline to track; body { reason } required
//     POST /items/:itemKey/done      handled
//     GET  /rules                    the obligation rules and which are on (any member)
//     POST /rules/:ruleKey/activate  turn a verified rule on, body { anchor_fact_id, anchor_mode? } (owner or editor)
//     POST /rules/:ruleKey/deactivate turn it off (owner or editor)
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
import { actOnRadarItem, getMatterRadar, getMatterRules, getRadarToday, setMatterRule } from "./radar.service";

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

matterRadarRouter.get("/rules", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getMatterRules(createServerSupabase(), matterActor(req, res)));
}));

for (const [path, on] of [["activate", true], ["deactivate", false]] as const) {
  matterRadarRouter.post(`/rules/:ruleKey/${path}`, requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
    send(res, await setMatterRule(createServerSupabase(), { ...matterActor(req, res), ruleKey: req.params.ruleKey, body: req.body }, on));
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
