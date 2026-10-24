/**
 * Matter settings: the Drive folder publication target of one matter.
 *
 * Authorization reuses the reviewed tenancy port in the same order as the
 * evidence module: load the matter (project-scoped, with its workspace's
 * organization), evaluate the matter gate, then recheck the granted scope
 * right before answering. Reading a public matter is enough to see the
 * folder; changing it is reserved to an active explicit `matter_owner`
 * membership — the organization role never edits matter settings, and the
 * matter's Drive folder is where approved artifacts are published, so it is a
 * configuration surface, not content access.
 *
 * LiTT never managed matter members from this surface (no team roster here),
 * so there is deliberately no membership write. Adding a member would also
 * have to create the corresponding project override so the member can open a
 * private matter's project; that belongs to whoever introduces the roster.
 */

import type { Db } from "../../lib/supabase";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import type { AuthorizationScope } from "../../lib/recovery/authorization/evaluateAccess";
import {
  evaluateInitialAccess,
  recheckFreshAccessViaPort,
} from "../../lib/recovery/authorization/tenancyReadPort";
import { createSupabaseTenancyReadPort } from "../../lib/recovery/authorization/supabaseTenancyReadPort";
import { createMatterDriveFolderPersistence } from "../../lib/recovery/persistence/matterDriveFolderPersistence";
import {
  buildMatterMembership,
  MATTER_ROLES,
  ORGANIZATION_ROLES,
} from "../../lib/recovery/tenancy/tenancyModel";
import {
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DRIVE_FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

const MATTER_OR_ORG_ROLES: ReadonlySet<string> = new Set([
  ...MATTER_ROLES,
  ...ORGANIZATION_ROLES,
]);

const NOT_FOUND = {
  ok: false,
  kind: "not_found",
  code: "not_found",
  detail: "Not found.",
} as const;
const AUTHORIZATION_REVOKED = {
  ok: false,
  kind: "forbidden",
  code: "authorization_revoked",
  detail: "Authorization revoked.",
} as const;
const MATTER_OWNER_REQUIRED = {
  ok: false,
  kind: "forbidden",
  code: "matter_owner_required",
  detail: "Only the matter owner can change the Drive folder.",
} as const;

type MatterRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  drive_folder_id: string | null;
  organization_id: string;
};

export type MatterDriveFolderSettings = {
  matter_id: string;
  project_id: string;
  drive_folder_id: string | null;
  role: string;
  can_edit: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRelation(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0]))
    return value[0];
  throw new Error("matter Drive folder relation is malformed");
}

function parseMatterRow(value: unknown): MatterRow | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("matter Drive folder row is malformed");
  const workspace = parseRelation(value.workspaces);
  if (
    typeof value.id !== "string" ||
    !UUID_RE.test(value.id) ||
    typeof value.project_id !== "string" ||
    !UUID_RE.test(value.project_id) ||
    typeof value.workspace_id !== "string" ||
    !UUID_RE.test(value.workspace_id) ||
    typeof workspace.organization_id !== "string" ||
    !UUID_RE.test(workspace.organization_id) ||
    (value.drive_folder_id !== null &&
      (typeof value.drive_folder_id !== "string" ||
        !DRIVE_FOLDER_ID_PATTERN.test(value.drive_folder_id)))
  )
    throw new Error("matter Drive folder row is invalid");
  return {
    id: value.id,
    project_id: value.project_id,
    workspace_id: value.workspace_id,
    drive_folder_id: value.drive_folder_id,
    organization_id: workspace.organization_id,
  };
}

async function loadMatter(
  db: Db,
  projectId: string,
  matterId: string,
): Promise<MatterRow | null> {
  let result: unknown;
  try {
    result = await db
      .from("matters")
      .select(
        "id, project_id, workspace_id, drive_folder_id, workspaces!inner(organization_id)",
      )
      .eq("id", matterId)
      .eq("project_id", projectId)
      .maybeSingle();
  } catch {
    throw new Error("matter Drive folder query failed");
  }
  if (
    !isRecord(result) ||
    !Object.prototype.hasOwnProperty.call(result, "data") ||
    !Object.prototype.hasOwnProperty.call(result, "error") ||
    result.error != null
  )
    throw new Error("matter Drive folder query failed");
  const matter = parseMatterRow(result.data);
  if (matter && (matter.id !== matterId || matter.project_id !== projectId))
    return null;
  return matter;
}

type AuthorizedMatter = {
  db: Db;
  matter: MatterRow;
  tenancy: ReturnType<typeof createSupabaseTenancyReadPort>;
  identity: AuthenticatedIdentity;
  scope: AuthorizationScope;
  settingsRole: string;
};

type AuthorizeOutcome =
  | { kind: "allow"; value: AuthorizedMatter }
  | { kind: "not_found" }
  | { kind: "denied"; code: "mfa_required" };

async function authorize(
  db: Db,
  input: {
    project_id: string;
    matter_id: string;
    identity: AuthenticatedIdentity;
    requires_mfa: boolean;
  },
): Promise<AuthorizeOutcome> {
  const matter = await loadMatter(db, input.project_id, input.matter_id);
  if (!matter) return { kind: "not_found" };
  const tenancy = createSupabaseTenancyReadPort(db);
  const access = await evaluateInitialAccess(tenancy, {
    identity: input.identity,
    organization_id: matter.organization_id,
    matter_id: input.matter_id,
    requiresMfa: input.requires_mfa,
  });
  if (access.kind === "authorization_dependency_failed")
    throw new Error("matter Drive folder authorization failed");
  if (access.decision.outcome === "not_found") return { kind: "not_found" };
  if (access.decision.outcome === "denied") {
    return access.decision.code === "mfa_required"
      ? { kind: "denied", code: "mfa_required" }
      : { kind: "not_found" };
  }
  const scope = access.decision.scope;
  if (scope.workspace_id !== matter.workspace_id)
    return { kind: "not_found" };
  if (
    scope.user_id !== input.identity.user_id ||
    scope.organization_id !== matter.organization_id ||
    scope.matter_id !== input.matter_id ||
    typeof scope.membership_role !== "string" ||
    !MATTER_OR_ORG_ROLES.has(scope.membership_role) ||
    !Number.isSafeInteger(scope.authorization_epoch) ||
    scope.authorization_epoch < 0
  )
    throw new Error("matter Drive folder authorization scope is invalid");

  // Public-matter read scopes use the organization role; settings edits
  // still require a separate, active, explicit matter-owner membership.
  const rawMembership = await tenancy.getMatterMembership({
    user_id: input.identity.user_id,
    matter_id: input.matter_id,
  });
  const membership =
    rawMembership === null ? null : buildMatterMembership(rawMembership);
  if (
    membership &&
    (membership.user_id !== input.identity.user_id ||
      membership.matter_id !== input.matter_id)
  )
    return { kind: "not_found" };
  const activeMembership = membership?.status === "active" ? membership : null;
  if (scope.requires_explicit_matter_membership && !activeMembership)
    return { kind: "not_found" };
  const settingsRole = activeMembership?.role ?? scope.membership_role;
  return {
    kind: "allow",
    value: {
      db,
      matter,
      tenancy,
      identity: input.identity,
      scope,
      settingsRole,
    },
  };
}

function dto(
  matter: MatterRow,
  role: string,
  canEdit: boolean,
): MatterDriveFolderSettings {
  return {
    matter_id: matter.id,
    project_id: matter.project_id,
    drive_folder_id: matter.drive_folder_id,
    role,
    can_edit: canEdit,
  };
}

/** Read the matter's Drive folder and the caller's settings role. */
export async function readMatterDriveFolder(
  db: Db,
  input: {
    project_id: string;
    matter_id: string;
    identity: AuthenticatedIdentity;
  },
): Promise<ServiceResult<MatterDriveFolderSettings>> {
  try {
    const access = await authorize(db, {
      project_id: input.project_id,
      matter_id: input.matter_id,
      identity: input.identity,
      requires_mfa: false,
    });
    if (access.kind !== "allow") return NOT_FOUND;
    const { value } = access;
    const current = await loadMatter(db, input.project_id, input.matter_id);
    if (
      !current ||
      current.workspace_id !== value.matter.workspace_id ||
      current.organization_id !== value.matter.organization_id
    )
      return NOT_FOUND;
    const fresh = await recheckFreshAccessViaPort(value.tenancy, {
      scope: value.scope,
      identity: value.identity,
      requiresMfa: false,
    });
    if (fresh.kind === "authorization_dependency_failed")
      throw new Error("matter Drive folder fresh authorization failed");
    if (!fresh.result.fresh) return NOT_FOUND;
    const role = value.settingsRole;
    return ok(dto(current, role, role === "matter_owner"));
  } catch (error) {
    return internalFailure(error);
  }
}

/** Point the matter's approved-artifact publications at another Drive folder. */
export async function updateMatterDriveFolder(
  db: Db,
  input: {
    project_id: string;
    matter_id: string;
    identity: AuthenticatedIdentity;
    drive_folder_id: string | null;
  },
): Promise<ServiceResult<MatterDriveFolderSettings>> {
  try {
    const access = await authorize(db, {
      project_id: input.project_id,
      matter_id: input.matter_id,
      identity: input.identity,
      requires_mfa: true,
    });
    if (access.kind === "not_found") return NOT_FOUND;
    if (access.kind === "denied")
      return {
        ok: false,
        kind: "forbidden",
        code: access.code,
        detail: "MFA required.",
      };
    const { value } = access;
    if (value.settingsRole !== "matter_owner") return MATTER_OWNER_REQUIRED;

    const fresh = await recheckFreshAccessViaPort(value.tenancy, {
      scope: value.scope,
      identity: value.identity,
      requiresMfa: true,
    });
    if (fresh.kind === "authorization_dependency_failed")
      throw new Error("matter Drive folder fresh authorization failed");
    if (!fresh.result.fresh) return AUTHORIZATION_REVOKED;

    const persistence = createMatterDriveFolderPersistence({
      client: value.db,
      context: {
        actor_user_id: value.identity.user_id,
        organization_id: value.scope.organization_id,
        authorization_epoch: value.scope.authorization_epoch,
      },
    });
    const saved = await persistence.update({
      matter_id: input.matter_id,
      project_id: input.project_id,
      drive_folder_id: input.drive_folder_id,
    });
    const updated: MatterRow = {
      ...value.matter,
      drive_folder_id: saved.drive_folder_id,
    };
    return ok(dto(updated, value.settingsRole, true));
  } catch (error) {
    return internalFailure(error);
  }
}
