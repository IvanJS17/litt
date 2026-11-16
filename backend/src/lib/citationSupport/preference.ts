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
