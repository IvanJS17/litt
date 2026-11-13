import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    role: null as string | null,
    recordAudit: vi.fn(async () => undefined),
}));

vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    getOrgRole: vi.fn(async () => mocks.role),
}));
vi.mock("../../../lib/audit", () => ({ recordAudit: mocks.recordAudit }));

import { getOrgFirmProfile, saveOrgFirmProfileBody } from "../orgs.firmProfile";

function fakeDb(options: { stored?: unknown; exists?: boolean; error?: unknown } = {}) {
    const updates: unknown[] = [];
    const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        update: (patch: unknown) => {
            updates.push(patch);
            return q;
        },
        maybeSingle: async () => ({ data: { firm_profile: options.stored ?? null }, error: options.error ?? null }),
        then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: options.exists === false ? [] : [{ id: "o" }], error: options.error ?? null }).then(resolve),
    };
    return { db: { from: () => q } as never, updates };
}

beforeEach(() => {
    mocks.role = null;
    mocks.recordAudit.mockClear();
});

const params = (body: unknown) => ({ actorId: "u", actorEmail: "u@firm.example", orgId: "o", body });

describe("getOrgFirmProfile", () => {
    it("shows a member the profile, read only", async () => {
        mocks.role = "member";
        expect(await getOrgFirmProfile(fakeDb({ stored: { size: "1" } }).db, { userId: "u", orgId: "o" })).toEqual({
            ok: true,
            settings: { profile: { size: "1" }, can_manage: false },
        });
    });

    it("lets an admin know they can change it, and shows null while there is none", async () => {
        mocks.role = "admin";
        expect(await getOrgFirmProfile(fakeDb().db, { userId: "u", orgId: "o" })).toEqual({
            ok: true,
            settings: { profile: null, can_manage: true },
        });
    });

    it("does not show the firm to a person who is not in it", async () => {
        expect(await getOrgFirmProfile(fakeDb({ stored: { size: "1" } }).db, { userId: "u", orgId: "o" })).toEqual({ ok: false, kind: "not_found" });
    });
});

describe("saveOrgFirmProfileBody", () => {
    it("lets an admin write, and audits which fields changed, not what they say", async () => {
        mocks.role = "admin";
        const { db, updates } = fakeDb({ stored: { size: "1" } });
        const secret = "Mi cliente Juan Pérez";
        expect(await saveOrgFirmProfileBody(db, params({ profile: { size: "1", description: secret } }))).toMatchObject({
            ok: true,
            settings: { profile: { size: "1", description: secret }, can_manage: true },
        });
        expect(updates).toMatchObject([{ firm_profile: { size: "1", description: secret } }]);
        expect(mocks.recordAudit).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ action: "org.profile.updated", orgId: "o", detail: { org_id: "o", changed_fields: ["description"] } }),
        );
        expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toContain(secret);
    });

    it("clears the profile with null", async () => {
        mocks.role = "owner";
        const { db, updates } = fakeDb({ stored: { size: "1" } });
        expect(await saveOrgFirmProfileBody(db, params({ profile: null }))).toMatchObject({ ok: true, settings: { profile: null } });
        expect(updates).toMatchObject([{ firm_profile: null }]);
    });

    it("refuses a member and a stranger, and writes nothing", async () => {
        mocks.role = "member";
        const member = fakeDb();
        expect(await saveOrgFirmProfileBody(member.db, params({ profile: { size: "1" } }))).toEqual({ ok: false, kind: "forbidden" });
        expect(member.updates).toEqual([]);
        mocks.role = null;
        expect(await saveOrgFirmProfileBody(fakeDb().db, params({ profile: { size: "1" } }))).toEqual({ ok: false, kind: "not_found" });
        expect(mocks.recordAudit).not.toHaveBeenCalled();
    });

    it("refuses an invalid body, a missing firm and a database failure", async () => {
        mocks.role = "admin";
        const bad = fakeDb();
        expect(await saveOrgFirmProfileBody(bad.db, params({ profile: { size: "9" } }))).toMatchObject({ ok: false, kind: "validation" });
        expect(await saveOrgFirmProfileBody(bad.db, params({ size: "1" }))).toMatchObject({ ok: false, kind: "validation" });
        expect(await saveOrgFirmProfileBody(bad.db, params(null))).toMatchObject({ ok: false, kind: "validation" });
        expect(bad.updates).toEqual([]);
        expect(await saveOrgFirmProfileBody(fakeDb({ exists: false }).db, params({ profile: { size: "1" } }))).toEqual({ ok: false, kind: "not_found" });
        expect(await saveOrgFirmProfileBody(fakeDb({ error: new Error("x") }).db, params({ profile: { size: "1" } }))).toMatchObject({ ok: false, kind: "db_error" });
        expect(mocks.recordAudit).not.toHaveBeenCalled();
    });
});
