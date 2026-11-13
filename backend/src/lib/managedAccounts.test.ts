import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import {
    assertPersonalWorkspaceAllowed,
    findPersonalWorkspaceDisabled,
    isManagedAccount,
    managedByCreatingOrg,
    PersonalWorkspaceDisabledError,
    personalWorkspaceDisabledFor,
    withRequestPrincipal,
} from "./managedAccounts";
import { registerLegalVersion, managedAccountState, dismissManagedNotice, ownDataRightsScope } from "./managedAccounts";
import { checkProjectAccess, ensureChatAccess, ensureDocAccess, ensureReviewAccess, resolveContentOrgId, resolveStandaloneOrgId } from "./access";
import { getEffectiveApiKeyStatus, getEffectiveApiKeys, getUserApiKeyStatus, getUserApiKeys } from "./providerCredentials/store";
import { saveApiKey, setApiKeyEnabled } from "../modules/user/user.apiKeys";
import { resolveWorkspaceFilter } from "./workspace";

function world(over: Partial<Record<string, Row[]>> = {}) {
    const rpcs = { private_matter_denied_project_ids: () => [] };
    const tables: Record<string, Row[]> = {
        organizations: [
            { id: "firm", managed_accounts: true, deleted_at: null },
            { id: "open-firm", managed_accounts: false, deleted_at: null },
        ],
        org_members: [
            { org_id: "firm", user_id: "invited", role: "member" },
            { org_id: "firm", user_id: "owner", role: "owner" },
            { org_id: "open-firm", user_id: "open", role: "member" },
            { org_id: "firm", user_id: "veteran", role: "member" },
        ],
        user_profiles: [
            { user_id: "invited", created_by_org_id: "firm" },
            { user_id: "open", created_by_org_id: "open-firm" },
            // Had an account before the invitation: no creating firm.
            { user_id: "veteran", created_by_org_id: null },
            { user_id: "owner", created_by_org_id: null },
            { user_id: "gone", created_by_org_id: "firm" },
        ],
        ...over,
    };
    return { tables, db: memoryDb(tables, rpcs).db };
}

describe("who is a managed account", () => {
    it("is the person the firm's invitation created, while the firm has it on", async () => {
        const { db } = world();
        expect(await isManagedAccount(db, "invited")).toBe(true);
    });

    it("is not an account that existed before the invitation", async () => {
        const { db } = world();
        expect(await isManagedAccount(db, "veteran")).toBe(false);
        expect(await isManagedAccount(db, "owner")).toBe(false);
        expect(await isManagedAccount(db, "nobody-at-all")).toBe(false);
    });

    it("is not the case while the firm has the setting off", async () => {
        const { db } = world();
        expect(await isManagedAccount(db, "open")).toBe(false);
    });

    it("ends when the person leaves the firm, and returns with the membership", async () => {
        const { db, tables } = world();
        tables.org_members = tables.org_members.filter((m) => m.user_id !== "invited");
        expect(await isManagedAccount(db, "invited")).toBe(false);
        expect(await isManagedAccount(db, "gone")).toBe(false);
        tables.org_members.push({ org_id: "firm", user_id: "invited", role: "member" });
        expect(await isManagedAccount(db, "invited")).toBe(true);
    });

    it("follows the setting at once, in both directions", async () => {
        const { db, tables } = world();
        tables.organizations[0].managed_accounts = false;
        expect(await isManagedAccount(db, "invited")).toBe(false);
        tables.organizations[0].managed_accounts = true;
        expect(await isManagedAccount(db, "invited")).toBe(true);
    });

    it("ends with a deleted firm", async () => {
        const { db, tables } = world();
        tables.organizations[0].deleted_at = "2026-11-01T00:00:00Z";
        expect(await isManagedAccount(db, "invited")).toBe(false);
    });

    it("answers no for an account without a creating firm without asking about firms", async () => {
        const { db } = world({ organizations: undefined });
        expect(await managedByCreatingOrg(db, "veteran", null)).toBe(false);
    });

    it("fails closed on a read it cannot make", async () => {
        const tables: Record<string, Row[]> = { organizations: [], org_members: [], user_profiles: [] };
        const mem = memoryDb(tables);
        mem.failNext("organizations", "select", { message: "boom", code: "XX000" });
        await expect(managedByCreatingOrg(mem.db, "u", "firm")).rejects.toThrow(/managed accounts setting/);
        mem.failNext("org_members", "select", { message: "boom", code: "XX000" });
        await expect(managedByCreatingOrg(mem.db, "u", "firm")).rejects.toThrow(/membership/);
        mem.failNext("user_profiles", "select", { message: "boom", code: "XX000" });
        await expect(isManagedAccount(mem.db, "u")).rejects.toThrow(/creating organization/);
    });

    it("reads a database without the migration as not managed", async () => {
        const mem = memoryDb({ user_profiles: [], organizations: [], org_members: [] });
        mem.failNext("user_profiles", "select", { code: "42703", message: "no column" });
        expect(await isManagedAccount(mem.db, "u")).toBe(false);
        mem.failNext("organizations", "select", { code: "PGRST204", message: "no column" });
        expect(await managedByCreatingOrg(mem.db, "u", "firm")).toBe(false);
    });
});

describe("the request scope", () => {
    const managed = { userId: "invited", personalWorkspaceDisabled: true };

    it("closes the personal workspace for that person inside their request only", () => {
        withRequestPrincipal(managed, () => {
            expect(personalWorkspaceDisabledFor("invited")).toBe(true);
            expect(personalWorkspaceDisabledFor(undefined)).toBe(true);
            expect(personalWorkspaceDisabledFor("someone-else")).toBe(false);
            expect(() => assertPersonalWorkspaceAllowed("invited")).toThrow(PersonalWorkspaceDisabledError);
            expect(() => assertPersonalWorkspaceAllowed("someone-else")).not.toThrow();
        });
        // Jobs and exports have no request: the person's own data stays reachable.
        expect(personalWorkspaceDisabledFor("invited")).toBe(false);
        expect(() => assertPersonalWorkspaceAllowed("invited")).not.toThrow();
    });

    it("leaves everyone else's request alone", () => {
        withRequestPrincipal({ userId: "veteran", personalWorkspaceDisabled: false }, () => {
            expect(personalWorkspaceDisabledFor("veteran")).toBe(false);
            expect(personalWorkspaceDisabledFor(undefined)).toBe(false);
        });
    });

    it("finds the refusal through a cause chain, and nothing else", () => {
        const refusal = new PersonalWorkspaceDisabledError();
        expect(refusal.code).toBe("personal_workspace_disabled");
        expect(findPersonalWorkspaceDisabled(new Error("wrapped", { cause: refusal }))).toBe(refusal);
        expect(findPersonalWorkspaceDisabled(new Error("plain"))).toBeNull();
        expect(findPersonalWorkspaceDisabled(null)).toBeNull();
        const loop: { cause?: unknown } = {};
        loop.cause = loop;
        expect(findPersonalWorkspaceDisabled(loop)).toBeNull();
    });
});

describe("the seams where personal scope is chosen", () => {
    const managed = { userId: "invited", personalWorkspaceDisabled: true };

    it("refuses ?workspace=personal, and still resolves the firm's workspace", async () => {
        const { db } = world();
        await withRequestPrincipal(managed, async () => {
            await expect(resolveWorkspaceFilter(db, "invited", "personal")).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
        });
        // Anyone else keeps Personal.
        expect(await resolveWorkspaceFilter(db, "veteran", "personal")).toEqual({
            ok: true,
            workspace: "personal",
        });
    });

    it("refuses a conversation or review started in no organization", async () => {
        const { db } = world();
        await withRequestPrincipal(managed, async () => {
            await expect(
                resolveStandaloneOrgId(db, { userId: "invited", orgId: undefined }),
            ).rejects.toBeInstanceOf(PersonalWorkspaceDisabledError);
            await expect(resolveStandaloneOrgId(db, { userId: "invited", orgId: "" })).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
        });
        expect(await resolveStandaloneOrgId(db, { userId: "veteran", orgId: undefined })).toEqual({
            ok: true,
            orgId: null,
        });
    });

    it("refuses filing content under no project and no organization", async () => {
        const { db } = world({ projects: [{ id: "personal-project", org_id: null }, { id: "firm-project", org_id: "firm" }] });
        await withRequestPrincipal(managed, async () => {
            await expect(resolveContentOrgId(db, {})).rejects.toBeInstanceOf(PersonalWorkspaceDisabledError);
            await expect(resolveContentOrgId(db, { projectId: "personal-project" })).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
            // The firm's own content is still filed under the firm.
            expect(await resolveContentOrgId(db, { projectId: "firm-project" })).toEqual({
                ok: true,
                orgId: "firm",
            });
        });
        expect(await resolveContentOrgId(db, { projectId: "personal-project" })).toEqual({ ok: true, orgId: null });
    });
});

describe("the legal version comes first", () => {
    it("applies only after the person accepted the current version", async () => {
        registerLegalVersion("v2");
        try {
            const { db, tables } = world();
            const profile = tables.user_profiles.find((p) => p.user_id === "invited")!;
            profile.terms_accepted_version = "v1";
            expect(await isManagedAccount(db, "invited")).toBe(false);
            profile.terms_accepted_version = "v2";
            expect(await isManagedAccount(db, "invited")).toBe(true);
            profile.terms_accepted_version = null;
            expect(await isManagedAccount(db, "invited")).toBe(false);
        } finally {
            registerLegalVersion(null as unknown as string);
        }
    });
});

describe("the profile's managed state", () => {
    it("names the firm and keeps the notice until it is closed", async () => {
        const { db, tables } = world();
        tables.organizations[0].name = "Despacho Aurora";
        expect(await managedAccountState(db, "invited")).toEqual({
            managed: true,
            firm: { id: "firm", name: "Despacho Aurora" },
            noticePending: true,
        });
        await dismissManagedNotice(db, "invited");
        expect((await managedAccountState(db, "invited")).noticePending).toBe(false);
        // Turning it off returns the personal space, and the notice goes with it.
        tables.organizations[0].managed_accounts = false;
        expect(await managedAccountState(db, "invited")).toEqual({
            managed: false,
            firm: null,
            noticePending: false,
        });
        // Dismissing for an account with no creating firm does nothing.
        await dismissManagedNotice(db, "veteran");
        expect(tables.user_profiles.find((p) => p.user_id === "veteran")!.managed_notice_seen_org_id).toBeUndefined();
    });
});

describe("a person's rights over their own data", () => {
    it("keep the personal workspace reachable for that request", () => {
        withRequestPrincipal({ userId: "invited", personalWorkspaceDisabled: true }, () => {
            const res = { locals: { userId: "invited" } };
            let called = false;
            ownDataRightsScope({}, res, () => {
                called = true;
            });
            expect(called).toBe(true);
            expect(personalWorkspaceDisabledFor("invited")).toBe(false);
        });
    });
});

describe("opening personal content", () => {
    const managed = { userId: "invited", personalWorkspaceDisabled: true };

    it("is refused for a personal project, document, review and chat; the firm's stay open", async () => {
        const { db } = world({
            projects: [
                { id: "mine", user_id: "invited", org_id: null, visibility: null, archived_at: null },
                { id: "firm-proj", user_id: "invited", org_id: "firm", visibility: "private", archived_at: null },
            ],
        });
        const personalRow = { id: "x", user_id: "invited", project_id: null, org_id: null };
        await withRequestPrincipal(managed, async () => {
            await expect(checkProjectAccess("mine", "invited", "i@x.test", db)).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
            await expect(ensureDocAccess(personalRow, "invited", "i@x.test", db)).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
            await expect(ensureReviewAccess(personalRow, "invited", "i@x.test", db)).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
            await expect(ensureChatAccess(personalRow, "invited", "i@x.test", db)).rejects.toBeInstanceOf(
                PersonalWorkspaceDisabledError,
            );
            expect((await checkProjectAccess("firm-proj", "invited", "i@x.test", db)).ok).toBe(true);
            expect((await ensureDocAccess({ ...personalRow, org_id: "firm" }, "invited", "i@x.test", db)).ok).toBe(true);
        });
        // Outside the request scope (a job, an export) the person's own data opens.
        expect((await checkProjectAccess("mine", "invited", "i@x.test", db)).ok).toBe(true);
        expect((await ensureDocAccess(personalRow, "invited", "i@x.test", db)).ok).toBe(true);
    });
});

describe("provider keys", () => {
    it("a managed account's own keys are never read, even where the firm allows them", async () => {
        const { db, tables } = world({ user_api_keys: [{ user_id: "invited", provider: "openai", enabled: true }] });
        const reads: string[] = [];
        const spy = { ...db, from: (table: string) => (reads.push(table), db.from(table)) } as typeof db;
        await getUserApiKeys("invited", spy);
        await getUserApiKeyStatus("invited", spy);
        await getEffectiveApiKeys("invited", "firm", spy);
        await getEffectiveApiKeyStatus("invited", "firm", spy);
        expect(reads).not.toContain("user_api_keys");
        // The person who is not managed still reads theirs.
        reads.length = 0;
        await getUserApiKeyStatus("veteran", spy);
        expect(reads).toContain("user_api_keys");
        expect(tables.user_api_keys).toHaveLength(1);
    });

    it("saving or enabling one is refused, removing one is not", async () => {
        const { db } = world();
        await expect(
            saveApiKey(db, { userId: "invited", provider: "openai", apiKey: "sk-low-entropy" }),
        ).rejects.toBeInstanceOf(PersonalWorkspaceDisabledError);
        await expect(
            saveApiKey(db, { userId: "invited", provider: "brave", apiKey: "k", settings: undefined }),
        ).rejects.toBeInstanceOf(PersonalWorkspaceDisabledError);
        await expect(setApiKeyEnabled(db, "invited", "openai", true)).rejects.toBeInstanceOf(
            PersonalWorkspaceDisabledError,
        );
        expect((await saveApiKey(db, { userId: "invited", provider: "openai", apiKey: null })).ok).toBe(true);
    });
});
