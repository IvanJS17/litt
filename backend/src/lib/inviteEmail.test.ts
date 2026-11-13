import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import { recordCreatingOrgOfSignup, sendSignupInvite } from "./inviteEmail";

const now = () => new Date().toISOString();
const LONG_AGO = "2020-01-01T00:00:00.000Z";

function world(invite: ReturnType<typeof vi.fn>) {
    const tables: Record<string, Row[]> = {
        user_profiles: [
            { user_id: "new", created_by_org_id: null },
            { user_id: "old", created_by_org_id: null },
            { user_id: "other", created_by_org_id: "first-firm" },
        ],
        org_invitations: [],
    };
    const mem = memoryDb(tables);
    (mem.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite } };
    return { tables, db: mem.db };
}
const profile = (t: Record<string, Row[]>, id: string) => t.user_profiles.find((p) => p.user_id === id)!;

afterEach(() => vi.restoreAllMocks());

describe("recording the firm whose invitation created an account", () => {
    it("records it for the account the invitation email just made", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "new@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBe("firm");
    });

    it("leaves an account that existed before the invitation without one", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "old", created_at: LONG_AGO } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "old@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("records nothing when the address already has an account", async () => {
        const invite = vi.fn().mockResolvedValue({ data: {}, error: { code: "email_exists", message: "registered" } });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "old@firm.example", { createdByOrgId: "firm" })).toBe(false);
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("never replaces the first firm", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "other", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        await sendSignupInvite(db, "other@firm.example", { createdByOrgId: "second-firm" });
        expect(profile(tables, "other").created_by_org_id).toBe("first-firm");
    });

    it("records nothing for the platform's own invitations", async () => {
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        expect(await sendSignupInvite(db, "new@firm.example")).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBeNull();
    });

    it("still reports the email as sent when recording fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const invite = vi.fn().mockResolvedValue({ data: { user: { id: "new", created_at: now() } }, error: null });
        const { db, tables } = world(invite);
        const mem = memoryDb(tables);
        (mem.db as { auth?: unknown }).auth = { admin: { inviteUserByEmail: invite } };
        mem.failNext("user_profiles", "update", { message: "boom" });
        expect(await sendSignupInvite(mem.db, "new@firm.example", { createdByOrgId: "firm" })).toBe(true);
        expect(profile(tables, "new").created_by_org_id).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });
});

describe("closed-beta sign-up on a firm's invitation", () => {
    const invitation = (orgId: string, created: string, extra: Row = {}): Row => ({
        email: "new@firm.example",
        org_id: orgId,
        status: "pending",
        expires_at: "2999-01-01T00:00:00.000Z",
        created_at: created,
        ...extra,
    });

    it("records the oldest live invitation's firm for the new account", async () => {
        const { db, tables } = world(vi.fn());
        tables.org_invitations.push(invitation("younger", "2026-02-01"), invitation("elder", "2026-01-01"));
        await recordCreatingOrgOfSignup(db, { id: "new", created_at: now() }, " New@Firm.example ");
        expect(profile(tables, "new").created_by_org_id).toBe("elder");
    });

    it("ignores expired invitations and accounts that were not just made", async () => {
        const { db, tables } = world(vi.fn());
        tables.org_invitations.push(invitation("late", "2026-01-01", { expires_at: "2000-01-01T00:00:00.000Z" }));
        await recordCreatingOrgOfSignup(db, { id: "new", created_at: now() }, "new@firm.example");
        expect(profile(tables, "new").created_by_org_id).toBeNull();
        tables.org_invitations.push(invitation("firm", "2026-01-01"));
        await recordCreatingOrgOfSignup(db, { id: "old", created_at: LONG_AGO }, "new@firm.example");
        await recordCreatingOrgOfSignup(db, null, "new@firm.example");
        expect(profile(tables, "old").created_by_org_id).toBeNull();
    });

    it("never throws", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const mem = memoryDb({ org_invitations: [] });
        mem.failNext("org_invitations", "select", { message: "boom" });
        await expect(recordCreatingOrgOfSignup(mem.db, { id: "new", created_at: now() }, "a@b.c")).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalled();
    });
});
