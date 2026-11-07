/**
 * Matter owners named by the firm (owner decisions of 2026-11-07, TD-038).
 *
 * An organization owner or admin may list the matters left without an
 * active owner and name any current member of the firm, themselves included,
 * as the owner of one of them. Both are single database calls
 * (assign_matter_owner, list_matters_without_owner) that recheck the
 * caller's organization role under the organization lock. A matter with an
 * active owner is refused (`matter_has_owner`): naming never displaces an
 * owner, so it cannot take a private matter from its team. Naming someone
 * else grants the caller nothing, and the list never carries a matter's
 * title: administrators do not see the names of matters they are not on.
 */

import type { Db } from "../../lib/supabase";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";

const NOT_FOUND = failure("not_found", "Not found.", "not_found");
const ADMIN_REQUIRED = failure(
  "forbidden",
  "Only an organization owner or admin can do that.",
);
const TARGET_INVALID = failure(
  "validation",
  "Choose a current member of the organization.",
  "matter_owner_target_invalid",
);
const HAS_OWNER = failure(
  "conflict",
  "This matter already has an owner.",
  "matter_has_owner",
);

export type MatterWithoutOwner = {
  matter_id: string;
  cm_number: string | null;
  visibility: string;
  created_at: string;
  last_owner: {
    user_id: string;
    display_name: string | null;
    email: string | null;
  } | null;
  member_count: number;
};

export type MatterOwnerAssignment = {
  matter_id: string;
  owner_user_id: string;
};

/** The SQLSTATEs both functions raise for the caller, mapped once. */
function sqlFailure(error: { code?: string | null }): ServiceResult<never> {
  switch (error.code) {
    case "P0002":
      return NOT_FOUND;
    case "42501":
      return ADMIN_REQUIRED;
    case "22023":
      return TARGET_INVALID;
    case "55000":
      return HAS_OWNER;
    default:
      return internalFailure(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRow(value: unknown): MatterWithoutOwner {
  if (
    !isRecord(value) ||
    typeof value.matter_id !== "string" ||
    typeof value.visibility !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.member_count !== "number"
  )
    throw new Error("matter without owner row is malformed");
  const lastOwner = nullableString(value.last_owner_user_id);
  return {
    matter_id: value.matter_id,
    cm_number: nullableString(value.cm_number),
    visibility: value.visibility,
    created_at: value.created_at,
    last_owner: lastOwner
      ? {
          user_id: lastOwner,
          display_name: nullableString(value.last_owner_display_name),
          email: nullableString(value.last_owner_email),
        }
      : null,
    member_count: value.member_count,
  };
}

/** The firm's matters without an active owner, newest first, untitled. */
export async function listMattersWithoutOwner(
  db: Db,
  input: { actorId: string; orgId: string },
): Promise<ServiceResult<MatterWithoutOwner[]>> {
  const { data, error } = await db.rpc("list_matters_without_owner", {
    p_actor_id: input.actorId,
    p_org_id: input.orgId,
  });
  if (error) return sqlFailure(error);
  if (!Array.isArray(data))
    return internalFailure(new Error("matter without owner list is malformed"));
  try {
    return ok(data.map(parseRow));
  } catch (parseError) {
    return internalFailure(parseError);
  }
}

/** Name `targetUserId` the owner of a matter of the caller's firm that has none. */
export async function assignMatterOwner(
  db: Db,
  input: { actorId: string; matterId: string; targetUserId: string },
): Promise<ServiceResult<MatterOwnerAssignment>> {
  const { data, error } = await db.rpc("assign_matter_owner", {
    p_actor_id: input.actorId,
    p_matter_id: input.matterId,
    p_target_user_id: input.targetUserId,
  });
  if (error) return sqlFailure(error);
  if (
    !isRecord(data) ||
    data.matter_id !== input.matterId ||
    data.owner_user_id !== input.targetUserId
  )
    return internalFailure(new Error("matter owner assignment is malformed"));
  return ok({
    matter_id: input.matterId,
    owner_user_id: input.targetUserId,
  });
}
