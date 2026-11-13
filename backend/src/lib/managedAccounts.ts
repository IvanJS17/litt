// Accounts managed by the firm (docs/managed-accounts.md).
//
// A firm may switch on organizations.managed_accounts. From then on, the
// accounts that firm invited and that were CREATED by that invitation
// (user_profiles.created_by_org_id) have no personal space: no personal
// content, no personal provider keys. An account that already existed before
// an invitation has created_by_org_id NULL and keeps its personal space.
//
// The rule is evaluated live, never copied: an account is managed while its
// creating firm has the setting on AND the person is still a member of that
// firm. Leaving the firm, or the firm turning the setting off, ends it on the
// next request.
//
// Where it is enforced:
//   - requireAuth reads it once per request and binds it to the request
//     (res.locals.personalWorkspaceDisabled and the request scope below);
//   - the access seams in lib/access.ts and the standalone-org resolver ask
//     the request scope, so every route that opens or files personal content
//     answers 403 personal_workspace_disabled from one place;
//   - the credential store asks the database (managedByCreatingOrg), because
//     keys are also read by queued jobs that have no request.
// Data export and account erasure run as jobs, outside any request scope, so
// a managed person still gets their data out and can still erase the account.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./supabase";

export const PERSONAL_WORKSPACE_DISABLED = "personal_workspace_disabled";
export const PERSONAL_WORKSPACE_DISABLED_DETAIL =
    "Your firm manages this account: it has no personal workspace.";

/** Thrown at any seam that would open or file personal content. */
export class PersonalWorkspaceDisabledError extends Error {
    readonly code = PERSONAL_WORKSPACE_DISABLED;
    constructor() {
        super(PERSONAL_WORKSPACE_DISABLED_DETAIL);
        this.name = "PersonalWorkspaceDisabledError";
    }
}

export function findPersonalWorkspaceDisabled(
    error: unknown,
): PersonalWorkspaceDisabledError | null {
    const seen = new Set<unknown>();
    let current: unknown = error;
    for (let depth = 0; depth < 8 && current && !seen.has(current); depth++) {
        if (current instanceof PersonalWorkspaceDisabledError) return current;
        seen.add(current);
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}

// The current legal version belongs to the user module, which lib/ may not
// import; that module registers it when it loads (user.profile.storage.ts).
let currentLegalVersion: string | null = null;
export function registerLegalVersion(version: string): void {
    currentLegalVersion = version;
}

/** Postgres "undefined column", directly or as PostgREST reports it. */
function isMissingColumn(error: { code?: string | null }): boolean {
    return error.code === "42703" || error.code === "PGRST204";
}

/**
 * Whether the account is managed by the organization that created it:
 * `createdByOrgId` has the setting on and `userId` is still a member of it.
 * A read failure throws; answering "no" would open the personal space.
 */
export async function managedByCreatingOrg(
    db: Db,
    userId: string,
    createdByOrgId: string | null | undefined,
    termsAcceptedVersion?: string | null,
): Promise<boolean> {
    if (!createdByOrgId) return false;
    // The mode applies only once the person has accepted the current legal
    // version (it is what tells them about it). Until then `termsRequired`
    // keeps them out of the app. `undefined`: a database without the terms
    // column, which never asks for acceptance.
    if (
        currentLegalVersion !== null &&
        termsAcceptedVersion !== undefined &&
        termsAcceptedVersion !== currentLegalVersion
    )
        return false;
    const [organization, membership] = await Promise.all([
        db
            .from("organizations")
            .select("managed_accounts")
            .eq("id", createdByOrgId)
            .is("deleted_at", null)
            .maybeSingle(),
        db
            .from("org_members")
            .select("org_id")
            .eq("org_id", createdByOrgId)
            .eq("user_id", userId)
            .maybeSingle(),
    ]);
    if (organization.error) {
        if (isMissingColumn(organization.error)) return false;
        throw new Error("Failed to read the managed accounts setting");
    }
    if (membership.error)
        throw new Error("Failed to read the organization membership");
    return (
        (organization.data as { managed_accounts?: boolean } | null)
            ?.managed_accounts === true && !!membership.data
    );
}

/** `managedByCreatingOrg` starting from the account alone. */
export async function isManagedAccount(
    db: Db,
    userId: string,
): Promise<boolean> {
    const { data, error } = await db
        .from("user_profiles")
        .select("created_by_org_id, terms_accepted_version")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isMissingColumn(error)) return false;
        throw new Error("Failed to read the account's creating organization");
    }
    return managedByCreatingOrg(
        db,
        userId,
        (data as { created_by_org_id?: string | null } | null)
            ?.created_by_org_id,
        (data as { terms_accepted_version?: string | null } | null)
            ?.terms_accepted_version,
    );
}

export type ManagedAccountState = {
    managed: boolean;
    /** The creating firm, while the account is managed. */
    firm: { id: string; name: string } | null;
    /** Managed, and the person has not yet closed the "now managed" notice. */
    noticePending: boolean;
};

/** What the profile tells the app about managed accounts. */
export async function managedAccountState(
    db: Db,
    userId: string,
): Promise<ManagedAccountState> {
    const none = { managed: false, firm: null, noticePending: false };
    const { data, error } = await db
        .from("user_profiles")
        .select("created_by_org_id, managed_notice_seen_org_id, terms_accepted_version")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isMissingColumn(error)) return none;
        throw new Error("Failed to read the account's creating organization");
    }
    const row = data as {
        created_by_org_id?: string | null;
        managed_notice_seen_org_id?: string | null;
        terms_accepted_version?: string | null;
    } | null;
    const orgId = row?.created_by_org_id;
    if (!orgId || !(await managedByCreatingOrg(db, userId, orgId, row?.terms_accepted_version)))
        return none;
    const { data: org, error: orgError } = await db
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
    if (orgError) throw new Error("Failed to read the organization's name");
    return {
        managed: true,
        firm: { id: orgId, name: (org as { name?: string } | null)?.name ?? "" },
        noticePending: row?.managed_notice_seen_org_id !== orgId,
    };
}

/** The person closed the "now managed" notice for their creating firm. */
export async function dismissManagedNotice(db: Db, userId: string): Promise<void> {
    const { data, error } = await db
        .from("user_profiles")
        .select("created_by_org_id")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw new Error("Failed to read the account's creating organization");
    const orgId = (data as { created_by_org_id?: string | null } | null)?.created_by_org_id;
    if (!orgId) return;
    const { error: updateError } = await db
        .from("user_profiles")
        .update({ managed_notice_seen_org_id: orgId })
        .eq("user_id", userId);
    if (updateError) throw new Error("Failed to save the notice");
}

// ---------------------------------------------------------------------------
// The request scope
// ---------------------------------------------------------------------------

type RequestPrincipal = { userId: string; personalWorkspaceDisabled: boolean };
const principals = new AsyncLocalStorage<RequestPrincipal>();

/** Bind the caller to the rest of this request. Called by requireAuth. */
export function bindRequestPrincipal(principal: RequestPrincipal): void {
    principals.enterWith(principal);
}

/** Run `fn` as `principal`'s request (tests, and callers that fan out work). */
export function withRequestPrincipal<T>(
    principal: RequestPrincipal,
    fn: () => T,
): T {
    return principals.run(principal, fn);
}

/**
 * Whether `userId`, acting in this request, has no personal workspace.
 * False outside a request (jobs, exports) and for any other person.
 */
export function personalWorkspaceDisabledFor(
    userId: string | null | undefined,
): boolean {
    const principal = principals.getStore();
    return (
        !!principal &&
        principal.personalWorkspaceDisabled &&
        (!userId || principal.userId === userId)
    );
}

/** Throw when `userId` may not open or file personal content in this request. */
export function assertPersonalWorkspaceAllowed(
    userId: string | null | undefined,
): void {
    if (personalWorkspaceDisabledFor(userId))
        throw new PersonalWorkspaceDisabledError();
}

/**
 * For the routes that are the person's rights over their own data (download
 * it, delete it in bulk): the personal workspace stays reachable for the rest
 * of the request, so a managed account can still download what became
 * inaccessible (docs/managed-accounts.md). Mount right after requireAuth.
 */
export function ownDataRightsScope(
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
): void {
    const userId = res.locals.userId;
    if (typeof userId === "string")
        principals.enterWith({ userId, personalWorkspaceDisabled: false });
    next();
}
