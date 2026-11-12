import type { Db } from "../supabase";
import { getEffectiveApiKeys } from "../providerCredentials/index";

// Scan reading is bring-your-own-key, resolved like the web-search keys: the
// organization's key first, then the member's own only when the organization
// allows personal keys, and the member's own outside any organization. There
// is no platform key and no environment fallback (envApiKey("landingai") is
// always null), so with nothing saved the feature does not exist.

/** The key to read scans with for content of `orgId`, or null. Never log it. */
export async function resolveScanKey(
    db: Db,
    userId: string,
    orgId: string | null | undefined,
): Promise<string | null> {
    const keys = await getEffectiveApiKeys(userId, orgId, db);
    return keys.landingai?.trim() || null;
}
