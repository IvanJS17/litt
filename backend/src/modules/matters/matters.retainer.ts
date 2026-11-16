/**
 * The retainer mark of a matter. A retainer matter ("iguala") is the one kind
 * of matter that takes requests; any other matter is untouched by that
 * feature. Only an active `matter_owner` changes the mark, and a matter that
 * already holds requests cannot lose it (its requests would have no home).
 */

import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { authorizeMatterMember } from "./matters.access";

export const RETAINER_HAS_REQUESTS_CODE = "retainer_has_requests";
export const MATTER_NOT_PRIVATE_CODE = "matter_not_private";

export type MatterRetainerState = { matter_id: string; is_retainer: boolean };

export async function setMatterRetainer(
  db: Db,
  input: {
    userId: string;
    userEmail?: string | null;
    projectId: unknown;
    matterId: unknown;
    isRetainer: unknown;
  },
): Promise<ServiceResult<MatterRetainerState>> {
  if (typeof input.isRetainer !== "boolean")
    return failure("validation", "is_retainer must be true or false.");
  const access = await authorizeMatterMember(db, input);
  if (!access.ok) return access;
  if (access.data.role !== "matter_owner")
    return failure("forbidden", "Only the matter owner can mark a retainer.", "matter_owner_required");
  if (input.isRetainer && !access.data.isPrivate)
    return failure("conflict", "Only a private matter can be a retainer.", MATTER_NOT_PRIVATE_CODE);
  try {
    if (!input.isRetainer) {
      const { data: held, error: heldError } = await db
        .from("matter_requests")
        .select("id")
        .eq("matter_id", access.data.matterId)
        .limit(1);
      if (heldError) return internalFailure(heldError);
      if ((held ?? []).length > 0)
        return failure(
          "conflict",
          "The matter already has requests.",
          RETAINER_HAS_REQUESTS_CODE,
        );
    }
    const { error } = await db
      .from("matters")
      .update({ is_retainer: input.isRetainer })
      .eq("id", access.data.matterId)
      .eq("project_id", access.data.projectId);
    if (error) return internalFailure(error);
    await recordAudit(db, {
      userId: input.userId,
      userEmail: input.userEmail ?? null,
      orgId: access.data.organizationId,
      action: input.isRetainer ? "matter.retainer_marked" : "matter.retainer_unmarked",
      surface: "matter",
      projectId: access.data.projectId,
      detail: { matter_id: access.data.matterId },
    });
    return ok({ matter_id: access.data.matterId, is_retainer: input.isRetainer });
  } catch (error) {
    return internalFailure(error);
  }
}
