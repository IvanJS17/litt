// Invite-only access (beta). `PLATFORM_ADMIN_EMAILS` (comma-separated) both
// names the platform administrators and switches the beta mode on; empty
// keeps today's open behaviour. Every rule compares the NORMALIZED email and
// nothing else.

import { normalizeEmail } from "./access";
import { findIdentity } from "./identityLookup";
import { listPersonalOrgIds } from "./personalOrgs";
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

/**
 * May a recovery mail be requested for this address? Outside invitation-only
 * mode always, reading nothing. In it, for an administrator, an address with a
 * current invitation, and a confirmed identity that is not an unfinished
 * invitation: one no invitation created, or one whose account shows it was
 * finished (a password set, the terms accepted, onboarding done, or a place
 * in a firm). An identity an invitation created that was never finished, and
 * an address with no identity and no invitation, get none. Throws when it
 * cannot tell, so the caller requests nothing.
 */
export async function mayRecoverPassword(db: Db, address: string): Promise<boolean> {
  if (!betaMode()) return true;
  const email = normalizeEmail(address);
  if (!email) return false;
  if (isPlatformAdmin(email) || (await canSignUp(db, email))) return true;

  const identity = await findIdentity(email);
  if (!identity?.email_confirmed_at) return false;
  if (!identity.invited_at) return true;

  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("password_set_at, terms_accepted_at, onboarding_version")
    .eq("user_id", identity.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const marks = (profile ?? {}) as Record<string, unknown>;
  if (marks.password_set_at || marks.terms_accepted_at || marks.onboarding_version != null) return true;

  // Every identity owns a personal organization; only another one is a firm.
  const personalOrgIds = await listPersonalOrgIds(db, identity.id);
  const { data: memberships, error: membershipError } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", identity.id);
  if (membershipError) throw membershipError;
  return (memberships ?? []).some((m) => !personalOrgIds.has((m as { org_id: string }).org_id));
}

/**
 * The account to block when an invitation is withdrawn: the one holding this
 * address that was opened but never finished. It has accepted no Terms, has not
 * finished onboarding, belongs to no firm (its personal organization is not
 * one), is no platform administrator, and no OTHER live platform or firm
 * invitation names the address (`except` is the one being withdrawn). A
 * password alone does not make an account finished here. The account must also
 * have been made through an invitation. Returns its id, or
 * null when there is nothing to block. Throws when it cannot tell, so the
 * caller withdraws nothing.
 */
export async function unfinishedInvitationAccountId(
  db: Db,
  address: string | null | undefined,
  except: { table: "org_invitations" | "platform_invitations"; id: string },
): Promise<string | null> {
  const email = normalizeEmail(address);
  if (!email || isPlatformAdmin(email)) return null;
  const identity = await findIdentity(email);
  if (!identity) return null;

  // An account nobody invited (the person registered it) was not made by an
  // invitation, and withdrawing one never blocks it.
  if (!identity.invited_at) return null;

  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("terms_accepted_at, onboarding_version")
    .eq("user_id", identity.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const marks = (profile ?? {}) as Record<string, unknown>;
  if (marks.terms_accepted_at || marks.onboarding_version != null) return null;

  const personalOrgIds = await listPersonalOrgIds(db, identity.id);
  const { data: memberships, error: membershipError } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", identity.id);
  if (membershipError) throw membershipError;
  if ((memberships ?? []).some((m) => !personalOrgIds.has((m as { org_id: string }).org_id))) return null;

  for (const table of ["org_invitations", "platform_invitations"] as const) {
    let query = db
      .from(table)
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if (table === except.table) query = query.neq("id", except.id);
    const { data, error } = await query.limit(1);
    if (error) throw error;
    if (data && data.length > 0) return null;
  }
  return identity.id;
}
