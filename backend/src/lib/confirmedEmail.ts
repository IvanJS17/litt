import type { Db } from "./supabase";

/**
 * The address the account has CONFIRMED right now, lower-cased, or "" when it
 * has none. Direct grants and invitations are matched against it, so a queued
 * job that acts for a person asks the account when it runs: the address that
 * was copied into the job when it was requested may belong to somebody else
 * by then. An address that is not confirmed matches nothing.
 *
 * Throws when the account cannot be read; the job must not run on a guess.
 */
export async function currentConfirmedEmail(db: Db, userId: string): Promise<string> {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) throw new Error("Failed to read the account's address");
    const user = data?.user as
        | { email?: string | null; email_confirmed_at?: string | null }
        | null
        | undefined;
    return user?.email && user.email_confirmed_at ? user.email.toLowerCase() : "";
}
