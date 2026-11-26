/**
 * The one rule for which playbooks a person sees on a firm's request types:
 * those they may open by the playbooks module's own rule (a member on a
 * playbook's deny list does not see it, and a person outside the firm sees
 * none). Used by the type lists, the triage card and the triage run.
 */

import { getOrgRole } from "../../lib/access";
import type { Db } from "../../lib/supabase";
import { resolvePlaybookRoles } from "../playbooks/playbooks.service";

export type PlaybookRow = { id: string; name: string };
export type AccessRow = PlaybookRow & { user_id: string; org_id: string | null; visibility: string | null };

export const ACCESS_COLUMNS = "id, name, user_id, org_id, visibility";

export async function openableBy(db: Db, userId: string, orgId: string, rows: AccessRow[]): Promise<PlaybookRow[]> {
  const role = await getOrgRole(userId, orgId, db);
  if (!role) return [];
  const roles = await resolvePlaybookRoles(db, rows, userId, null, new Map([[orgId, role]]));
  return rows.filter((row) => roles.has(row.id)).map((row) => ({ id: row.id, name: row.name }));
}
