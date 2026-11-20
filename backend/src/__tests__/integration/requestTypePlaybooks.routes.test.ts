import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Playbooks linked to the firm's request types over HTTP, against an in-memory
// database: only ready playbooks shared with the same firm, who may change the
// links, another firm's ids answering 404, and unlinking keeping the history.
// The trigger, grants and RLS are covered against PostgreSQL in
// requestTypePlaybooks.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
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
    recordAudit: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { recordAudit } from "../../lib/audit";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const OWNER = id(1);
const MEMBER = id(2);
const ORG_ADMIN = id(3);
const OUTSIDER = id(4);
const TYPE = id(300);
const OTHER_TYPE = id(301);
const READY = id(400);
const READY_2 = id(401);
const DRAFT = id(402);
const PRIVATE = id(403);
const FOREIGN = id(404);

const url = `/orgs/${ORG}/request-types`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const link = (typeId = TYPE, playbookId: unknown = READY) => request(app).post(`${url}/${typeId}/playbooks`).send({ playbook_id: playbookId });
const unlink = (typeId = TYPE, playbookId = READY) => request(app).delete(`${url}/${typeId}/playbooks/${playbookId}`);

beforeEach(() => {
    vi.mocked(recordAudit).mockClear();
    h.state = memoryDb({
        organizations: [
            { id: ORG, kind: "team" },
            { id: OTHER_ORG, kind: "team" },
            { id: id(102), kind: "personal" },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: MEMBER, role: "member" },
            { org_id: ORG, user_id: ORG_ADMIN, role: "admin" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
            { org_id: id(102), user_id: MEMBER, role: "owner" },
        ],
        matter_request_types: [
            { id: TYPE, organization_id: ORG, seed_key: "contracts_clients", name: null, sort_order: 10, archived_at: null },
            { id: OTHER_TYPE, organization_id: OTHER_ORG, seed_key: "other", name: null, sort_order: 10, archived_at: null },
        ],
        playbooks: [
            { id: READY, org_id: ORG, visibility: "organization", status: "ready", name: "Arrendamiento" },
            { id: READY_2, org_id: ORG, visibility: "organization", status: "ready", name: "Confidencialidad" },
            { id: DRAFT, org_id: ORG, visibility: "organization", status: "draft", name: "Borrador" },
            { id: PRIVATE, org_id: ORG, visibility: "private", status: "ready", name: "Privado" },
            { id: FOREIGN, org_id: OTHER_ORG, visibility: "organization", status: "ready", name: "Ajeno" },
        ],
        request_type_playbooks: [],
    });
});

describe("link, list and unlink", () => {
    it("lets an owner or admin link a ready playbook, and any member read it", async () => {
        as(ORG_ADMIN);
        const made = await link();
        expect(made.status).toBe(201);
        expect(made.body).toMatchObject({ type_id: TYPE, playbook_id: READY, name: "Arrendamiento" });
        as(OWNER);
        expect((await link(TYPE, READY_2)).status).toBe(201);
        expect(tables().request_type_playbooks[0]).toMatchObject({ org_id: ORG, type_id: TYPE, linked_by: ORG_ADMIN });

        as(MEMBER);
        const all = await request(app).get(`${url}/playbooks`);
        expect(all.status).toBe(200);
        expect(all.body.can_manage).toBe(false);
        expect(all.body.links.map((l: { name: string }) => l.name).sort()).toEqual(["Arrendamiento", "Confidencialidad"]);
        // Only ready, firm-shared playbooks of this firm are offered.
        expect(all.body.available.map((p: { id: string }) => p.id)).toEqual([READY, READY_2]);
        const one = await request(app).get(`${url}/${TYPE}/playbooks`);
        expect(one.body.links).toHaveLength(2);
        as(OWNER);
        expect((await request(app).get(`${url}/${TYPE}/playbooks`)).body.can_manage).toBe(true);
        expect(vi.mocked(recordAudit).mock.calls.map((call) => call[1].action)).toEqual([
            "request_type_playbooks.linked",
            "request_type_playbooks.linked",
        ]);
    });

    it("links several playbooks to a type and a playbook to several types", async () => {
        as(OWNER);
        tables().matter_request_types.push({ id: id(302), organization_id: ORG, seed_key: "other", name: null, sort_order: 20, archived_at: null });
        expect((await link(TYPE, READY)).status).toBe(201);
        expect((await link(id(302), READY)).status).toBe(201);
        expect((await link(TYPE, READY_2)).status).toBe(201);
        expect((await request(app).get(`${url}/playbooks`)).body.links).toHaveLength(3);
        expect((await request(app).get(`${url}/${id(302)}/playbooks`)).body.links).toHaveLength(1);
    });

    it("maps the database's refusals", async () => {
        as(OWNER);
        h.state!.failNext("request_type_playbooks", "insert", { code: "23505", message: "dup" });
        expect((await link()).body.code).toBe("request_type_playbook_linked");
        h.state!.failNext("request_type_playbooks", "insert", { code: "23514", message: "trigger" });
        expect((await link()).body.code).toBe("playbook_not_ready");
        h.state!.failNext("request_type_playbooks", "insert", { code: "XX000", message: "boom" });
        expect((await link()).status).toBe(500);
    });

    it("unlinks by marking the row: the history stays, a later link is a new row", async () => {
        as(ORG_ADMIN);
        await link();
        as(OWNER);
        const gone = await unlink();
        expect(gone.status).toBe(200);
        expect(gone.body).toEqual({ type_id: TYPE, playbook_id: READY, unlinked: true });
        const rows = tables().request_type_playbooks;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ linked_by: ORG_ADMIN, unlinked_by: OWNER });
        expect(rows[0].unlinked_at).toBeTruthy();
        expect((await request(app).get(`${url}/${TYPE}/playbooks`)).body.links).toEqual([]);
        expect((await unlink()).status).toBe(404);

        expect((await link()).status).toBe(201);
        expect(tables().request_type_playbooks).toHaveLength(2);
        expect((await request(app).get(`${url}/${TYPE}/playbooks`)).body.links).toHaveLength(1);
        expect(vi.mocked(recordAudit).mock.calls.map((call) => call[1].action)).toEqual([
            "request_type_playbooks.linked",
            "request_type_playbooks.unlinked",
            "request_type_playbooks.linked",
        ]);
    });

    it("reads a link to a playbook that is gone or no longer shared as absent", async () => {
        as(OWNER);
        await link();
        tables().playbooks.find((row) => row.id === READY)!.visibility = "private";
        const read = await request(app).get(`${url}/playbooks`);
        expect(read.body.links).toEqual([]);
        expect(read.body.available.map((p: { id: string }) => p.id)).toEqual([READY_2]);
    });
});

describe("what can be linked", () => {
    it("still reads an open link when the firm has more ready playbooks than the option list holds", async () => {
        as(OWNER);
        // 501 playbooks named "A…" sort before "Arrendamiento"/"Confidencialidad": READ_2 falls outside the first 500.
        for (let n = 0; n < 501; n += 1)
            tables().playbooks.push({ id: id(1000 + n), org_id: ORG, visibility: "organization", status: "ready", name: `A${String(n).padStart(4, "0")}` });
        tables().playbooks.find((row) => row.id === READY_2)!.name = "Zeta";
        expect((await link(TYPE, READY_2)).status).toBe(201);
        const read = await request(app).get(`${url}/playbooks`);
        expect(read.body.available).toHaveLength(500);
        expect(read.body.links.map((l: { playbook_id: string }) => l.playbook_id)).toEqual([READY_2]);
    });

    it("refuses a new link to an archived type with 404, but still unlinks one", async () => {
        as(OWNER);
        expect((await link()).status).toBe(201);
        tables().matter_request_types.find((row) => row.id === TYPE)!.archived_at = new Date().toISOString();
        expect((await link(TYPE, READY_2)).status).toBe(404);
        expect((await unlink()).status).toBe(200);
    });

    it("refuses a draft with 409", async () => {
        as(OWNER);
        const refused = await link(TYPE, DRAFT);
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe("playbook_not_ready");
        expect(tables().request_type_playbooks).toHaveLength(0);
    });

    it("answers 404 for a private playbook, another firm's playbook, a missing one and a bad id", async () => {
        as(OWNER);
        expect((await link(TYPE, PRIVATE)).status).toBe(404);
        expect((await link(TYPE, FOREIGN)).status).toBe(404);
        expect((await link(TYPE, id(999))).status).toBe(404);
        expect((await link(TYPE, null)).status).toBe(400);
        expect((await link(TYPE, "nope")).status).toBe(400);
        expect(tables().request_type_playbooks).toHaveLength(0);
    });
});

describe("isolation between firms", () => {
    it("answers 404 for another firm's type, on every route", async () => {
        as(OWNER);
        expect((await link(OTHER_TYPE, READY)).status).toBe(404);
        expect((await unlink(OTHER_TYPE, READY)).status).toBe(404);
        expect((await request(app).get(`${url}/${OTHER_TYPE}/playbooks`)).status).toBe(404);
        expect((await request(app).get(`${url}/not-an-id/playbooks`)).status).toBe(404);
        expect((await unlink(TYPE, "not-an-id" as string)).status).toBe(404);
        expect(tables().request_type_playbooks).toHaveLength(0);
    });

    it("answers 404 to a person outside the firm, and to the owner of a personal workspace", async () => {
        as(OWNER);
        await link();
        as(OUTSIDER);
        expect((await request(app).get(`${url}/playbooks`)).status).toBe(404);
        expect((await request(app).get(`${url}/${TYPE}/playbooks`)).status).toBe(404);
        expect((await link()).status).toBe(404);
        expect((await unlink()).status).toBe(404);
        // The other firm's own view holds none of this firm's links.
        const own = await request(app).get(`/orgs/${OTHER_ORG}/request-types/playbooks`);
        expect(own.body.links).toEqual([]);
        expect(own.body.available.map((p: { id: string }) => p.id)).toEqual([FOREIGN]);
        as(MEMBER);
        expect((await request(app).get(`/orgs/${id(102)}/request-types/playbooks`)).status).toBe(404);
        expect((await request(app).get(`/orgs/not-an-id/request-types/playbooks`)).status).toBe(404);
    });

    it("does not unlink another firm's link by guessing the ids", async () => {
        as(OUTSIDER);
        tables().request_type_playbooks.push({
            id: id(500), org_id: OTHER_ORG, type_id: OTHER_TYPE, playbook_id: FOREIGN, unlinked_at: null,
        });
        as(OWNER);
        expect((await unlink(TYPE, FOREIGN)).status).toBe(404);
        expect(tables().request_type_playbooks[0].unlinked_at).toBeNull();
    });
});

describe("permissions", () => {
    it("lets a plain member read but not link or unlink", async () => {
        as(OWNER);
        await link();
        as(MEMBER);
        expect((await request(app).get(`${url}/playbooks`)).status).toBe(200);
        const refused = await link(TYPE, READY_2);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe("org_admin_required");
        expect((await unlink()).status).toBe(403);
        expect(tables().request_type_playbooks).toHaveLength(1);
        expect(tables().request_type_playbooks[0].unlinked_at ?? null).toBeNull();
    });
});

describe("database failures", () => {
    it("answers 500 when a read or write fails", async () => {
        as(OWNER);
        h.state!.failNext("request_type_playbooks", "select", { message: "boom" });
        expect((await request(app).get(`${url}/playbooks`)).status).toBe(500);
        h.state!.failNext("playbooks", "select", { message: "boom" });
        expect((await request(app).get(`${url}/playbooks`)).status).toBe(500);
        h.state!.failNext("matter_request_types", "select", { message: "boom" });
        expect((await request(app).get(`${url}/${TYPE}/playbooks`)).status).toBe(500);
        h.state!.failNext("playbooks", "select", { message: "boom" });
        expect((await link()).status).toBe(500);
        h.state!.failNext("request_type_playbooks", "update", { message: "boom" });
        expect((await unlink()).status).toBe(500);
    });
});
