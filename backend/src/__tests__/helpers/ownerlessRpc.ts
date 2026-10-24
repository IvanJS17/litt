// The database's "no Owner left" functions (project_is_ownerless,
// workflow_is_ownerless, org_item_is_ownerless, ownerless_org_item_ids) and
// LiTT's private-matter list filter, for tests whose Supabase stand-in is a
// map of tables.
//
// An organization's private item is ownerless when its creator is not a
// current member of that organization and no member holds an `owner`
// override on it. That is when the organization's owners take it over; the
// backend asks the database, so a fake has to answer the same way.

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | undefined>;

const KINDS = {
    project: {
        table: "projects",
        overrides: "project_org_access_overrides",
        key: "project_id",
    },
    workflow: {
        table: "workflows",
        overrides: "workflow_org_access_overrides",
        key: "workflow_id",
    },
} as const;

/**
 * LiTT C2: whether `projectId` is bound to a private matter that `userId` is
 * not an active member of (public.project_private_matter_denied).
 */
export function privateMatterDenied(
    tables: Tables,
    projectId: unknown,
    userId: unknown,
): boolean {
    const matter = (tables.matters ?? []).find(
        (row) => row.project_id === projectId && row.visibility === "private",
    );
    if (!matter) return false;
    const workspace = (tables.workspaces ?? []).find(
        (row) => row.id === matter.workspace_id,
    );
    const member = (tables.matter_memberships ?? []).some(
        (row) =>
            row.matter_id === matter.id &&
            row.user_id === userId &&
            row.status !== "inactive" &&
            row.status !== "revoked",
    );
    const inOrg = (tables.org_members ?? []).some(
        (row) =>
            row.org_id === workspace?.organization_id && row.user_id === userId,
    );
    return !(member && inOrg);
}

function isOwnerless(
    tables: Tables,
    kind: keyof typeof KINDS,
    item: Row,
): boolean {
    if (!item.org_id) return false;
    // LiTT C2: a matter's project is never ownerless (20261023_13).
    if (
        kind === "project" &&
        (tables.matters ?? []).some((row) => row.project_id === item.id)
    )
        return false;
    const creatorIsMember = (tables.org_members ?? []).some(
        (member) =>
            member.org_id === item.org_id && member.user_id === item.user_id,
    );
    const hasOwnerOverride = (tables[KINDS[kind].overrides] ?? []).some(
        (override) =>
            override[KINDS[kind].key] === item.id && override.role === "owner",
    );
    return !creatorIsMember && !hasOwnerOverride;
}

/**
 * The answer to one of the ownerless RPCs, or to LiTT's
 * private_matter_denied_project_ids, or `undefined` for any other function so
 * the caller's own `rpc` stub can handle it.
 */
export function ownerlessRpcResult(
    tables: Tables,
    name: string,
    args: Record<string, unknown> | undefined,
): { data: unknown; error: null } | undefined {
    if (name === "private_matter_denied_project_ids") {
        const ids = (args?.p_project_ids as unknown[]) ?? [];
        return {
            data: [...new Set(ids)].filter((id) =>
                privateMatterDenied(tables, id, args?.p_user_id),
            ),
            error: null,
        };
    }
    if (name === "org_item_is_ownerless") {
        const kind = args?.p_kind as keyof typeof KINDS;
        const item = KINDS[kind]
            ? (tables[KINDS[kind].table] ?? []).find(
                  (row) => row.id === args?.p_item_id,
              )
            : undefined;
        return {
            data: !!item && isOwnerless(tables, kind, item),
            error: null,
        };
    }
    if (name === "ownerless_org_item_ids") {
        const orgIds = (args?.p_org_ids as unknown[]) ?? [];
        const data = (Object.keys(KINDS) as (keyof typeof KINDS)[]).flatMap(
            (kind) =>
                (tables[KINDS[kind].table] ?? [])
                    .filter(
                        (item) =>
                            orgIds.includes(item.org_id) &&
                            item.visibility !== "organization" &&
                            isOwnerless(tables, kind, item),
                    )
                    .map((item) => ({ kind, item_id: item.id })),
        );
        return { data, error: null };
    }
    return undefined;
}
