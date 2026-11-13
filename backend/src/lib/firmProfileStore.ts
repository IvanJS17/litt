// Where the firm's profile lives (docs/firm-profile.md): organizations.firm_profile,
// one jsonb value, written only by the backend. `loadFirmProfileFor` is what the
// chat modules call: it answers for a firm's workspace and for nothing else.
import type { Db } from "./supabase";
import { teamOrgIdOf } from "./personalOrgs";
import { readStoredFirmProfile, type FirmProfile } from "./firmProfile";

export async function readOrgFirmProfile(db: Db, orgId: string): Promise<FirmProfile | null> {
    const { data, error } = await db.from("organizations").select("firm_profile").eq("id", orgId).maybeSingle();
    if (error) throw error;
    return readStoredFirmProfile((data as { firm_profile?: unknown } | null)?.firm_profile);
}

/** Replace a firm's profile; null removes it. Returns false when the firm does not exist. */
export async function saveOrgFirmProfile(db: Db, orgId: string, profile: FirmProfile | null): Promise<boolean> {
    const { data, error } = await db
        .from("organizations")
        .update({ firm_profile: profile, updated_at: new Date().toISOString() })
        .eq("id", orgId)
        .select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
}

/**
 * The profile of the firm a chat belongs to. Null for a personal space (no
 * organization, or the person's personal one) and when the profile is empty or
 * cannot be read: a chat never fails because of it. The orgId is the one the
 * route already resolved for the chat's content, never one the client names.
 */
export async function loadFirmProfileFor(db: Db, orgId: string | null | undefined): Promise<FirmProfile | null> {
    if (!orgId) return null;
    try {
        const teamOrgId = await teamOrgIdOf(db, orgId);
        return teamOrgId ? await readOrgFirmProfile(db, teamOrgId) : null;
    } catch {
        return null;
    }
}
