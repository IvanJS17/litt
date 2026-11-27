// How much of their personal storage a person uses, and its limit. The numbers
// come from the same database function the upload check uses
// (lib/storageQuota.ts).
import type { StorageUsage } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { storageSpaceUsage } from "../../lib/storageQuota";
import type { Db } from "../../lib/supabase";

export async function getPersonalStorageUsage(
    db: Db,
    userId: string,
): Promise<ServiceResult<StorageUsage>> {
    try {
        return ok(await storageSpaceUsage(db, { orgId: null, userId }));
    } catch (error) {
        return internalFailure(error);
    }
}
