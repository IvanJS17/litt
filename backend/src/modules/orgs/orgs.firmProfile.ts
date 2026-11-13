// The firm's profile (docs/firm-profile.md). Any member can read it (it is what
// the assistant is told about the firm); whoever manages the firm's settings
// (owners and admins, like the keys and the managed-accounts setting) replace
// or clear it. Stored in organizations.firm_profile.
import { recordAudit } from "../../lib/audit";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { OrgResult } from "../../lib/orgs";
import { changedFirmProfileFields, normalizeFirmProfile, type FirmProfile } from "../../lib/firmProfile";
import { readOrgFirmProfile, saveOrgFirmProfile } from "../../lib/firmProfileStore";
import type { Db } from "../../lib/supabase";

export type OrgFirmProfile = { profile: FirmProfile | null; can_manage: boolean };

const dbError = (error: unknown): { ok: false; kind: "db_error"; detail: string } => ({
    ok: false,
    kind: "db_error",
    detail: error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error),
});

export async function getOrgFirmProfile(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ settings: OrgFirmProfile }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    try {
        return { ok: true, settings: { profile: await readOrgFirmProfile(db, params.orgId), can_manage: isOrgAdmin(role) } };
    } catch (error) {
        return dbError(error);
    }
}

export async function saveOrgFirmProfileBody(
    db: Db,
    params: { actorId: string; actorEmail?: string | null; orgId: string; body: unknown },
): Promise<OrgResult<{ settings: OrgFirmProfile }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };
    const body = params.body as { profile?: unknown } | null;
    if (!body || typeof body !== "object" || !("profile" in body))
        return { ok: false, kind: "validation", detail: "Expected { profile: {...} | null }" };
    const parsed = normalizeFirmProfile(body.profile);
    if (!parsed.ok) return { ok: false, kind: "validation", detail: parsed.detail, code: parsed.code };
    let before: FirmProfile | null;
    try {
        before = await readOrgFirmProfile(db, params.orgId);
        if (!(await saveOrgFirmProfile(db, params.orgId, parsed.profile))) return { ok: false, kind: "not_found" };
    } catch (error) {
        return dbError(error);
    }
    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        orgId: params.orgId,
        action: "org.profile.updated",
        surface: "organization",
        // Which fields changed, never what they say: the free text is the firm's own.
        detail: { org_id: params.orgId, changed_fields: changedFirmProfileFields(before, parsed.profile) },
    });
    return { ok: true, settings: { profile: parsed.profile, can_manage: true } };
}
