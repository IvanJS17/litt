// The firm's "managed accounts" setting (docs/managed-accounts.md): when on,
// the accounts this firm invited and that were created by that invitation have
// no personal space. Who may change it is the rule for the other key setting
// (setOrgPersonalApiKeysAllowed): the organization's owners and admins.
//
// Nothing is copied to the accounts it affects. The rule is evaluated live on
// every request (lib/managedAccounts.ts), so the change applies at once, to
// open sessions too, and nothing a person already has is deleted.

import { recordAudit } from "../../lib/audit";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { OrgResult } from "../../lib/orgs";
import type { Db } from "../../lib/supabase";

export type OrgManagedAccounts = {
    managed_accounts: boolean;
    /** Current members whose account this firm's invitation created. */
    managed_members: number;
};

async function countManagedMembers(db: Db, orgId: string): Promise<number> {
    const { data, error } = await db
        .from("user_profiles")
        .select("user_id")
        .eq("created_by_org_id", orgId);
    if (error) throw new Error("Failed to read the accounts the firm created");
    const created = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (created.length === 0) return 0;
    const { data: members, error: membersError } = await db
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId)
        .in("user_id", created);
    if (membersError) throw new Error("Failed to read the firm's members");
    return (members ?? []).length;
}

/** Turn managed accounts on or off. Owners and admins. */
export async function setOrgManagedAccounts(
    db: Db,
    params: {
        actorId: string;
        actorEmail?: string | null;
        orgId: string;
        enabled: unknown;
    },
): Promise<OrgResult<{ settings: OrgManagedAccounts }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };
    if (typeof params.enabled !== "boolean")
        return {
            ok: false,
            kind: "validation",
            detail: "managed_accounts must be true or false",
        };

    const { data, error } = await db
        .from("organizations")
        .update({
            managed_accounts: params.enabled,
            updated_at: new Date().toISOString(),
        })
        .eq("id", params.orgId)
        .select("id");
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    if (!data?.length) return { ok: false, kind: "not_found" };

    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        orgId: params.orgId,
        action: params.enabled
            ? "org.managed_accounts.enabled"
            : "org.managed_accounts.disabled",
        surface: "organization",
        detail: { org_id: params.orgId },
    });
    try {
        return {
            ok: true,
            settings: {
                managed_accounts: params.enabled,
                managed_members: await countManagedMembers(db, params.orgId),
            },
        };
    } catch (readError) {
        return {
            ok: false,
            kind: "db_error",
            detail:
                readError instanceof Error ? readError.message : String(readError),
        };
    }
}
