import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// #463 (ii) — a revoke that changed nothing is not a 204, and a refused batch
// writes nothing.
//
// DELETE /workflows/:id/shares/:shareId fired the delete without reading its
// result, so a database error and an unknown share id both answered 204: the
// client dropped the row while the person it named kept access.
//
// POST /workflows/:id/share validated and wrote in the same loop, so one bad
// address in the third position returned 400 with the first two overrides
// already persisted — the caller read "nothing happened" while access had
// silently changed for two people.
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown };
type Captured = {
    table: string;
    op: "delete" | "upsert" | "read";
    payload?: unknown;
    onConflict?: unknown;
};

let tables: Record<string, Result | Result[]>;
let captured: Captured[];

function take(table: string): Result {
    const entry = tables[table];
    if (Array.isArray(entry)) {
        return entry.shift() ?? { data: null, error: null };
    }
    return entry ?? { data: null, error: null };
}

function makeQuery(table: string) {
    const q: Record<string, any> = {};
    for (const method of [
        "select",
        "eq",
        "neq",
        "in",
        "is",
        "or",
        "not",
        "ilike",
        "gte",
        "lte",
        "order",
        "limit",
        "range",
    ]) {
        q[method] = () => q;
    }
    q.delete = () => {
        captured.push({ table, op: "delete" });
        return q;
    };
    q.upsert = (payload: unknown, options?: { onConflict?: unknown }) => {
        captured.push({
            table,
            op: "upsert",
            payload,
            onConflict: options?.onConflict,
        });
        // One statement answers with the rows it wrote.
        const rows = Array.isArray(payload) ? payload : [payload];
        const written: Record<string, any> = {
            select: () => written,
            single: () => Promise.resolve({ data: rows[0], error: null }),
            then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ data: rows, error: null }).then(resolve),
        };
        return written;
    };
    q.single = () => Promise.resolve(take(table));
    q.maybeSingle = () => Promise.resolve(take(table));
    q.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(take(table)).then(resolve);
    return q;
}

function makeDb() {
    return {
        from: (table: string) => makeQuery(table),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => makeDb()),
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "owner-1";
        res.locals.userEmail = "owner@firm.example";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

vi.mock("../../lib/access", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/access")>();
    return {
        ...actual,
        checkWorkflowAccess: vi.fn(async () => ({
            ok: true,
            isCreator: true,
            orgRole: null,
            projectRole: "owner",
            workflow: { id: "w1", user_id: "owner-1", org_id: null },
        })),
    };
});

import { workflowsRouter } from "../../routes/workflows";

const app = express();
app.use(express.json());
app.use("/workflows", workflowsRouter);

const AUTH = ["Authorization", "Bearer test"] as const;

const PERSONAL_WORKFLOW = {
    id: "w1",
    user_id: "owner-1",
    org_id: null,
    name: "Draft",
};
const ORG_WORKFLOW = {
    id: "w-org",
    user_id: "owner-1",
    org_id: "org-1",
    name: "Firm flow",
};

function revoke(workflowId: string, shareId: string) {
    return request(app)
        .delete(`/workflows/${workflowId}/shares/${shareId}`)
        .set(...AUTH);
}

function share(workflowId: string, emails: string[], role = "editor") {
    return request(app)
        .post(`/workflows/${workflowId}/share`)
        .set(...AUTH)
        .send({ emails, role });
}

beforeEach(() => {
    captured = [];
    tables = {
        workflows: { data: PERSONAL_WORKFLOW, error: null },
    };
});

describe("DELETE /workflows/:id/shares/:shareId", () => {
    it("answers 204 and deletes the row when the share existed", async () => {
        tables.workflow_shares = { data: [{ id: "share-1" }], error: null };

        const res = await revoke("w1", "share-1");

        expect(res.status).toBe(204);
        expect(
            captured.filter(
                (call) =>
                    call.table === "workflow_shares" && call.op === "delete",
            ),
        ).toHaveLength(1);
    });

    it("answers 404 when no share row matched", async () => {
        // An unknown (or already revoked) share id is not a successful
        // revocation: the person named by that id still holds access.
        tables.workflow_shares = { data: [], error: null };

        const res = await revoke("w1", "share-missing");

        expect(res.status).toBe(404);
        expect(res.body.detail).toBe("Access grant not found");
    });

    it("answers 500 when the delete itself fails", async () => {
        tables.workflow_shares = {
            data: null,
            error: { message: "permission denied for table workflow_shares" },
        };

        const res = await revoke("w1", "share-1");

        expect(res.status).toBe(500);
    });

    it("answers 404 when the organization override is not there", async () => {
        tables.workflows = { data: ORG_WORKFLOW, error: null };
        tables.workflow_org_access_overrides = { data: [], error: null };

        const res = await revoke("w-org", "member-without-override");

        expect(res.status).toBe(404);
        expect(res.body.detail).toBe("Access override not found");
    });

    it("answers 204 when an organization override was removed", async () => {
        tables.workflows = { data: ORG_WORKFLOW, error: null };
        tables.workflow_org_access_overrides = {
            data: [{ id: "override-1" }],
            error: null,
        };

        const res = await revoke("w-org", "member-2");

        expect(res.status).toBe(204);
    });
});

describe("POST /workflows/:id/share (organization batch)", () => {
    beforeEach(() => {
        tables.workflows = { data: ORG_WORKFLOW, error: null };
    });

    it("writes nothing when one of the targets is not an org member", async () => {
        // First email resolves, second does not. Today the first override is
        // persisted before the 400 is returned.
        tables.user_profiles = [
            { data: { user_id: "member-2" }, error: null },
            { data: null, error: null },
        ];
        tables.organization_memberships = [
            { data: { user_id: "member-2", role: "editor" }, error: null },
        ];

        const res = await share("w-org", ["member2@firm.example", "gone@else.example"]);

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe(
            "Only current organization members can be assigned a role",
        );
        expect(
            captured.filter(
                (call) =>
                    call.table === "workflow_org_access_overrides" &&
                    call.op === "upsert",
            ),
        ).toHaveLength(0);
    });

    it("writes the whole batch in one statement once every target is valid", async () => {
        tables.user_profiles = [
            { data: { user_id: "member-2" }, error: null },
            { data: { user_id: "member-3" }, error: null },
        ];
        tables.organization_memberships = [
            { data: { user_id: "member-2", role: "editor" }, error: null },
            { data: { user_id: "member-3", role: "viewer" }, error: null },
        ];

        const res = await share("w-org", [
            "member2@firm.example",
            "member3@firm.example",
        ]);

        expect(res.status).toBe(204);
        const writes = captured.filter(
            (call) =>
                call.table === "workflow_org_access_overrides" &&
                call.op === "upsert",
        );
        expect(writes).toHaveLength(1);
        const payload = writes[0].payload as Record<string, unknown>[];
        expect(payload).toHaveLength(2);
        expect(payload.map((row) => row.user_id).sort()).toEqual([
            "member-2",
            "member-3",
        ]);
        expect(payload.every((row) => row.role === "editor")).toBe(true);
        expect(writes[0].onConflict).toBe("workflow_id,user_id");
    });
});
