// Mounted at /platform. `GET /me` is for any signed-in user; the invitation
// routes are for platform administrators only.

import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { isPlatformAdmin } from "../../lib/platformAccess";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
  PLATFORM_ADMIN_REQUIRED,
  createInvitation,
  deleteInvitation,
  listInvitations,
  platformMe,
  viewPlatformStats,
} from "./platform.service";

export const platformRouter = Router();

function requirePlatformAdmin(_req: Request, res: Response, next: NextFunction) {
  if (!isPlatformAdmin(res.locals.userEmail)) {
    res.status(403).json({
      code: PLATFORM_ADMIN_REQUIRED,
      detail: "Only platform administrators can do this.",
    });
    return;
  }
  next();
}

platformRouter.get("/me", requireAuth, asyncRoute(async (_req, res) => {
  const result = await platformMe(createServerSupabase(), { email: res.locals.userEmail });
  if (!result.ok) return sendServiceFailure(res, result);
  res.json(result.data);
}));

// Beta statistics: counts only, never exported; each view is audited.
platformRouter.get("/stats", requireAuth, requirePlatformAdmin, asyncRoute(async (_req, res) => {
  const result = await viewPlatformStats(createServerSupabase(), {
    userId: res.locals.userId,
    email: res.locals.userEmail ?? null,
  });
  if (!result.ok) return sendServiceFailure(res, result);
  res.setHeader("Cache-Control", "no-store");
  res.json(result.data);
}));

platformRouter.get("/invitations", requireAuth, requirePlatformAdmin, asyncRoute(async (_req, res) => {
  const result = await listInvitations(createServerSupabase());
  if (!result.ok) return sendServiceFailure(res, result);
  res.json(result.data);
}));

platformRouter.post("/invitations", requireAuth, requirePlatformAdmin, asyncRoute(async (req, res) => {
  const result = await createInvitation(createServerSupabase(), {
    userId: res.locals.userId,
    email: req.body?.email,
  });
  if (!result.ok) return sendServiceFailure(res, result);
  res.status(201).json(result.data);
}));

platformRouter.delete("/invitations/:id", requireAuth, requirePlatformAdmin, asyncRoute(async (req, res) => {
  const result = await deleteInvitation(createServerSupabase(), { userId: res.locals.userId }, req.params.id);
  if (!result.ok) return sendServiceFailure(res, result);
  res.status(204).send();
}));

platformRouter.use(routerErrorHandler("[platform]"));
