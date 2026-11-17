/**
 * Who may work inside a matter, for the surfaces that live in a matter's
 * project (its requests today).
 *
 * Reading and writing both need the project gate (`checkProjectAccess`, which
 * already closes a private matter to everybody outside its team and ends access
 * the moment the organization membership ends) and an ACTIVE explicit matter
 * membership. The organization role never opens matter work: an organization
 * owner or admin without a membership gets the same 404 as a stranger. Nothing
 * here caches a decision: every request reads the current rows, so removing a
 * member or an organization member takes effect on their next request. Writing
 * needs the `matter_owner` or `editor` membership role.
 */

import { checkProjectAccess, getOrgRole } from "../../lib/access";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";

export type MatterMemberRole = "matter_owner" | "editor" | "viewer" | "technical_operator";

const MEMBER_ROLES: ReadonlySet<string> = new Set([
  "matter_owner",
  "editor",
  "viewer",
  "technical_operator",
]);

export type MatterAccess = {
  matterId: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  /** Marked as a retainer AND private: a public matter never takes requests. */
  isRetainer: boolean;
  isPrivate: boolean;
  role: MatterMemberRole;
  /** `matter_owner` or `editor`: may change what lives in the matter. */
  canWrite: boolean;
};

const NOT_FOUND = "Not found";

export const MATTER_WRITE_REQUIRED_CODE = "matter_write_required";

export async function authorizeMatterMember(
  db: Db,
  input: {
    userId: string;
    userEmail?: string | null;
    projectId: unknown;
    matterId: unknown;
    /** Fails with 403 unless the member's role may write. */
    write?: boolean;
  },
): Promise<ServiceResult<MatterAccess>> {
  const { projectId, matterId } = input;
  if (
    typeof projectId !== "string" ||
    typeof matterId !== "string" ||
    !isUuid(projectId) ||
    !isUuid(matterId)
  )
    return failure("not_found", NOT_FOUND);
  try {
    const project = await checkProjectAccess(projectId, input.userId, input.userEmail, db);
    if (!project.ok) return failure("not_found", NOT_FOUND);
    const { data: matter, error } = await db
      .from("matters")
      .select("id, project_id, workspace_id, is_retainer, visibility")
      .eq("id", matterId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!matter) return failure("not_found", NOT_FOUND);
    const row = matter as unknown as {
      workspace_id: string;
      is_retainer: boolean;
      visibility: string;
    };
    const { data: workspace, error: workspaceError } = await db
      .from("workspaces")
      .select("organization_id")
      .eq("id", row.workspace_id)
      .maybeSingle();
    if (workspaceError) return internalFailure(workspaceError);
    const organizationId = (workspace as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return failure("not_found", NOT_FOUND);
    if (!(await getOrgRole(input.userId, organizationId, db)))
      return failure("not_found", NOT_FOUND);

    const { data: membership, error: membershipError } = await db
      .from("matter_memberships")
      .select("role, status")
      .eq("matter_id", matterId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (membershipError) return internalFailure(membershipError);
    const member = membership as { role?: string; status?: string } | null;
    if (!member || member.status !== "active" || !member.role || !MEMBER_ROLES.has(member.role))
      return failure("not_found", NOT_FOUND);
    const role = member.role as MatterMemberRole;
    const canWrite = role === "matter_owner" || role === "editor";
    if (input.write && !canWrite)
      return failure(
        "forbidden",
        "Only a matter owner or editor can change this matter's requests.",
        MATTER_WRITE_REQUIRED_CODE,
      );
    return ok({
      matterId,
      projectId,
      organizationId,
      workspaceId: row.workspace_id,
      isRetainer: row.is_retainer === true && row.visibility === "private",
      isPrivate: row.visibility === "private",
      role,
      canWrite,
    });
  } catch (error) {
    return internalFailure(error);
  }
}
