// HTTP layer of the requests module (docs/matter-requests.md).
//
//   /projects/:projectId/matters/:matterId/requests   (requestsRouter)
//     GET    /                                  the matter's requests, the catalog and who can be assigned
//     POST   /                                  create a request
//     GET    /:requestId                        one request with its rounds and events
//     PATCH  /:requestId                        change it (with the `version` read)
//     POST   /:requestId/rounds                 link a document version as a negotiation round
//     DELETE /:requestId/rounds/:roundId        unlink a round (the document stays)
//
//     GET    /:requestId/triage                 Donna's card: what the last run proposed and what was decided
//     POST   /:requestId/triage                 a new run at the lawyer's click (counts against the month's cap)
//     POST   /:requestId/triage/items/:itemId/decision   accept, edit or discard one proposal
//
//   /orgs/:orgId/request-types   (requestTypesRouter)
//     GET /, POST /, PATCH /:typeId
//     GET /playbooks                           every open link of the firm and the playbooks that can be linked
//     GET /:typeId/playbooks                   the links of one type
//     POST /:typeId/playbooks                  link a ready playbook ({ playbook_id }), owner or admin
//     DELETE /:typeId/playbooks/:playbookId    unlink it (the row is marked, the history stays)
//
//   /orgs/:orgId/donna   (donnaUsageRouter)
//     GET /usage                               the month's runs, tokens and cost of Donna's triage, owner or admin
//
//   /orgs/:orgId/requests   (requestCountsRouter)
//     GET /counts?period=month|quarter&date=YYYY-MM-DD   counts only, owner or admin
//
// Thin handlers: parse, call the facade, map the ServiceResult. Nothing here
// touches the database.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import {
  createMatterRequest,
  createRequestType,
  decideTriageItem,
  getDonnaUsage,
  getFirmRequestCounts,
  getMatterRequest,
  getTriageCard,
  linkRound,
  linkTypePlaybook,
  listMatterRequests,
  listRequestTypes,
  listTypePlaybooks,
  runTriageNow,
  unlinkRound,
  unlinkTypePlaybook,
  updateMatterRequest,
  updateRequestType,
} from "./requests.service";
import { DONNA_CAP_CODE, DONNA_DAILY_CAP_CODE } from "./requests.triage.shared";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
  // The firm used up its month of Donna runs, or the person their day: a quota, not a conflict of state.
  if (!result.ok && result.kind === "conflict" && (result.code === DONNA_CAP_CODE || result.code === DONNA_DAILY_CAP_CODE))
    return void res.status(429).json({ code: result.code, detail: result.detail });
  if (!result.ok) return void sendServiceFailure(res, result);
  res.status(status).json(result.data);
}

const matterActor = (req: Request, res: Response) => ({
  userId: res.locals.userId as string,
  userEmail: (res.locals.userEmail as string | undefined) ?? null,
  projectId: req.params.projectId as unknown,
  matterId: req.params.matterId as unknown,
});

export const requestsRouter = Router({ mergeParams: true });

requestsRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await listMatterRequests(createServerSupabase(), matterActor(req, res)));
}));

requestsRouter.post("/", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await createMatterRequest(createServerSupabase(), { ...matterActor(req, res), body: req.body }), 201);
}));

requestsRouter.get("/:requestId", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getMatterRequest(createServerSupabase(), {
    ...matterActor(req, res),
    requestId: req.params.requestId,
  }));
}));

requestsRouter.patch("/:requestId", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await updateMatterRequest(createServerSupabase(), {
    ...matterActor(req, res),
    requestId: req.params.requestId,
    body: req.body,
  }));
}));

requestsRouter.post("/:requestId/rounds", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await linkRound(createServerSupabase(), {
    ...matterActor(req, res),
    requestId: req.params.requestId,
    body: req.body,
  }), 201);
}));

requestsRouter.delete("/:requestId/rounds/:roundId", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await unlinkRound(createServerSupabase(), {
    ...matterActor(req, res),
    requestId: req.params.requestId,
    roundId: req.params.roundId,
  }));
}));

requestsRouter.get("/:requestId/triage", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getTriageCard(createServerSupabase(), { ...matterActor(req, res), requestId: req.params.requestId }));
}));

requestsRouter.post("/:requestId/triage", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await runTriageNow(createServerSupabase(), { ...matterActor(req, res), requestId: req.params.requestId }));
}));

requestsRouter.post("/:requestId/triage/items/:itemId/decision", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await decideTriageItem(createServerSupabase(), {
    ...matterActor(req, res),
    requestId: req.params.requestId,
    itemId: req.params.itemId,
    body: req.body,
  }));
}));

requestsRouter.use(routerErrorHandler("[requests]"));

const orgActor = (req: Request, res: Response) => ({
  userId: res.locals.userId as string,
  userEmail: (res.locals.userEmail as string | undefined) ?? null,
  orgId: req.params.orgId as unknown,
});

export const requestTypesRouter = Router({ mergeParams: true });

requestTypesRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await listRequestTypes(createServerSupabase(), orgActor(req, res)));
}));

requestTypesRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await createRequestType(createServerSupabase(), { ...orgActor(req, res), body: req.body }), 201);
}));

requestTypesRouter.patch("/:typeId", requireAuth, asyncRoute(async (req, res) => {
  send(res, await updateRequestType(createServerSupabase(), {
    ...orgActor(req, res),
    typeId: req.params.typeId,
    body: req.body,
  }));
}));

requestTypesRouter.get("/playbooks", requireAuth, asyncRoute(async (req, res) => {
  send(res, await listTypePlaybooks(createServerSupabase(), orgActor(req, res)));
}));

requestTypesRouter.get("/:typeId/playbooks", requireAuth, asyncRoute(async (req, res) => {
  send(res, await listTypePlaybooks(createServerSupabase(), { ...orgActor(req, res), typeId: req.params.typeId }));
}));

requestTypesRouter.post("/:typeId/playbooks", requireAuth, asyncRoute(async (req, res) => {
  send(res, await linkTypePlaybook(createServerSupabase(), {
    ...orgActor(req, res),
    typeId: req.params.typeId,
    body: req.body,
  }), 201);
}));

requestTypesRouter.delete("/:typeId/playbooks/:playbookId", requireAuth, asyncRoute(async (req, res) => {
  send(res, await unlinkTypePlaybook(createServerSupabase(), {
    ...orgActor(req, res),
    typeId: req.params.typeId,
    playbookId: req.params.playbookId,
  }));
}));

requestTypesRouter.use(routerErrorHandler("[request-types]"));

export const requestCountsRouter = Router({ mergeParams: true });

requestCountsRouter.get("/counts", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getFirmRequestCounts(createServerSupabase(), {
    ...orgActor(req, res),
    period: req.query.period,
    date: req.query.date,
  }));
}));

requestCountsRouter.use(routerErrorHandler("[request-counts]"));

export const donnaUsageRouter = Router({ mergeParams: true });

donnaUsageRouter.get("/usage", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getDonnaUsage(createServerSupabase(), orgActor(req, res)));
}));

donnaUsageRouter.use(routerErrorHandler("[donna-usage]"));
