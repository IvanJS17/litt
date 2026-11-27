// Invitation email, sent by GoTrue (its SMTP and invite template): the
// backend holds no mail credentials. An email with an account gets none; the
// person sees the invitation inside the app.

import { randomBytes } from "node:crypto";
import { normalizeEmail } from "./access";
import { isPlatformAdmin } from "./platformAccess";
import { trimChars } from "./modelJsonFence";
import type { Db } from "./supabase";
import { listPersonalOrgIds } from "./personalOrgs";
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

/** An anonymous sign-up does not mail the same unconfirmed address again within this long. */
export const INVITE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Addresses mailed an anonymous invitation within the cool-down (address ->
 * when) and addresses being worked on right now. The backend is one process, so
 * these decide for every caller whatever its client address; entries leave
 * with the cool-down.
 */
const recentInvitations = new Map<string, number>();
const invitationsInFlight = new Set<string>();

/** For tests: forget what was mailed and what is in flight. */
export function forgetRecentInvitations(): void {
  recentInvitations.clear();
  invitationsInFlight.clear();
}

type InviteUser = { id?: string; created_at?: string } | null | undefined;
type InviteResult =
  | { kind: "sent"; user: InviteUser }
  | { kind: "held" }
  | { kind: "has_account" }
  | { kind: "failed"; error: unknown };

type Identity = {
  id: string;
  email?: string;
  invited_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
};

const LOOKUP_PAGE_SIZE = 50;
const LOOKUP_MAX_PAGES = 10;

/**
 * The identity GoTrue holds for this address, or null. Asked of GoTrue itself
 * (its admin search by address, a substring match checked here for the exact
 * address), because the profile table is no index of identities: its row is
 * written in a block that never fails sign-up. Throws when it cannot tell.
 */
async function findIdentity(address: string): Promise<Identity | null> {
  const email = address.trim().toLowerCase();
  const base = trimChars(process.env.SUPABASE_URL ?? "", "", "/", Infinity);
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!base || !key) throw new Error("identity service not configured");
  for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
    const response = await fetch(
      `${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=${page}&per_page=${LOOKUP_PAGE_SIZE}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) throw new Error(`identity lookup failed (${response.status})`);
    const users = ((await response.json()) as { users?: Identity[] }).users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < LOOKUP_PAGE_SIZE) return null;
  }
  throw new Error("identity lookup incomplete");
}

/**
 * Every path that mails an invitation link goes through here. An unconfirmed
 * identity that already exists for the address (an earlier sign-up) may hold
 * a password nobody proved they may choose, and opening the link confirms the
 * address, so that password is replaced by a random one first; the mail must
 * follow it because replacing a password voids the link already sent. A
 * confirmed identity is never touched. With `coolDown`, an identity invited
 * less than INVITE_COOLDOWN_MS ago is left as it is and nothing is sent.
 * Never throws; no mail goes out when the replacement fails.
 */
async function inviteByEmail(
  db: Db,
  email: string,
  options: { coolDown?: boolean } = {},
): Promise<InviteResult> {
  try {
    const identity = await findIdentity(email);
    if (identity && !identity.email_confirmed_at) {
      if (options.coolDown && Date.now() - Date.parse(identity.invited_at ?? "") < INVITE_COOLDOWN_MS)
        return { kind: "held" };
      const { error } = await db.auth.admin.updateUserById(identity.id, {
        password: randomBytes(32).toString("base64url"),
      });
      if (error) throw error;
    }
  } catch (error) {
    console.warn("[invite-email] password not replaced", safeError(error));
    return { kind: "failed", error };
  }
  try {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: setPasswordUrl(),
    });
    if (!error) return { kind: "sent", user: data?.user };
    const e = error as { code?: string; message?: string };
    if (e.code === "email_exists" || /already.*registered/i.test(e.message ?? ""))
      return { kind: "has_account" };
    console.warn("[invite-email] send failed", safeError(error));
    return { kind: "failed", error };
  } catch (error) {
    console.warn("[invite-email] send failed", safeError(error));
    return { kind: "failed", error };
  }
}

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
  const result = await inviteByEmail(db, email);
  if (result.kind !== "sent") return false;
  if (options.createdByOrgId) await recordCreatingOrg(db, result.user, options.createdByOrgId);
  return true;
}

/**
 * Closed beta sign-up for an address admitted only by an invitation or the
 * administrator list. The caller proved nothing about the mailbox, so no
 * account is made with the caller's password: GoTrue mails its invitation
 * link and the person sets the password from it. Asking again for an address
 * invited moments ago sends nothing, so a caller cannot keep voiding the
 * link the person holds. That holds for any number of callers at once: the
 * process remembers the addresses it is mailing and those it mailed within the
 * cool-down. The caller is told the same in every case. Never throws.
 */
export async function inviteAdmittedSignup(db: Db, address: string): Promise<InviteResult> {
  const email = normalizeEmail(address) ?? address;
  const started = Date.now();
  // Oldest first: the entries still inside the cool-down are the tail.
  for (const [known, mailedAt] of recentInvitations) {
    if (started - mailedAt < INVITE_COOLDOWN_MS) break;
    recentInvitations.delete(known);
  }
  if (invitationsInFlight.has(email) || recentInvitations.has(email)) return { kind: "held" };
  invitationsInFlight.add(email);
  try {
    const result = await inviteByEmail(db, email, { coolDown: true });
    if (result.kind === "sent") {
      recentInvitations.set(email, Date.now());
      await recordCreatingOrgOfSignup(db, result.user, email);
    }
    return result;
  } finally {
    invitationsInFlight.delete(email);
  }
}

/**
 * Called when a platform or firm invitation is about to be withdrawn: the
 * identity that invitation created must not outlive it as a way in. It is
 * removed only when it is plainly unused: invited, never confirmed, never
 * signed in, in no firm, no administrator address, and with no other live
 * invitation (`except` is the one being withdrawn). Anything else is left
 * alone. Throws when it cannot tell or cannot remove, so the caller withdraws
 * nothing and the person can retry. The identity service does not reveal
 * whether a confirmed identity chose a password, so a confirmed one is kept.
 */
export async function retireUnusedInvitationIdentity(
  db: Db,
  address: string,
  except: { table: "org_invitations" | "platform_invitations"; id: string },
): Promise<void> {
  const email = normalizeEmail(address);
  if (!email || isPlatformAdmin(email)) return;
  const identity = await findIdentity(email);
  if (!identity || !identity.invited_at || identity.email_confirmed_at || identity.last_sign_in_at) return;

  // Every identity owns a personal organization from the moment it is made;
  // that membership is not a firm.
  const personalOrgIds = await listPersonalOrgIds(db, identity.id);
  const { data: memberships, error: membershipError } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", identity.id);
  if (membershipError) throw membershipError;
  if ((memberships ?? []).some((m) => !personalOrgIds.has((m as { org_id: string }).org_id))) return;

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
    if (data && data.length > 0) return;
  }

  const { error } = await db.auth.admin.deleteUser(identity.id);
  if (error) throw error;
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
