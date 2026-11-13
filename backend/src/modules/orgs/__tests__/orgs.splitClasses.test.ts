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

import { getOrgSplitClasses, saveOrgSplitClassesList } from "../orgs.splitClasses";

const one = { name: "Poder", description: "Un poder notarial." };

function fakeDb(options: { stored?: unknown; exists?: boolean; error?: unknown } = {}) {
    const updates: unknown[] = [];
    const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        update: (patch: unknown) => {
            updates.push(patch);
            return q;
        },
        maybeSingle: async () => ({ data: { split_classes: options.stored ?? null }, error: options.error ?? null }),
        then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: options.exists === false ? [] : [{ id: "o" }], error: options.error ?? null }).then(resolve),
    };
    return { db: { from: () => q } as never, updates };
}

beforeEach(() => {
    mocks.role = null;
    mocks.recordAudit.mockClear();
});

describe("getOrgSplitClasses", () => {
    it("shows every member the list, and whether they may change it", async () => {
        mocks.role = "member";
        expect(await getOrgSplitClasses(fakeDb({ stored: [one] }).db, { userId: "u", orgId: "o" })).toMatchObject({
            ok: true,
            settings: { custom: true, classes: [one], can_manage: false },
        });
        mocks.role = "admin";
        expect(await getOrgSplitClasses(fakeDb().db, { userId: "u", orgId: "o" })).toMatchObject({
            ok: true,
            settings: { custom: false, can_manage: true },
        });
    });

    it("hides the firm from a stranger and reports a database failure", async () => {
        expect(await getOrgSplitClasses(fakeDb().db, { userId: "u", orgId: "o" })).toEqual({ ok: false, kind: "not_found" });
        mocks.role = "owner";
        expect(await getOrgSplitClasses(fakeDb({ error: new Error("x") }).db, { userId: "u", orgId: "o" })).toMatchObject({ ok: false, kind: "db_error" });
    });
});

describe("saveOrgSplitClassesList", () => {
    const params = (body: unknown) => ({ actorId: "u", actorEmail: "u@firm.example", orgId: "o", body });

    it("lets an admin save a list and audits the count, not the list", async () => {
        mocks.role = "admin";
        const { db, updates } = fakeDb();
        expect(await saveOrgSplitClassesList(db, params({ classes: [one] }))).toMatchObject({ ok: true, settings: { custom: true, can_manage: true } });
        expect(updates).toMatchObject([{ split_classes: [one] }]);
        expect(mocks.recordAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "org.split_classes.updated", detail: { org_id: "o", class_count: 1 } }));
    });

    it("restores the built-in list with null and audits it", async () => {
        mocks.role = "owner";
        const { db } = fakeDb();
        expect(await saveOrgSplitClassesList(db, params({ classes: null }))).toMatchObject({ ok: true, settings: { custom: false } });
        expect(mocks.recordAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "org.split_classes.reset" }));
    });

    it("refuses a plain member, a stranger, an invalid list and a missing firm; nothing is written", async () => {
        mocks.role = "member";
        const member = fakeDb();
        expect(await saveOrgSplitClassesList(member.db, params({ classes: [one] }))).toEqual({ ok: false, kind: "forbidden" });
        expect(member.updates).toEqual([]);
        mocks.role = null;
        expect(await saveOrgSplitClassesList(fakeDb().db, params({ classes: [one] }))).toEqual({ ok: false, kind: "not_found" });
        mocks.role = "admin";
        const invalid = fakeDb();
        expect(await saveOrgSplitClassesList(invalid.db, params({ classes: [] }))).toMatchObject({ ok: false, kind: "validation" });
        expect(invalid.updates).toEqual([]);
        expect(await saveOrgSplitClassesList(fakeDb({ exists: false }).db, params({ classes: [one] }))).toEqual({ ok: false, kind: "not_found" });
        expect(await saveOrgSplitClassesList(fakeDb({ error: new Error("x") }).db, params({ classes: [one] }))).toMatchObject({ ok: false, kind: "db_error" });
        expect(mocks.recordAudit).not.toHaveBeenCalled();
    });
});
