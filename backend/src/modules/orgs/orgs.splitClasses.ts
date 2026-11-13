// The firm's list of document types for splitting a case file (layer 7,
// docs/document-split.md). Any member can read it (it explains what Split will
// offer them); whoever already manages the firm's keys (owners and admins) can
// replace or restore it. Stored in organizations.split_classes.
import { recordAudit } from "../../lib/audit";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { OrgResult } from "../../lib/orgs";
import { readOrgSplitClasses, saveOrgSplitClasses } from "../../lib/ocr/splitClassStore";
import { parseSplitClassesBody, splitClassesSettings, type SplitClassesSettings } from "../../lib/ocr/splitClasses";
import type { Db } from "../../lib/supabase";

export type OrgSplitClasses = SplitClassesSettings & { can_manage: boolean };

const dbError = (error: unknown): { ok: false; kind: "db_error"; detail: string } => ({
    ok: false,
    kind: "db_error",
    detail: error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error),
});

export async function getOrgSplitClasses(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ settings: OrgSplitClasses }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    try {
        return { ok: true, settings: { ...splitClassesSettings(await readOrgSplitClasses(db, params.orgId)), can_manage: isOrgAdmin(role) } };
    } catch (error) {
        return dbError(error);
    }
}

export async function saveOrgSplitClassesList(
    db: Db,
    params: { actorId: string; actorEmail?: string | null; orgId: string; body: unknown },
): Promise<OrgResult<{ settings: OrgSplitClasses }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };
    const parsed = parseSplitClassesBody(params.body);
    if (!parsed.ok) return { ok: false, kind: "validation", detail: parsed.detail };
    try {
        if (!(await saveOrgSplitClasses(db, params.orgId, parsed.classes))) return { ok: false, kind: "not_found" };
    } catch (error) {
        return dbError(error);
    }
    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        action: parsed.classes ? "org.split_classes.updated" : "org.split_classes.reset",
        // The count only: the list is the firm's product data, not an audit payload.
        detail: { org_id: params.orgId, ...(parsed.classes ? { class_count: parsed.classes.length } : {}) },
    });
    return { ok: true, settings: { ...splitClassesSettings(parsed.classes), can_manage: true } };
}
