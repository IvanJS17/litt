import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { listMyInvitations } from "../../lib/orgs";
import { canSignUp } from "../../lib/platformAccess";
import { resolvePlaybookRoles } from "../../modules/playbooks/playbooks.access";

// Stack-level test for the database function that runs when an account changes
// its e-mail address (public.handle_user_email_updated): what is addressed to
// an address follows the account or ends. Only a real database with the real
// auth.users shows it. Gated like dbJobs.supabase.test.ts: run a local stack,
// then export
//   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY
// The identity service has no call that clears an address and accepts none
// with surrounding spaces, so those branches are not exercised here. Every test
// creates its own accounts, firm and playbooks with random addresses and
// removes them afterwards.
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const maybeDescribe = url && serviceKey ? describe : describe.skip;

const DAY = 86_400_000;
const inOneDay = () => new Date(Date.now() + DAY).toISOString();
const oneDayAgo = () => new Date(Date.now() - DAY).toISOString();

maybeDescribe("address change: invitations and playbook shares", () => {
    let db: SupabaseClient;
    const userIds: string[] = [];
    const orgIds: string[] = [];
    const addresses: string[] = [];
    const betaBefore = process.env.PLATFORM_ADMIN_EMAILS;

    const address = (label: string) => {
        const email = `${label}-${randomUUID()}@example.test`;
        addresses.push(email);
        return email;
    };
    const must = <T extends { error: { message: string } | null }>(result: T) => {
        if (result.error) throw new Error(result.error.message);
        return result;
    };
    const makeUser = async (email: string) => {
        const { data, error } = await db.auth.admin.createUser({
            email,
            password: "StackTest1!",
            email_confirm: true,
        });
        if (error || !data.user) throw error ?? new Error("no user");
        userIds.push(data.user.id);
        return data.user.id;
    };
    const changeAddress = async (id: string, email: string | null) => {
        const { error } = await db.auth.admin.updateUserById(id, {
            email: email ?? undefined,
            email_confirm: true,
        });
        if (error) throw new Error(error.message);
    };
    const makeOrg = async (owner: string) => {
        const { data } = must(
            await db
                .from("organizations")
                .insert({ name: `org-${randomUUID()}`, created_by: owner })
                .select("id")
                .single(),
        );
        orgIds.push(data!.id as string);
        return data!.id as string;
    };
    const makePlaybook = async (owner: string) => {
        const { data } = must(
            await db
                .from("playbooks")
                .insert({ user_id: owner, name: `pb-${randomUUID()}`, content_json: {} })
                .select("id")
                .single(),
        );
        return data!.id as string;
    };
    const share = async (playbook: string, email: string, role: string) =>
        must(await db.from("playbook_shares").insert({ playbook_id: playbook, shared_with_email: email, role }));
    const sharesOf = async (playbook: string) => {
        const { data } = must(
            await db.from("playbook_shares").select("shared_with_email, role").eq("playbook_id", playbook),
        );
        return data ?? [];
    };
    const orgInvite = async (org: string, email: string, extra: Record<string, unknown> = {}) =>
        must(await db.from("org_invitations").insert({ org_id: org, email, expires_at: inOneDay(), ...extra }));
    const orgInviteStatuses = async (email: string) => {
        const { data } = must(await db.from("org_invitations").select("status").eq("email", email));
        return (data ?? []).map((row) => row.status as string).sort();
    };
    const platformInvite = async (email: string, extra: Record<string, unknown> = {}) =>
        must(await db.from("platform_invitations").insert({ email, expires_at: inOneDay(), ...extra }));
    const platformInviteStatuses = async (email: string) => {
        const { data } = must(await db.from("platform_invitations").select("status").eq("email", email));
        return (data ?? []).map((row) => row.status as string).sort();
    };

    beforeAll(() => {
        db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
        // Closed-beta mode, so canSignUp answers from the invitations alone.
        process.env.PLATFORM_ADMIN_EMAILS = `admin-${randomUUID()}@example.test`;
    });

    afterEach(async () => {
        await db.from("platform_invitations").delete().in("email", addresses);
        await db.from("org_invitations").delete().in("email", addresses);
        await db.from("playbook_shares").delete().in("shared_with_email", addresses);
    });

    afterAll(async () => {
        if (betaBefore === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
        else process.env.PLATFORM_ADMIN_EMAILS = betaBefore;
        await db.from("playbooks").delete().in("user_id", userIds);
        await db.from("organizations").delete().in("id", orgIds);
        for (const id of userIds) await db.auth.admin.deleteUser(id);
    });

    it("withdraws pending firm and platform invitations addressed to the old address, so a later holder of it is offered nothing", async () => {
        const oldAddress = address("old");
        const newAddress = address("new");
        const person = await makeUser(oldAddress);
        const org = await makeOrg(person);
        const otherOrg = await makeOrg(person);
        await orgInvite(org, oldAddress);
        await orgInvite(otherOrg, oldAddress, { status: "accepted", accepted_at: new Date().toISOString() });
        await platformInvite(oldAddress);
        const expired = address("expired");
        const expiredHolder = await makeUser(expired);
        await orgInvite(org, expired, { expires_at: oneDayAgo() });

        expect(await canSignUp(db, oldAddress)).toBe(true);
        await changeAddress(person, newAddress);
        await changeAddress(expiredHolder, address("elsewhere"));

        expect(await orgInviteStatuses(oldAddress)).toEqual(["accepted", "cancelled"]);
        expect(await platformInviteStatuses(oldAddress)).toEqual([]);
        // One past its date goes too: sending it again would give it a new date.
        expect(await orgInviteStatuses(expired)).toEqual(["cancelled"]);
        // Nothing is left for whoever registers the old address next.
        expect(await canSignUp(db, oldAddress)).toBe(false);
        const nextHolder = await listMyInvitations(db, { userEmail: oldAddress });
        expect(nextHolder).toEqual({ ok: true, invitations: [] });
    });

    it("moves a playbook share to the new address, merging at the stronger role and without breaking the unique key", async () => {
        const oldAddress = address("old");
        const newAddress = address("new");
        const person = await makeUser(oldAddress);
        const creator = await makeUser(address("creator"));
        const moved = await makePlaybook(creator);
        const oldStronger = await makePlaybook(creator);
        const newStronger = await makePlaybook(creator);
        const editorOverViewer = await makePlaybook(creator);
        await share(moved, oldAddress, "editor");
        await share(editorOverViewer, oldAddress, "editor");
        await share(editorOverViewer, newAddress, "viewer");
        await share(oldStronger, oldAddress, "owner");
        await share(oldStronger, newAddress, "viewer");
        await share(newStronger, oldAddress, "viewer");
        await share(newStronger, newAddress, "owner");

        await changeAddress(person, newAddress);

        expect(await sharesOf(moved)).toEqual([{ shared_with_email: newAddress, role: "editor" }]);
        expect(await sharesOf(oldStronger)).toEqual([{ shared_with_email: newAddress, role: "owner" }]);
        expect(await sharesOf(newStronger)).toEqual([{ shared_with_email: newAddress, role: "owner" }]);
        expect(await sharesOf(editorOverViewer)).toEqual([{ shared_with_email: newAddress, role: "editor" }]);

        // Through the application's own lookup: the person keeps the share, a
        // second account confirmed on the old address gets nothing.
        const rows = [moved, oldStronger, newStronger].map((id) => ({
            id,
            user_id: creator,
            org_id: null,
            visibility: "private",
        }));
        const mine = await resolvePlaybookRoles(db, rows, person, newAddress, new Map());
        expect(mine.get(moved)).toBe("editor");
        expect(mine.get(oldStronger)).toBe("owner");
        const reassigned = await makeUser(oldAddress);
        const theirs = await resolvePlaybookRoles(db, rows, reassigned, oldAddress, new Map());
        expect([...theirs.keys()]).toEqual([]);
    });

    it("withdraws the invitations pending for an address an existing account moves onto", async () => {
        const target = address("target");
        const person = await makeUser(address("person"));
        const org = await makeOrg(person);
        const otherOrg = await makeOrg(person);
        await orgInvite(org, target);
        await orgInvite(otherOrg, target, { status: "declined", declined_at: new Date().toISOString() });
        await platformInvite(target);

        expect(await canSignUp(db, target)).toBe(true);
        await changeAddress(person, target);

        expect(await orgInviteStatuses(target)).toEqual(["cancelled", "declined"]);
        expect(await platformInviteStatuses(target)).toEqual([]);
        expect(await canSignUp(db, target)).toBe(false);
        const mine = await listMyInvitations(db, { userEmail: target, userId: person });
        expect(mine).toEqual({ ok: true, invitations: [] });
    });

    // The identity service may put the address in lower case before the row is
    // written, in which case the function does not run at all; either way a
    // change of case alone must leave everything where it is.
    it("leaves everything alone when the address changes only in case", async () => {
        const base = address("same");
        const person = await makeUser(base);
        const org = await makeOrg(person);
        const creator = await makeUser(address("creator"));
        const playbook = await makePlaybook(creator);
        await orgInvite(org, base);
        await platformInvite(base);
        await share(playbook, base, "editor");

        await changeAddress(person, base.toUpperCase());

        expect(await orgInviteStatuses(base)).toEqual(["pending"]);
        expect(await platformInviteStatuses(base)).toEqual(["pending"]);
        expect(await sharesOf(playbook)).toEqual([{ shared_with_email: base, role: "editor" }]);
    });
});
