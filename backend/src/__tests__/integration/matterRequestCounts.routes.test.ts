import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The firm's request counts over HTTP, against an in-memory database: only an
// owner or admin of the firm reads them, every read is audited before the
// numbers are handed over, and nothing but numbers and opaque labels leaves.
// The function itself (grouping, medians, privileges) is covered against
// PostgreSQL in matterRequests.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
    rpcCalls: [] as Array<Record<string, unknown>>,
}));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => h.state!.db),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.caller.id;
                res.locals.userEmail = `${h.caller.id}@test.local`;
                next();
            }),
    };
});
vi.mock("../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/audit")>()),
    insertAuditEvent: vi.fn(async () => undefined),
    recordAudit: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { insertAuditEvent } from "../../lib/audit";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const PERSONAL_ORG = id(102);
const WORKSPACE = id(110);
const MATTER = id(130);
const OWNER = id(1);
const ADMIN = id(2);
const EDITOR = id(3);
const MEMBER = id(4);
const STRANGER = id(5);
const OUTSIDER = id(6);
const SECRET_TITLE = "Demanda confidencial contra Patito SA";
const SECRET_MATTER = "Iguala secreta Patito SA de CV";

const PAYLOAD = {
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    totals: { received: 2, open: 1, closed: 1, cancelled: 0, open_at_end: 1, closed_in_period: 1, cancelled_in_period: 0, rounds: 3, median_days: 4 },
    by_matter: [{ ordinal: 1, total: 2, open: 1, closed: 1, cancelled: 0, rounds: 3, median_days: 4 }],
    by_type: [],
    by_complexity: [],
    by_level: [],
    by_status: [],
};

const as = (userId: string) => {
    h.caller.id = userId;
};
const get = (query = "", org = ORG) => request(app).get(`/orgs/${org}/requests/counts${query}`);

beforeEach(() => {
    h.rpcCalls = [];
    vi.mocked(insertAuditEvent).mockReset();
    vi.mocked(insertAuditEvent).mockResolvedValue(undefined);
    h.state = memoryDb(
        {
            organizations: [
                { id: ORG, kind: "team" },
                { id: OTHER_ORG, kind: "team" },
                { id: PERSONAL_ORG, kind: "personal" },
            ],
            org_members: [
                { org_id: ORG, user_id: OWNER, role: "owner" },
                { org_id: ORG, user_id: ADMIN, role: "admin" },
                { org_id: ORG, user_id: EDITOR, role: "member" },
                { org_id: ORG, user_id: MEMBER, role: "member" },
                { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
                { org_id: PERSONAL_ORG, user_id: OUTSIDER, role: "owner" },
            ],
            workspaces: [{ id: WORKSPACE, organization_id: ORG }],
            matters: [{ id: MATTER, workspace_id: WORKSPACE, name: SECRET_MATTER, is_retainer: true, visibility: "private" }],
            matter_memberships: [
                { matter_id: MATTER, user_id: EDITOR, role: "editor", status: "active" },
                { matter_id: MATTER, user_id: MEMBER, role: "viewer", status: "active" },
            ],
            matter_requests: [{ id: id(300), matter_id: MATTER, title: SECRET_TITLE, status: "closed" }],
        },
        {
            matter_request_counts: (args) => {
                h.rpcCalls.push(args);
                return PAYLOAD;
            },
        },
    );
});

describe("GET /orgs/:orgId/requests/counts", () => {
    it.each([
        ["owner", OWNER],
        ["admin", ADMIN],
    ])("answers the %s of the firm, counts only", async (_label, user) => {
        as(user);
        const response = await get("?period=month&date=2026-11-16");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ...PAYLOAD, period: "month" });
        const text = JSON.stringify(response.body);
        expect(text).not.toContain(SECRET_TITLE);
        expect(text).not.toContain(SECRET_MATTER);
        expect(text).not.toContain("title");
        expect(h.rpcCalls).toEqual([
            { p_org_id: ORG, p_user_id: user, p_start: "2026-11-01", p_end: "2026-11-30" },
        ]);
    });

    it("needs no membership of any matter: the admin is on no matter's team", async () => {
        as(ADMIN);
        expect(tablesHaveNoMembership(ADMIN)).toBe(true);
        expect((await get()).status).toBe(200);
    });

    it("refuses a matter editor and a viewer who are plain members of the firm (403)", async () => {
        for (const user of [EDITOR, MEMBER]) {
            as(user);
            const response = await get();
            expect(response.status).toBe(403);
            expect(response.body.code).toBe("org_admin_required");
        }
        expect(h.rpcCalls).toEqual([]);
        expect(insertAuditEvent).not.toHaveBeenCalled();
    });

    it("answers 404 to somebody outside the firm, to another firm's owner and for a personal or unknown organization", async () => {
        as(STRANGER);
        expect((await get()).status).toBe(404);
        as(OUTSIDER);
        expect((await get()).status).toBe(404);
        expect((await get("", PERSONAL_ORG)).status).toBe(404);
        expect((await get("", id(999))).status).toBe(404);
        expect((await request(app).get("/orgs/not-a-uuid/requests/counts")).status).toBe(404);
        // The other firm's owner reads their own firm's counts, never this one's.
        as(OUTSIDER);
        expect((await get("", OTHER_ORG)).status).toBe(200);
        expect(h.rpcCalls.map((call) => call.p_org_id)).toEqual([OTHER_ORG]);
    });

    it("audits every read before answering, with the period and no content", async () => {
        as(OWNER);
        await get("?period=quarter&date=2026-11-16");
        await get();
        const calls = vi.mocked(insertAuditEvent).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][1]).toMatchObject({
            userId: OWNER,
            orgId: ORG,
            action: "request_counts.read",
            surface: "organization",
            detail: { org_id: ORG, period: "quarter", period_start: "2026-10-01", period_end: "2026-12-31" },
        });
        expect(JSON.stringify(calls[0][1])).not.toContain(SECRET_TITLE);
    });

    it("hands nothing over when the audit event cannot be written", async () => {
        as(OWNER);
        vi.mocked(insertAuditEvent).mockRejectedValueOnce(new Error("audit down"));
        const response = await get();
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toContain("by_matter");
    });

    it("refuses a bad period or date (400) without reading or auditing", async () => {
        as(OWNER);
        for (const query of ["?period=week", "?date=2026-02-30", "?date=yesterday", "?date=2026-11-01&date=2026-11-02"]) {
            const response = await get(query);
            expect([query, response.status]).toEqual([query, 400]);
            expect(response.body.code).toBe("invalid_request");
        }
        expect(h.rpcCalls).toEqual([]);
        expect(insertAuditEvent).not.toHaveBeenCalled();
    });

    it("answers 500 when the function fails or answers something else", async () => {
        as(OWNER);
        h.state!.failNext("matter_request_counts", "rpc", { message: "boom" });
        expect((await get()).status).toBe(500);
        h.state = memoryDb(
            { organizations: [{ id: ORG, kind: "team" }], org_members: [{ org_id: ORG, user_id: OWNER, role: "owner" }] },
            { matter_request_counts: () => "nope" },
        );
        expect((await get()).status).toBe(500);
        expect(insertAuditEvent).not.toHaveBeenCalled();
    });
});

function tablesHaveNoMembership(user: string): boolean {
    return !h.state!.tables.matter_memberships.some((row) => row.user_id === user);
}
