// The person's setting for the citation check (Settings > Privacy and data).
// The check is the platform's (lib/citationSupport): on for everyone unless
// the person opts out, and offered at all only when the server switch and
// the platform key are on. Nothing here is a secret.
import { citationCheckApiKey } from "../../lib/chatFeatureGates";
import {
    citationCheckWanted,
    setCitationCheckWanted,
} from "../../lib/citationSupport";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

export type CitationCheckSetting = { available: boolean; enabled: boolean };

export async function getCitationCheckSetting(
    db: Db,
    userId: string,
): Promise<ServiceResult<CitationCheckSetting>> {
    try {
        return ok({
            available: citationCheckApiKey() !== null,
            enabled: await citationCheckWanted(db, userId),
        });
    } catch (error) {
        return internalFailure(error);
    }
}

export async function updateCitationCheckSetting(
    db: Db,
    userId: string,
    enabled: unknown,
): Promise<ServiceResult<CitationCheckSetting>> {
    if (typeof enabled !== "boolean")
        return failure("validation", "A boolean enabled value is required.");
    try {
        if (!(await setCitationCheckWanted(db, userId, enabled)))
            return failure("not_found", "Profile not found.");
        return getCitationCheckSetting(db, userId);
    } catch (error) {
        return internalFailure(error);
    }
}
