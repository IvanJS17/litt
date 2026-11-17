/**
 * Who a request can be assigned to: an active matter owner or editor who is
 * still a member of the organization. A viewer or technical operator reads the
 * matter and is never assigned work. The suggested cost level comes from the
 * firm's own roles: a training stage first (pasante is an apprentice, junior is
 * a junior), then the organization role (owner is a partner, admin a senior);
 * otherwise the lawyer chooses.
 */

import type { MatterRequestAssignee, MatterRequestLevel } from "@mike/contracts";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

export function suggestedLevel(
  stage: string | null,
  orgRole: string | null,
): MatterRequestLevel | null {
  if (stage === "pasante") return "apprentice";
  if (stage === "junior") return "junior";
  if (orgRole === "owner") return "partner";
  if (orgRole === "admin") return "senior";
  return null;
}

export async function listAssignees(
  db: Db,
  input: { matterId: string; organizationId: string },
): Promise<ServiceResult<MatterRequestAssignee[]>> {
  const { data: memberships, error } = await db
    .from("matter_memberships")
    .select("user_id, role")
    .eq("matter_id", input.matterId)
    .eq("status", "active")
    .in("role", ["matter_owner", "editor"]);
  if (error) return internalFailure(error);
  const members = (memberships ?? []) as unknown as {
    user_id: string;
    role: "matter_owner" | "editor";
  }[];
  if (members.length === 0) return ok([]);
  const ids = members.map((member) => member.user_id);

  const [orgMembers, stages] = await Promise.all([
    db.from("org_members").select("user_id, role").eq("org_id", input.organizationId).in("user_id", ids),
    db
      .from("training_stages")
      .select("trainee_user_id, stage")
      .eq("org_id", input.organizationId)
      .in("trainee_user_id", ids),
  ]);
  if (orgMembers.error) return internalFailure(orgMembers.error);
  if (stages.error) return internalFailure(stages.error);
  const orgRoleOf = new Map(
    ((orgMembers.data ?? []) as unknown as { user_id: string; role: string }[]).map((row) => [
      row.user_id,
      row.role,
    ]),
  );
  // The most junior stage wins when a person has several (pasante before junior).
  const stageOf = new Map<string, string>();
  for (const row of (stages.data ?? []) as unknown as { trainee_user_id: string; stage: string }[]) {
    if (stageOf.get(row.trainee_user_id) !== "pasante") stageOf.set(row.trainee_user_id, row.stage);
  }
  const profiles = await loadCreatorProfiles(
    db,
    ids.map((user_id) => ({ user_id })),
  );
  return ok(
    members
      .filter((member) => orgRoleOf.has(member.user_id))
      .map((member) => {
        const profile = profiles.get(member.user_id);
        return {
          user_id: member.user_id,
          display_name: profile?.display_name ?? null,
          email: profile?.email ?? null,
          role: member.role,
          suggested_level: suggestedLevel(
            stageOf.get(member.user_id) ?? null,
            orgRoleOf.get(member.user_id) ?? null,
          ),
        };
      })
      .sort((a, b) => (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? "")),
  );
}
