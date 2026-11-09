// Invite-only access (beta). `PLATFORM_ADMIN_EMAILS` (comma-separated) both
// names the platform administrators and switches the beta mode on; empty
// keeps today's open behaviour. Every rule compares the NORMALIZED email and
// nothing else.

import { normalizeEmail } from "./access";
import type { Db } from "./supabase";

export function platformAdmins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter((email): email is string => !!email);
}

export function betaMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return platformAdmins(env).length > 0;
}

export function isPlatformAdmin(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = normalizeEmail(email);
  return !!normalized && platformAdmins(env).includes(normalized);
}

/** A pending, unexpired platform invitation for this email, or null. */
export async function pendingPlatformInvitationId(
  db: Db,
  email: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await db
    .from("platform_invitations")
    .select("id")
    .eq("email", normalized)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** May this email register? Admin, or a live org or platform invitation. */
export async function canSignUp(db: Db, email: string): Promise<boolean> {
  if (!betaMode() || isPlatformAdmin(email)) return true;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const { data, error } = await db
    .from("org_invitations")
    .select("id")
    .eq("email", normalized)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return true;
  return (await pendingPlatformInvitationId(db, normalized)) !== null;
}

/**
 * Claims the email's pending platform invitation for one organization. The
 * conditional update checks the rows it changed, so two concurrent requests
 * cannot both claim it. Returns the invitation id, or null when none is left.
 */
export async function claimPlatformInvitation(
  db: Db,
  email: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await db
    .from("platform_invitations")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("email", normalized)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** Gives back a claim whose organization could not be created. */
export async function releasePlatformInvitation(db: Db, id: string): Promise<void> {
  await db
    .from("platform_invitations")
    .update({ status: "pending", used_at: null })
    .eq("id", id)
    .eq("status", "used");
}
