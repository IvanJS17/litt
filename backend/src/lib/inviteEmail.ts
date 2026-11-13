// Invitation email, sent by GoTrue (its SMTP and invite template): the
// backend holds no mail credentials. An email with an account gets none; the
// person sees the invitation inside the app.

import type { Db } from "./supabase";
import { safeError } from "./safeError";

/** Where the invited person sets a password (the app's own origin). */
function setPasswordUrl(): string {
  const origin = (process.env.FRONTEND_URL ?? "http://localhost:3000").trim();
  return new URL("/auth/set-password", origin).toString();
}

/**
 * An account GoTrue made for this invitation is new; one it found and sent
 * the email to again (an earlier sign-up not yet confirmed) is not.
 */
const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 1000;

/**
 * True only when GoTrue accepted a new invitation email. Never throws.
 *
 * With `createdByOrgId` (an organization's invitation), the account this email
 * creates is recorded as created by that organization, once and only for an
 * account made just now: an account that existed before the invitation keeps
 * no creating organization and so keeps its personal space
 * (lib/managedAccounts.ts). The platform's own invitations pass none.
 */
export async function sendSignupInvite(
  db: Db,
  email: string,
  options: { createdByOrgId?: string } = {},
): Promise<boolean> {
  try {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: setPasswordUrl(),
    });
    if (!error) {
      if (options.createdByOrgId) await recordCreatingOrg(db, data?.user, options.createdByOrgId);
      return true;
    }
    const e = error as { code?: string; message?: string };
    if (e.code === "email_exists" || /already.*registered/i.test(e.message ?? ""))
      return false;
    console.warn("[invite-email] send failed", safeError(error));
  } catch (error) {
    console.warn("[invite-email] send failed", safeError(error));
  }
  return false;
}

async function recordCreatingOrg(
  db: Db,
  user: { id?: string; created_at?: string } | null | undefined,
  orgId: string,
): Promise<void> {
  try {
    const createdAt = Date.parse(user?.created_at ?? "");
    if (!user?.id || !(Date.now() - createdAt < NEW_ACCOUNT_WINDOW_MS)) return;
    const { error } = await db
      .from("user_profiles")
      .update({ created_by_org_id: orgId })
      .eq("user_id", user.id)
      .is("created_by_org_id", null);
    if (error) console.warn("[invite-email] creating org not recorded", safeError(error));
  } catch (error) {
    console.warn("[invite-email] creating org not recorded", safeError(error));
  }
}

/**
 * Closed beta: an email with a live organization invitation may register on
 * its own. The account that registration makes is created by that invitation,
 * so it is recorded like the one the invitation email makes. With several live
 * invitations the oldest organization wins. Never throws.
 */
export async function recordCreatingOrgOfSignup(
  db: Db,
  user: { id?: string; created_at?: string } | null | undefined,
  email: string,
): Promise<void> {
  try {
    const createdAt = Date.parse(user?.created_at ?? "");
    if (!user?.id || !(Date.now() - createdAt < NEW_ACCOUNT_WINDOW_MS)) return;
    const { data, error } = await db
      .from("org_invitations")
      .select("org_id")
      .eq("email", email.trim().toLowerCase())
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    const orgId = (data?.[0] as { org_id?: string } | undefined)?.org_id;
    if (orgId) await recordCreatingOrg(db, user, orgId);
  } catch (error) {
    console.warn("[invite-email] creating org not recorded", safeError(error));
  }
}
