// Authorization epochs for queued work (LiTT C4, docs/UPSTREAM_SYNC_PLAN.md §3).
//
// organizations.authorization_epoch advances on every authorization change in
// the organization: a member added, changed or removed, a matter membership
// changed, a matter made private or moved (triggers in 20261023_01). Work
// queued on someone's authority carries the epoch it was queued under; when it
// runs — first attempt or retry — a different epoch means that authority may
// no longer hold, so the job fails instead of acting on it. Requests need no
// stamp: they resolve membership and matter access live on every call.

import type { Db } from "./supabase";
import { NonRetryableJobError } from "./dbq/runner";

/** The organization and epoch a job was authorized under. */
export type AuthorizationStamp = { orgId: string; epoch: number };

/** Thrown when queued work outlived the authorization it was queued under. */
export class StaleAuthorizationError extends NonRetryableJobError {
    constructor(reason: string) {
        super(`stale_authorization_epoch: ${reason}`);
        this.name = "StaleAuthorizationError";
    }
}

async function currentEpoch(db: Db, orgId: string): Promise<number | null> {
    const { data, error } = await db
        .from("organizations")
        .select("authorization_epoch")
        .eq("id", orgId)
        .maybeSingle();
    if (error) throw new Error("Authorization epoch lookup failed", { cause: error });
    const epoch = Number((data as { authorization_epoch?: unknown } | null)?.authorization_epoch);
    return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

/**
 * The stamp for work on content of `orgId`, or null for personal content
 * (no organization). Throws when the organization cannot be read, so nothing
 * is queued without its stamp.
 */
export async function readAuthorizationStamp(
    db: Db,
    orgId: string | null | undefined,
): Promise<AuthorizationStamp | null> {
    if (!orgId) return null;
    const epoch = await currentEpoch(db, orgId);
    if (epoch === null) throw new Error("Authorization epoch unavailable");
    return { orgId, epoch };
}

/**
 * Before queued work acts on content of `orgId`: the job must carry a stamp
 * for that organization at its current epoch. A missing stamp, another
 * organization or an advanced epoch is stale — terminal, because a retry
 * carries the same stamp. Personal content (no organization) needs none.
 */
export async function assertAuthorizationStamp(
    db: Db,
    orgId: string | null | undefined,
    stamp: unknown,
): Promise<void> {
    if (!orgId) return;
    const s = stamp as Partial<AuthorizationStamp> | null | undefined;
    if (!s || s.orgId !== orgId || !Number.isSafeInteger(s.epoch))
        throw new StaleAuthorizationError("job carries no stamp for this organization");
    const epoch = await currentEpoch(db, orgId);
    if (epoch === null || epoch !== s.epoch)
        throw new StaleAuthorizationError("authorization changed since the job was queued");
}
