import type { Db } from "../supabase";

// The person's opt-out of the citation check (user_profiles.citation_check,
// on by default). A database that has not run the migration has no column;
// that reads as "on", because it has no table to write to either and the
// check fails closed there.

const isMissingColumn = (error: { code?: string | null }) =>
    error.code === "42703" || error.code === "PGRST204";

/** False only when the person turned the check off. */
export async function citationCheckWanted(db: Db, userId: string): Promise<boolean> {
    const { data, error } = await db
        .from("user_profiles")
        .select("citation_check")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isMissingColumn(error)) return true;
        throw error;
    }
    return (data as { citation_check?: unknown } | null)?.citation_check !== false;
}

/**
 * Whether this person's turns may be checked at all: they did not opt out AND
 * they have accepted the current legal version (`legalVersion`). The check
 * sends text to TypeSafe, a processor LiTT names in the Privacy Notice and the
 * Terms (clause 9.3.4 promises to announce it before), so a person who has
 * not yet accepted the text that names it is never sent (socium-legal C1).
 * Any doubt reads as "no": a missing column, a failed read or a missing row.
 */
export async function citationCheckPermitted(
    db: Db,
    userId: string,
    legalVersion: string,
): Promise<boolean> {
    const { data, error } = await db
        .from("user_profiles")
        .select("citation_check, terms_accepted_version")
        .eq("user_id", userId)
        .maybeSingle();
    if (error || !data) return false;
    const row = data as { citation_check?: unknown; terms_accepted_version?: unknown };
    return row.citation_check !== false && row.terms_accepted_version === legalVersion;
}

export async function setCitationCheckWanted(
    db: Db,
    userId: string,
    wanted: boolean,
): Promise<boolean> {
    const { data, error } = await db
        .from("user_profiles")
        .update({ citation_check: wanted })
        .eq("user_id", userId)
        .select("user_id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
}
