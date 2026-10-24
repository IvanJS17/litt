import { Router, type Request, type Response } from "express";

import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import {
  DRIVE_FOLDER_ID_PATTERN,
  readMatterDriveFolder,
  updateMatterDriveFolder,
} from "./matters.service";

export const matterSettingsRouter = Router({ mergeParams: true });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_FOLDER = {
  code: "invalid_drive_folder_id",
  detail: "Invalid Drive folder ID.",
};

function identityOf(res: Response): AuthenticatedIdentity | null {
  const identity = res.locals.authenticatedIdentity;
  if (typeof identity !== "object" || identity === null) return null;
  const candidate = identity as { user_id?: unknown };
  if (typeof candidate.user_id !== "string") return null;
  return identity as AuthenticatedIdentity;
}

function opaqueNotFound(res: Response) {
  return res.status(404).json({ code: "not_found", detail: "Not found." });
}

function requestIds(
  req: Request,
): { projectId: string; matterId: string } | null {
  const projectId = String(req.params.projectId);
  const matterId = String(req.params.matterId);
  if (!UUID_RE.test(projectId) || !UUID_RE.test(matterId)) return null;
  return { projectId, matterId };
}

function requestedFolder(
  body: unknown,
): { value: string | null } | { invalid: true } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "drive_folder_id")
  )
    return { invalid: true };
  const value = (body as { drive_folder_id?: unknown }).drive_folder_id;
  if (value === null) return { value: null };
  if (typeof value !== "string") return { invalid: true };
  const folder = value.trim();
  if (folder === "") return { value: null };
  return DRIVE_FOLDER_ID_PATTERN.test(folder)
    ? { value: folder }
    : { invalid: true };
}

matterSettingsRouter.get("/:matterId/drive-folder", requireAuth, async (req, res) => {
  const ids = requestIds(req);
  if (!ids) return opaqueNotFound(res);
  const identity = identityOf(res);
  if (!identity) return opaqueNotFound(res);
  const result = await readMatterDriveFolder(createServerSupabase(), {
    project_id: ids.projectId,
    matter_id: ids.matterId,
    identity,
  });
  if (!result.ok) return sendServiceFailure(res, result);
  return res.json(result.data);
});

matterSettingsRouter.patch(
  "/:matterId/drive-folder",
  requireAuth,
  requireMfaIfEnrolled,
  async (req, res) => {
    const ids = requestIds(req);
    if (!ids) return opaqueNotFound(res);
    const folder = requestedFolder(req.body);
    if ("invalid" in folder) return res.status(400).json(INVALID_FOLDER);
    const identity = identityOf(res);
    if (!identity) return opaqueNotFound(res);
    const result = await updateMatterDriveFolder(createServerSupabase(), {
      project_id: ids.projectId,
      matter_id: ids.matterId,
      identity,
      drive_folder_id: folder.value,
    });
    if (!result.ok) return sendServiceFailure(res, result);
    return res.json(result.data);
  },
);
