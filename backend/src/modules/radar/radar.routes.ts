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
//     GET  /rules/suggestions        the AI's rule suggestions and their decisions (any member)
//     GET  /rules/suggestions/route  where a version's text would go (null: no button)
//     POST /rules/suggestions/versions/:versionId/suggest   the space's AI suggests catalog rules from one version
//     POST /rules/suggestions/plan   which documents a full read covers, grouped into calls (S8c)
//     POST /rules/suggestions/read   ONE call of that plan: the space's AI reads those documents (S8c)
//     POST /rules/suggestions/questions/:questionId/answer   the lawyer answers a yes/no question (never sent to the AI)
//     POST /rules/suggestions/batch  accept or discard several (each one its own decision)
//     POST /rules/suggestions/:suggestionId/{accept,discard}   the lawyer decides (owner or editor)
//
//   /orgs/:orgId/radar   (radarTodayRouter)
//     GET /today                     open items of the matters where the caller is an active member
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
  acceptRuleSuggestion,
  answerRuleQuestion,
  actOnRadarItem,
  decideRuleSuggestions,
  discardProposal,
  discardRuleSuggestion,
  exportRuleProposals,
  getMatterRadar,
  getMatterRules,
  getProposalRoute,
  getRadarToday,
  getRuleProposals,
  getRuleSuggestions,
  getSuggestionRoute,
  planRuleRead,
  readRuleBatch,
  markProposalImplemented,
  proposeRules,
  sendProposalToLegal,
  setMatterRule,
  suggestRules,
} from "./radar.service";

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

// One run is one model call on the person's key, with a whole document in it:
// a lane per person (not per address), after authentication.
const suggestLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_RULE_SUGGEST_WINDOW_MINUTES", 15) * 60 * 1000,
  max: envInt("RATE_LIMIT_RULE_SUGGEST_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (_req, res) => String(res.locals.userId),
  message: rateLimitedBody("Too many suggestion requests. Please try again later."),
});

// One all-documents read (S8c) is a PLAN of several calls, one request each, and
// one run may need more than ten. It has its own lane (and its own, larger
// maximum) so it neither starves nor is starved by single-version runs.
const readLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_RULE_SUGGEST_WINDOW_MINUTES", 15) * 60 * 1000,
  max: envInt("RATE_LIMIT_RULE_READ_MAX", 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (_req, res) => String(res.locals.userId),
  message: rateLimitedBody("Too many suggestion requests. Please try again later."),
});

// Declared before `/rules/:ruleKey/...`: "suggestions" is never a rule key.
matterRadarRouter.get("/rules/suggestions", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getRuleSuggestions(createServerSupabase(), matterActor(req, res)));
}));

matterRadarRouter.get("/rules/suggestions/route", requireAuth, asyncRoute(async (req, res) => {
  const result = await getSuggestionRoute(createServerSupabase(), matterActor(req, res));
  send(res, result.ok ? { ok: true, data: { route: result.data } } : result);
}));

matterRadarRouter.post("/rules/suggestions/versions/:versionId/suggest", requireAuth, requireMfaIfEnrolled, suggestLimiter, asyncRoute(async (req, res) => {
  send(res, await suggestRules(createServerSupabase(), { ...matterActor(req, res), versionId: req.params.versionId }));
}));

matterRadarRouter.post("/rules/suggestions/plan", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await planRuleRead(createServerSupabase(), { ...matterActor(req, res), body: req.body }));
}));

matterRadarRouter.post("/rules/suggestions/read", requireAuth, requireMfaIfEnrolled, readLimiter, asyncRoute(async (req, res) => {
  send(res, await readRuleBatch(createServerSupabase(), { ...matterActor(req, res), body: req.body }));
}));

matterRadarRouter.post("/rules/suggestions/questions/:questionId/answer", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await answerRuleQuestion(createServerSupabase(), { ...matterActor(req, res), questionId: req.params.questionId, body: req.body }));
}));

matterRadarRouter.post("/rules/suggestions/batch", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await decideRuleSuggestions(createServerSupabase(), { ...matterActor(req, res), body: req.body }));
}));

for (const [path, decide] of [["accept", acceptRuleSuggestion], ["discard", discardRuleSuggestion]] as const) {
  matterRadarRouter.post(`/rules/suggestions/:suggestionId/${path}`, requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
    send(res, await decide(createServerSupabase(), { ...matterActor(req, res), suggestionId: req.params.suggestionId, body: req.body }));
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

// ---------------------------------------------------------------------------
// Rule proposals (S8b): drafts of NEW rules from a law text that lives in a
// firm project (never a matter). Reading and the file for legal are for any
// member of the project; proposing and deciding for its owner or editor.
// ---------------------------------------------------------------------------
//   GET  /                         the drafts and their decisions
//   GET  /route                    where a version's text would go (null: no button)
//   GET  /export                   the Markdown file for legal (sent_to_legal, not discarded)
//   POST /versions/:versionId/propose
//   POST /:proposalId/{send-to-legal,discard,implemented}
const proposalLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_RULE_SUGGEST_WINDOW_MINUTES", 15) * 60 * 1000,
  max: envInt("RATE_LIMIT_RULE_SUGGEST_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (_req, res) => String(res.locals.userId),
  message: rateLimitedBody("Too many proposal requests. Please try again later."),
});

const projectActor = (req: Request, res: Response) => ({
  userId: res.locals.userId as string,
  userEmail: (res.locals.userEmail as string | undefined) ?? null,
  projectId: req.params.projectId as unknown,
});

export const ruleProposalsRouter = Router({ mergeParams: true });

ruleProposalsRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  send(res, await getRuleProposals(createServerSupabase(), projectActor(req, res)));
}));

ruleProposalsRouter.get("/route", requireAuth, asyncRoute(async (req, res) => {
  const result = await getProposalRoute(createServerSupabase(), projectActor(req, res));
  send(res, result.ok ? { ok: true, data: { route: result.data } } : result);
}));

ruleProposalsRouter.get("/export", requireAuth, asyncRoute(async (req, res) => {
  const result = await exportRuleProposals(createServerSupabase(), projectActor(req, res));
  if (!result.ok) return void sendServiceFailure(res, result);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.data.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(result.data.content);
}));

ruleProposalsRouter.post("/versions/:versionId/propose", requireAuth, requireMfaIfEnrolled, proposalLimiter, asyncRoute(async (req, res) => {
  send(res, await proposeRules(createServerSupabase(), { ...projectActor(req, res), versionId: req.params.versionId }));
}));

for (const [path, decide] of [["send-to-legal", sendProposalToLegal], ["discard", discardProposal], ["implemented", markProposalImplemented]] as const) {
  ruleProposalsRouter.post(`/:proposalId/${path}`, requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
    send(res, await decide(createServerSupabase(), { ...projectActor(req, res), proposalId: req.params.proposalId, body: req.body }));
  }));
}

ruleProposalsRouter.use(routerErrorHandler("[rule-proposals]"));
