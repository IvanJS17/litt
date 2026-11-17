// HTTP layer of the retainer-report module (docs/retainer-report.md).
//
//   /projects/:projectId/matters/:matterId/report   (retainerReportRouter)
//     GET  /sent                    who marked a report as sent and when (any member)
//     GET  /:period                 the report as JSON (owner or editor); period 30d, 60d or 90d
//     GET  /:period/docx            the report as a Word file (owner or editor)
//     POST /:period/sent            the lawyer says they sent it; body { note? } (owner or editor)
//
// Optional `?locale=es-MX|en-US` (default es-MX). The system sends nothing.
// Thin handlers: parse, call the facade, map the ServiceResult. Nothing here
// touches the database.

import { Router, type Request, type Response } from "express";
import { sendServiceFailure, failure, type ServiceResult } from "../../lib/serviceResult";
import { buildContentDisposition } from "../../lib/storage";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import {
  getRetainerReport,
  listReportsSent,
  markReportSent,
  reportDocx,
  reportFilename,
} from "./retainer-report.service";
import { INVALID_REPORT_CODE, parseLocale, parsePeriod } from "./retainer-report.shared";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

/** The period and language of a request, or the failure that answers it. */
function reportParams(req: Request) {
  const days = parsePeriod(req.params.period);
  if (!days) return failure("not_found", "Not found");
  const locale = parseLocale(req.query.locale);
  if (!locale) return failure("validation", "locale must be es-MX or en-US.", INVALID_REPORT_CODE);
  return { ok: true as const, data: { days, locale } };
}

export const retainerReportRouter = Router({ mergeParams: true });

retainerReportRouter.get("/sent", requireAuth, asyncRoute(async (req, res) => {
  send(res, await listReportsSent(createServerSupabase(), matterActor(req, res)));
}));

retainerReportRouter.get("/:period", requireAuth, asyncRoute(async (req, res) => {
  const params = reportParams(req);
  if (!params.ok) return void sendServiceFailure(res, params);
  send(res, await getRetainerReport(createServerSupabase(), { ...matterActor(req, res), ...params.data }));
}));

retainerReportRouter.get("/:period/docx", requireAuth, asyncRoute(async (req, res) => {
  const params = reportParams(req);
  if (!params.ok) return void sendServiceFailure(res, params);
  const report = await getRetainerReport(createServerSupabase(), { ...matterActor(req, res), ...params.data });
  if (!report.ok) return void sendServiceFailure(res, report);
  const bytes = await reportDocx(report.data);
  res.setHeader("Content-Type", DOCX_TYPE);
  res.setHeader("Content-Length", bytes.length);
  res.setHeader("Content-Disposition", buildContentDisposition("attachment", reportFilename(report.data)));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(bytes);
}));

retainerReportRouter.post("/:period/sent", requireAuth, requireMfaIfEnrolled, asyncRoute(async (req, res) => {
  send(res, await markReportSent(createServerSupabase(), {
    ...matterActor(req, res),
    days: parsePeriod(req.params.period) ?? undefined,
    body: req.body,
  }), 201);
}));

retainerReportRouter.use(routerErrorHandler("[retainer-report]"));
