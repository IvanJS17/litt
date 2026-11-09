// Acceptance of the published Terms and Privacy Notice (LEGAL_VERSION lives in
// user.profile.storage so the profile serializer can compare against it).
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { ensureProfileRow, loadProfile } from "./user.profile.load";
import { LEGAL_VERSION } from "./user.profile.storage";
import type { Db } from "./user.shared";

export const TERMS_VERSION_MISMATCH = "terms_version_mismatch";

export async function acceptTerms(
    db: Db,
    userId: string,
    version: unknown,
): Promise<ServiceResult<Record<string, unknown>>> {
    if (version !== LEGAL_VERSION)
        return failure("conflict", "These are not the current Terms.", TERMS_VERSION_MISMATCH);
    const ensureError = await ensureProfileRow(db, userId);
    if (ensureError) return internalFailure(ensureError);
    const { error } = await db
        .from("user_profiles")
        .update({ terms_accepted_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() })
        .eq("user_id", userId);
    if (error) return internalFailure(error);
    await recordAudit(db, {
        userId,
        action: "user.terms_accepted",
        surface: "user",
        detail: { version: LEGAL_VERSION },
    });
    const { data, error: loadError } = await loadProfile(db, userId);
    if (loadError) return internalFailure(loadError);
    return ok(data);
}
