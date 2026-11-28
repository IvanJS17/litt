// Blocking the unfinished account of a withdrawn invitation, and letting it
// back in. The block is the identity service's own ban (no sign-in, no session
// refresh, no session lookup) plus a mark of ours in the account's app
// metadata, so that only a block we made is ever lifted. Nothing is deleted.

import { recordAudit } from "./audit";
import type { Db } from "./supabase";
import { findIdentity } from "./identityLookup";
import { unfinishedInvitationAccountId } from "./platformAccess";

export const BLOCK_MARK_KEY = "litt_blocked";
export const BLOCK_MARK_VALUE = "invitation_withdrawn";
/** A hundred years: the identity service takes a duration, not "forever". */
const BAN_DURATION = "876000h";

type Actor = { userId: string; userEmail?: string | null };
type Admin = Db["auth"]["admin"];

async function readUser(admin: Admin, accountId: string) {
  const { data, error } = await admin.getUserById(accountId);
  if (error || !data?.user) throw error ?? new Error("account not found");
  const user = data.user as { banned_until?: string | null; app_metadata?: Record<string, unknown> };
  return {
    banned: !!user.banned_until && Date.parse(user.banned_until) > Date.now(),
    ours: user.app_metadata?.[BLOCK_MARK_KEY] === BLOCK_MARK_VALUE,
  };
}

/**
 * Bans the account and marks it as ours. An account already banned is left
 * exactly as it is: no mark and no audit row. Throws when it cannot be done.
 */
export async function blockAccount(db: Db, accountId: string, actor: Actor): Promise<void> {
  const state = await readUser(db.auth.admin, accountId);
  // Already banned, for another reason or by an earlier block of ours: nothing to write.
  if (state.banned) return;
  const { error } = await db.auth.admin.updateUserById(accountId, {
    ban_duration: BAN_DURATION,
    app_metadata: { [BLOCK_MARK_KEY]: BLOCK_MARK_VALUE },
  });
  if (error) throw error;
  await recordAudit(db, {
    userId: actor.userId,
    userEmail: actor.userEmail ?? null,
    action: "account.blocked",
    detail: { account_id: accountId, reason: BLOCK_MARK_VALUE },
  });
}

/**
 * Decides whether the unfinished account of an address is to be blocked now,
 * and blocks it. A withdrawal calls it twice: before the invitation is removed
 * (so that nothing is withdrawn when the block cannot be written) and again
 * once it is gone, because another live invitation that was withdrawn at the
 * same time may have made the first answer "no". `except` is the invitation
 * being withdrawn. Throws when it cannot tell or cannot block.
 */
export async function blockUnfinishedAccount(
  db: Db,
  address: string | null | undefined,
  except: { table: "org_invitations" | "platform_invitations"; id: string },
  actor: Actor,
): Promise<void> {
  const unfinished = await unfinishedInvitationAccountId(db, address, except);
  if (unfinished) await blockAccount(db, unfinished, actor);
}

/**
 * Called once an invitation is written or sent again: the account of this
 * address, if we blocked it, is let back in. A ban without our mark is never
 * lifted. Throws when it cannot tell or cannot lift: the caller answers a
 * failure and the account stays blocked.
 */
export async function liftInvitationBlock(db: Db, address: string, actor: Actor): Promise<void> {
  const identity = await findIdentity(address);
  if (!identity) return;
  const state = await readUser(db.auth.admin, identity.id);
  if (!state.ours) return;
  const { error } = await db.auth.admin.updateUserById(identity.id, {
    ban_duration: "none",
    app_metadata: { [BLOCK_MARK_KEY]: null },
  });
  if (error) throw error;
  await recordAudit(db, {
    userId: actor.userId,
    userEmail: actor.userEmail ?? null,
    action: "account.unblocked",
    detail: { account_id: identity.id, reason: BLOCK_MARK_VALUE },
  });
}
