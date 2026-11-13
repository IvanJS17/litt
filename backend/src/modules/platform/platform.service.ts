// Platform administration: the beta invitations. HTTP-agnostic; the routes
// check that the caller is a platform administrator.

import { z } from "zod";
import { sendSignupInvite } from "../../lib/inviteEmail";
import { recordAudit } from "../../lib/audit";
import { normalizeEmail } from "../../lib/access";
import { betaMode, isPlatformAdmin, pendingPlatformInvitationId } from "../../lib/platformAccess";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

export { viewPlatformStats } from "./platform.stats";

export const PLATFORM_ADMIN_REQUIRED = "platform_admin_required";
export const PLATFORM_INVITATION_PENDING = "platform_invitation_pending";

const emailSchema = z.string().trim().toLowerCase().max(254).email();
const COLUMNS = "id,email,status,expires_at,created_at,used_at";

export async function platformMe(
  db: Db,
  user: { email: string | null },
): Promise<ServiceResult<{ admin: boolean; can_create_org: boolean }>> {
  if (!betaMode()) return ok({ admin: false, can_create_org: true });
  const admin = isPlatformAdmin(user.email);
  if (admin) return ok({ admin, can_create_org: true });
  try {
    return ok({
      admin,
      can_create_org: (await pendingPlatformInvitationId(db, user.email)) !== null,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

export async function listInvitations(db: Db): Promise<ServiceResult<unknown[]>> {
  const { data, error } = await db
    .from("platform_invitations")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) return internalFailure(error);
  return ok(data ?? []);
}

export async function createInvitation(
  db: Db,
  actor: { userId: string; email: unknown },
): Promise<ServiceResult<unknown>> {
  const parsed = emailSchema.safeParse(actor.email);
  if (!parsed.success) return failure("validation", "A valid email address is required");
  const email = normalizeEmail(parsed.data)!;

  // An expired invitation still holds the one pending slot for its email.
  const now = new Date().toISOString();
  await db
    .from("platform_invitations")
    .delete()
    .eq("email", email)
    .eq("status", "pending")
    .lte("expires_at", now);

  const { data, error } = await db
    .from("platform_invitations")
    .insert({ email, invited_by: actor.userId })
    .select(COLUMNS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505")
      return failure(
        "conflict",
        "This email already has a pending invitation.",
        PLATFORM_INVITATION_PENDING,
      );
    return internalFailure(error);
  }
  await recordAudit(db, {
    userId: actor.userId,
    action: "platform.invitation_created",
    surface: "platform",
    detail: { invitation_id: data.id },
  });
  return ok({ ...data, email_sent: await sendSignupInvite(db, email) });
}

export async function deleteInvitation(
  db: Db,
  actor: { userId: string },
  id: string,
): Promise<ServiceResult<null>> {
  const { data, error } = await db
    .from("platform_invitations")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return internalFailure(error);
  if (!data?.length) return failure("not_found", "Invitation not found");
  await recordAudit(db, {
    userId: actor.userId,
    action: "platform.invitation_cancelled",
    surface: "platform",
    detail: { invitation_id: id },
  });
  return ok(null);
}
