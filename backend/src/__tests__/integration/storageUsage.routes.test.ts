import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// The two reads of a storage space's use, over HTTP:
//   GET /user/storage            the signed-in person's personal space
//   GET /orgs/:orgId/storage     a firm's space, owners and administrators only
// Both answer exactly { usedBytes, limitBytes } from the database function
// `storage_space_usage` (stood in for here); a usage that cannot be read is the
// generic internal error, never zeros.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let currentUser: { id: string; email: string } | null;
let rpcAnswer: { data: unknown; error: unknown };
const rpc = vi.hoisted(() => vi.fn());

function resetState() {
    currentUser = { id: "owner-1", email: "owner@firm.example" };
    rpcAnswer = {
        data: [{ used_bytes: "1234", limit_bytes: 5000 }],
        error: null,
    };
    tables = {
        organizations: [
            { id: "org-1", kind: "team" },
            { id: "org-2", kind: "team" },
            { id: "personal-org-1", kind: "personal" },
        ],
        org_members: [
            { org_id: "org-1", user_id: "owner-1", role: "owner" },
            { org_id: "org-1", user_id: "admin-1", role: "admin" },
            { org_id: "org-1", user_id: "member-1", role: "member" },
            { org_id: "org-2", user_id: "other-firm-owner", role: "owner" },
            { org_id: "personal-org-1", user_id: "owner-1", role: "owner" },
        ],
        org_invitations: [
            { org_id: "org-1", email: "invited@firm.example", status: "pending" },
        ],
    };
}
resetState();

// A just-enough chainable stand-in for the table reads the role check and the
// personal-organization check make: select / is / eq / maybeSingle.
function from(table: string) {
    const filters: [string, unknown][] = [];
    const builder: Record<string, unknown> = {
        select: () => builder,
        is: () => builder,
        eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
        },
        maybeSingle: () =>
            Promise.resolve({
                data:
                    (tables[table] ?? []).find((row) =>
                        filters.every(([column, value]) => row[column] === value),
                    ) ?? null,
                error: null,
            }),
    };
    return builder;
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => ({ from, rpc })),
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: {
            locals: Record<string, unknown>;
            status: (code: number) => { json: (body: unknown) => void };
        },
        next: () => void,
    ) => {
        if (!currentUser) {
            res.status(401).json({ detail: "Invalid or expired session" });
            return;
        }
        res.locals.userId = currentUser.id;
        res.locals.userEmail = currentUser.email;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;
const as = (id: string) => {
    currentUser = { id, email: `${id}@firm.example` };
};

beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    rpc.mockImplementation(() => Promise.resolve(rpcAnswer));
    vi.stubEnv("STORAGE_QUOTA_BYTES_PER_MEMBER", "5000");
    vi.stubEnv("STORAGE_QUOTA_PERSONAL_BYTES", "700");
});

const usageCalls = () => rpc.mock.calls.filter(([name]) => name === "storage_space_usage");

describe("GET /user/storage", () => {
    it("answers the signed-in person's two numbers from their personal space", async () => {
        as("member-1");
        const res = await request(app).get("/user/storage").set(...AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ usedBytes: 1234, limitBytes: 5000 });
        expect(usageCalls()).toEqual([
            [
                "storage_space_usage",
                {
                    p_org_id: null,
                    p_user_id: "member-1",
                    p_bytes_per_member: 5000,
                    p_personal_bytes: 700,
                },
            ],
        ]);
    });

    it("ignores any query or body field that names another person", async () => {
        as("member-1");
        const res = await request(app)
            .get("/user/storage?userId=owner-1&user_id=owner-1&orgId=org-1")
            .set(...AUTH)
            .send({ userId: "owner-1", user_id: "owner-1", orgId: "org-1" });
        expect(res.status).toBe(200);
        expect(usageCalls()).toHaveLength(1);
        expect(usageCalls()[0][1]).toMatchObject({
            p_org_id: null,
            p_user_id: "member-1",
        });
    });

    it("refuses a request without a session and reads nothing", async () => {
        currentUser = null;
        const res = await request(app).get("/user/storage");
        expect(res.status).toBe(401);
        expect(usageCalls()).toHaveLength(0);
    });

    it("answers the generic internal error when the usage cannot be read", async () => {
        as("member-1");
        rpcAnswer = {
            data: null,
            error: { message: "relation internal_secret_table does not exist" },
        };
        const failed = await request(app).get("/user/storage").set(...AUTH);
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toMatch(/internal_secret_table|zero|usedBytes/);

        rpcAnswer = { data: [], error: null };
        const nothing = await request(app).get("/user/storage").set(...AUTH);
        expect(nothing.status).toBe(500);
        expect(nothing.body).not.toHaveProperty("usedBytes");
    });
});

describe("GET /orgs/:orgId/storage", () => {
    it.each([
        ["an owner", "owner-1"],
        ["an administrator", "admin-1"],
    ])("answers the firm's numbers to %s", async (_label, userId) => {
        as(userId);
        const res = await request(app).get("/orgs/org-1/storage").set(...AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ usedBytes: 1234, limitBytes: 5000 });
        expect(usageCalls()).toEqual([
            [
                "storage_space_usage",
                {
                    p_org_id: "org-1",
                    p_user_id: null,
                    p_bytes_per_member: 5000,
                    p_personal_bytes: 700,
                },
            ],
        ]);
    });

    it("reads the organization named by the route, whatever a query or body field names", async () => {
        as("owner-1");
        const res = await request(app)
            .get("/orgs/org-1/storage?orgId=org-2&org_id=personal-org-1")
            .set(...AUTH)
            .send({ orgId: "org-2", org_id: "personal-org-1" });
        expect(res.status).toBe(200);
        expect(usageCalls()).toHaveLength(1);
        expect(usageCalls()[0][1]).toMatchObject({ p_org_id: "org-1", p_user_id: null });
    });

    it("refuses a member who is not an administrator, as the invitation roster does, and reads nothing", async () => {
        as("member-1");
        const roster = await request(app).get("/orgs/org-1/invitations").set(...AUTH);
        const res = await request(app).get("/orgs/org-1/storage").set(...AUTH);
        expect(res.status).toBe(403);
        expect(res.status).toBe(roster.status);
        expect(res.body).toEqual(roster.body);
        expect(usageCalls()).toHaveLength(0);
    });

    it.each([
        ["a person who is not a member", "stranger-1", "org-1"],
        ["a person with only a pending invitation", "invited-1", "org-1"],
        ["a member of another firm", "other-firm-owner", "org-1"],
        ["a personal organization's id", "owner-1", "personal-org-1"],
        ["an organization that does not exist", "owner-1", "org-missing"],
    ])("refuses %s as the invitation roster does, and reads nothing", async (_label, userId, orgId) => {
        as(userId);
        const roster = await request(app).get(`/orgs/${orgId}/invitations`).set(...AUTH);
        const res = await request(app).get(`/orgs/${orgId}/storage`).set(...AUTH);
        expect(res.status).toBe(404);
        expect(res.status).toBe(roster.status);
        expect(res.body).toEqual(roster.body);
        expect(usageCalls()).toHaveLength(0);
    });

    it("refuses a request without a session and reads nothing", async () => {
        currentUser = null;
        const res = await request(app).get("/orgs/org-1/storage");
        expect(res.status).toBe(401);
        expect(usageCalls()).toHaveLength(0);
    });

    it("answers the generic internal error when the usage cannot be read", async () => {
        rpcAnswer = {
            data: null,
            error: { message: "relation internal_secret_table does not exist" },
        };
        const failed = await request(app).get("/orgs/org-1/storage").set(...AUTH);
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toMatch(/internal_secret_table|usedBytes/);

        rpcAnswer = { data: null, error: null };
        const nothing = await request(app).get("/orgs/org-1/storage").set(...AUTH);
        expect(nothing.status).toBe(500);
        expect(nothing.body).not.toHaveProperty("usedBytes");
    });
});

describe("the configured amounts reach the database function", () => {
    it("passes the per-member and personal amounts from the environment", async () => {
        vi.stubEnv("STORAGE_QUOTA_BYTES_PER_MEMBER", "123456");
        vi.stubEnv("STORAGE_QUOTA_PERSONAL_BYTES", "654321");
        as("owner-1");
        await request(app).get("/user/storage").set(...AUTH);
        await request(app).get("/orgs/org-1/storage").set(...AUTH);
        expect(usageCalls().map(([, args]) => [args.p_bytes_per_member, args.p_personal_bytes])).toEqual([
            [123456, 654321],
            [123456, 654321],
        ]);
    });
});
