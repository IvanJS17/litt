// How much of its storage a firm uses, and its limit. Owners and
// administrators only; the numbers come from the same database function the
// upload check uses (lib/storageQuota.ts).
import type { StorageUsage } from "@mike/contracts";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { OrgResult } from "../../lib/orgs";
import { storageSpaceUsage } from "../../lib/storageQuota";
import type { Db } from "../../lib/supabase";

export async function getOrgStorageUsage(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ usage: StorageUsage }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };
    try {
        return {
            ok: true,
            usage: await storageSpaceUsage(db, { orgId: params.orgId, userId: null }),
        };
    } catch (error) {
        // An unreadable space is not an empty one: sendOrgFailure answers the
        // generic internal error and logs this text.
        return {
            ok: false,
            kind: "db_error",
            detail: error instanceof Error ? error.message : "Failed to read the storage usage",
        };
    }
}
