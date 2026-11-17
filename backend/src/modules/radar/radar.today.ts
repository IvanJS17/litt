/**
 * "Today": the open radar items, across the retainer matters of one
 * organization where the caller is an ACTIVE member. A matter is read only
 * through the same gate as its own radar (authorizeMatterMember: project
 * access, organization membership, active matter membership); an
 * organization owner or admin without a membership sees nothing of it.
 */

import type { RadarToday, RadarTodayItem } from "@mike/contracts";
import { getOrgRole } from "../../lib/access";
import { mapWithConcurrency } from "../../lib/concurrency";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { selectInBatches } from "../../lib/batchedQuery";
import { authorizeMatterMember } from "../matters/matters.service";
import { RADAR_TIME_ZONE, todayInMexicoCity } from "./radar.dates";
import { loadRadarItems } from "./radar.items";
import { isOpen, MAX_TODAY_MATTERS } from "./radar.shared";

type MatterRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string | null;
  is_retainer: boolean;
  visibility: string;
};

export async function getRadarToday(
  db: Db,
  input: { userId: string; userEmail?: string | null; orgId: unknown; now?: Date },
): Promise<ServiceResult<RadarToday>> {
  const { orgId } = input;
  if (typeof orgId !== "string" || !isUuid(orgId)) return failure("not_found", "Not found");
  try {
    if (!(await getOrgRole(input.userId, orgId, db))) return failure("not_found", "Not found");
    const today = todayInMexicoCity(input.now ?? new Date());
    const empty: RadarToday = { today, time_zone: RADAR_TIME_ZONE, items: [], truncated: false };

    const { data: memberships, error } = await db
      .from("matter_memberships")
      .select("matter_id")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .limit(1000);
    if (error) return internalFailure(error);
    const matterIds = [...new Set(((memberships ?? []) as unknown as { matter_id: string }[]).map((row) => row.matter_id))];
    if (matterIds.length === 0) return ok(empty);

    const matters = await selectInBatches<MatterRow>("radar matters", matterIds, (batch) =>
      db.from("matters").select("id, project_id, workspace_id, name, is_retainer, visibility").in("id", batch),
    );
    const retainers = matters.filter((row) => row.is_retainer === true && row.visibility === "private");
    const workspaces = await selectInBatches<{ id: string; organization_id: string }>(
      "radar workspaces",
      [...new Set(retainers.map((row) => row.workspace_id))],
      (batch) => db.from("workspaces").select("id, organization_id").in("id", batch),
    );
    const inOrg = new Set(workspaces.filter((row) => row.organization_id === orgId).map((row) => row.id));
    const candidates = retainers
      .filter((row) => inOrg.has(row.workspace_id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const chosen = candidates.slice(0, MAX_TODAY_MATTERS);

    const perMatter = await mapWithConcurrency(chosen, 3, async (matter): Promise<ServiceResult<RadarTodayItem[]>> => {
      const access = await authorizeMatterMember(db, {
        userId: input.userId,
        userEmail: input.userEmail,
        projectId: matter.project_id,
        matterId: matter.id,
      });
      // A matter the caller can no longer open is simply not theirs to see.
      if (!access.ok) return access.kind === "not_found" || access.kind === "forbidden" ? ok([]) : access;
      if (!access.data.isRetainer) return ok([]);
      const items = await loadRadarItems(db, access.data, today);
      if (!items.ok) return items;
      return ok(
        items.data
          .filter((item) => isOpen(item) && item.bucket !== "later")
          .map((item) => ({ ...item, project_id: matter.project_id, matter_id: matter.id, matter_name: matter.name })),
      );
    });
    const items: RadarTodayItem[] = [];
    for (const result of perMatter) {
      if (!result.ok) return result;
      items.push(...result.data);
    }
    items.sort((a, b) => {
      if ((a.due_on === null) !== (b.due_on === null)) return a.due_on === null ? 1 : -1;
      return (a.due_on ?? "").localeCompare(b.due_on ?? "") || a.key.localeCompare(b.key);
    });
    return ok({ ...empty, items, truncated: candidates.length > chosen.length });
  } catch (error) {
    return internalFailure(error);
  }
}
