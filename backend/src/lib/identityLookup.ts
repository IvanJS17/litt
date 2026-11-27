// The identity the auth service holds for an email address, as the admin
// lookup reports it. Shared by the invitation mail and the recovery rule.

import { trimChars } from "./modelJsonFence";

export type Identity = {
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
export async function findIdentity(address: string): Promise<Identity | null> {
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
