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

/** True only when GoTrue accepted a new invitation email. Never throws. */
export async function sendSignupInvite(db: Db, email: string): Promise<boolean> {
  try {
    const { error } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: setPasswordUrl(),
    });
    if (!error) return true;
    const e = error as { code?: string; message?: string };
    if (e.code === "email_exists" || /already.*registered/i.test(e.message ?? ""))
      return false;
    console.warn("[invite-email] send failed", safeError(error));
  } catch (error) {
    console.warn("[invite-email] send failed", safeError(error));
  }
  return false;
}
