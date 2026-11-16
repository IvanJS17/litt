import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The requests of a retainer matter over HTTP, against an in-memory database:
// who may read and write (matrix), the request lifecycle and its events,
// negotiation rounds over existing document versions, and the firm's catalog
// of request types. Constraints, privileges and RLS are covered against
// PostgreSQL in matterRequests.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
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
// The project gate (a private matter's project exists only for its team) is
// covered by its own suites; here it answers from the matter's roster.
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => {
        const matter = h.state!.tables.matters.find((row) => row.project_id === projectId);
        const member = h.state!.tables.matter_memberships.find(
            (row) => row.matter_id === matter?.id && row.user_id === userId && row.status === "active",
        );
        return member
            ? { ok: true, isCreator: false, orgRole: "member", projectRole: "editor", project: { id: projectId } }
            : { ok: false };
    }),
}));

import { app } from "../../app";
import { recordAudit } from "../../lib/audit";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const WORKSPACE = id(110);
const PROJECT = id(120);
const OTHER_PROJECT = id(121);
const MATTER = id(130);
const PLAIN_PROJECT = id(122);
const PLAIN_MATTER = id(131);
const PUBLIC_PROJECT = id(123);
const PUBLIC_MATTER = id(132);
const OWNER = id(1);
const EDITOR = id(2);
const VIEWER = id(3);
const TECH = id(4);
const STRANGER = id(5);
const ORG_ADMIN = id(6);
const OUTSIDER = id(7);
const PASANTE = id(8);
const REMOVED = id(9);
const DOC = id(200);
const VERSION = id(210);
const VERSION_2 = id(211);
const FOREIGN_VERSION = id(212);
const GONE_VERSION = id(213);
const TYPE = id(300);
const OTHER_ORG_TYPE = id(301);
const ARCHIVED_TYPE = id(302);

const base = `/projects/${PROJECT}/matters/${MATTER}/requests`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const create = (extra: Record<string, unknown> = {}) =>
    request(app).post(base).send({ title: "Contrato de arrendamiento", type_id: TYPE, complexity: "standard", ...extra });
const actions = (requestId: string) =>
    tables()
        .matter_request_events.filter((row) => row.request_id === requestId)
        .map((row) => row.action);

beforeEach(() => {
    vi.mocked(recordAudit).mockClear();
    h.state = memoryDb({
        organizations: [
            { id: ORG, kind: "team" },
            { id: OTHER_ORG, kind: "team" },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: EDITOR, role: "member" },
            { org_id: ORG, user_id: VIEWER, role: "member" },
            { org_id: ORG, user_id: TECH, role: "member" },
            { org_id: ORG, user_id: STRANGER, role: "member" },
            { org_id: ORG, user_id: ORG_ADMIN, role: "admin" },
            { org_id: ORG, user_id: PASANTE, role: "member" },
            { org_id: ORG, user_id: REMOVED, role: "member" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
        ],
        workspaces: [{ id: WORKSPACE, organization_id: ORG }],
        matters: [
            { id: MATTER, project_id: PROJECT, workspace_id: WORKSPACE, is_retainer: true, visibility: "private" },
            { id: PLAIN_MATTER, project_id: PLAIN_PROJECT, workspace_id: WORKSPACE, is_retainer: false, visibility: "private" },
            { id: PUBLIC_MATTER, project_id: PUBLIC_PROJECT, workspace_id: WORKSPACE, is_retainer: true, visibility: "public" },
        ],
        matter_memberships: [
            ...[OWNER, EDITOR, VIEWER, TECH, PASANTE].map((user_id) => ({
                matter_id: MATTER,
                user_id,
                status: "active",
                role: { [OWNER]: "matter_owner", [VIEWER]: "viewer", [TECH]: "technical_operator" }[user_id] ?? "editor",
            })),
            { matter_id: MATTER, user_id: REMOVED, status: "revoked", role: "editor" },
            { matter_id: PLAIN_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: PLAIN_MATTER, user_id: EDITOR, status: "active", role: "editor" },
            { matter_id: PUBLIC_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
        ],
        training_stages: [{ org_id: ORG, trainee_user_id: PASANTE, practice: null, stage: "pasante" }],
        user_profiles: [{ user_id: EDITOR, display_name: "Elena Editora", email: "elena@example.test" }],
        documents: [
            { id: DOC, project_id: PROJECT, archived_at: null },
            { id: id(201), project_id: OTHER_PROJECT, archived_at: null },
        ],
        document_versions: [
            { id: VERSION, document_id: DOC, version_number: 1, filename: "borrador.docx", deleted_at: null },
            { id: VERSION_2, document_id: DOC, version_number: 2, filename: "borrador-2.docx", deleted_at: null },
            { id: FOREIGN_VERSION, document_id: id(201), version_number: 1, filename: "otro.docx", deleted_at: null },
            { id: GONE_VERSION, document_id: DOC, version_number: 3, filename: "borrado.docx", deleted_at: "2026-11-01T00:00:00Z" },
        ],
        matter_request_types: [
            { id: TYPE, organization_id: ORG, seed_key: "contracts_clients", name: null, sort_order: 10, archived_at: null },
            { id: ARCHIVED_TYPE, organization_id: ORG, seed_key: null, name: "Antigua", sort_order: 20, archived_at: "2026-11-01T00:00:00Z" },
            { id: OTHER_ORG_TYPE, organization_id: OTHER_ORG, seed_key: "other", name: null, sort_order: 10, archived_at: null },
        ],
        matter_requests: [],
        matter_request_rounds: [],
        matter_request_events: [],
    });
});

describe("the retainer mark", () => {
    it("is changed only by the matter owner, and audited", async () => {
        as(OWNER);
        const marked = await request(app)
            .put(`/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/retainer`)
            .send({ is_retainer: true });
        expect(marked.status).toBe(200);
        expect(marked.body).toEqual({ matter_id: PLAIN_MATTER, is_retainer: true });
        expect(tables().matters.find((row) => row.id === PLAIN_MATTER)?.is_retainer).toBe(true);
        expect(vi.mocked(recordAudit).mock.calls.map((call) => call[1].action)).toEqual(["matter.retainer_marked"]);

        as(EDITOR);
        const refused = await request(app)
            .put(`/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/retainer`)
            .send({ is_retainer: false });
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe("matter_owner_required");

        as(STRANGER);
        expect(
            (await request(app).put(`/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/retainer`).send({ is_retainer: false })).status,
        ).toBe(404);
        as(OWNER);
        expect(
            (await request(app).put(`/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/retainer`).send({ is_retainer: "yes" })).status,
        ).toBe(400);
    });

    it("cannot be removed while the matter holds requests", async () => {
        as(OWNER);
        expect((await create()).status).toBe(201);
        const removed = await request(app).put(`/projects/${PROJECT}/matters/${MATTER}/retainer`).send({ is_retainer: false });
        expect(removed.status).toBe(409);
        expect(removed.body.code).toBe("retainer_has_requests");
    });

    it("fails closed on a public matter: it cannot be marked and takes no request", async () => {
        as(OWNER);
        const publicBase = `/projects/${PUBLIC_PROJECT}/matters/${PUBLIC_MATTER}`;
        // Even a stale retainer mark on a public matter opens nothing.
        const listed = await request(app).get(`${publicBase}/requests`);
        expect(listed.body).toMatchObject({ retainer: false, requests: [] });
        const created = await request(app).post(`${publicBase}/requests`).send({ title: "x", type_id: TYPE, complexity: "routine" });
        expect(created.status).toBe(409);
        expect(created.body.code).toBe("matter_not_retainer");
        tables().matters.find((row) => row.id === PUBLIC_MATTER)!.is_retainer = false;
        const marked = await request(app).put(`${publicBase}/retainer`).send({ is_retainer: true });
        expect(marked.status).toBe(409);
        expect(marked.body.code).toBe("matter_not_private");
        expect(tables().matter_requests).toHaveLength(0);
    });

    it("keeps a matter that is not a retainer out of the feature", async () => {
        as(OWNER);
        const plain = `/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/requests`;
        const listed = await request(app).get(plain);
        expect(listed.status).toBe(200);
        expect(listed.body).toMatchObject({ retainer: false, can_manage_retainer: true, requests: [], types: [], can_write: false });
        const created = await request(app).post(plain).send({ title: "x", type_id: TYPE, complexity: "routine" });
        expect(created.status).toBe(409);
        expect(created.body.code).toBe("matter_not_retainer");
        expect(tables().matter_requests).toHaveLength(0);
    });
});

describe("who can read and write (matrix)", () => {
    it("lets owner and editor create, and the rest of the roster read only", async () => {
        for (const user of [OWNER, EDITOR, PASANTE]) {
            as(user);
            const created = await create();
            expect(created.status, user).toBe(201);
        }
        for (const user of [VIEWER, TECH]) {
            as(user);
            const refused = await create();
            expect(refused.status, user).toBe(403);
            expect(refused.body.code).toBe("matter_write_required");
            const listed = await request(app).get(base);
            expect(listed.status).toBe(200);
            expect(listed.body.can_write).toBe(false);
            expect(listed.body.assignees).toEqual([]);
            expect(listed.body.requests).toHaveLength(3);
        }
        expect(tables().matter_requests).toHaveLength(3);
    });

    it("answers 404 to everyone outside the matter's roster, the firm's admins included", async () => {
        as(OWNER);
        const made = await create();
        const detail = `${base}/${made.body.id}`;
        for (const user of [STRANGER, ORG_ADMIN, OUTSIDER, REMOVED]) {
            as(user);
            expect((await request(app).get(base)).status, user).toBe(404);
            expect((await request(app).get(detail)).status, user).toBe(404);
            expect((await create()).status, user).toBe(404);
            expect((await request(app).patch(detail).send({ version: 1, title: "x" })).status, user).toBe(404);
            expect((await request(app).post(`${detail}/rounds`).send({ version_id: VERSION })).status, user).toBe(404);
        }
        expect(tables().matter_requests).toHaveLength(1);
    });

    it("cuts a removed member off on their very next request", async () => {
        as(EDITOR);
        expect((await request(app).get(base)).status).toBe(200);
        tables().matter_memberships.find((row) => row.user_id === EDITOR && row.matter_id === MATTER)!.status = "revoked";
        expect((await request(app).get(base)).status).toBe(404);
        expect((await create()).status).toBe(404);
    });

    it("never opens a request through another matter's route", async () => {
        as(OWNER);
        const made = await create();
        as(EDITOR);
        const crossed = await request(app).get(`/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/requests/${made.body.id}`);
        expect(crossed.status).toBe(404);
    });

    it("has no way to delete a request", async () => {
        as(OWNER);
        const made = await create();
        expect((await request(app).delete(`${base}/${made.body.id}`)).status).toBe(404);
        expect(tables().matter_requests).toHaveLength(1);
    });
});

describe("creating and changing a request", () => {
    it("creates one with its first event and the firm's type", async () => {
        as(OWNER);
        const created = await create({ received_on: "2026-11-02" });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({
            matter_id: MATTER,
            type_id: TYPE,
            title: "Contrato de arrendamiento",
            complexity: "standard",
            status: "received",
            received_on: "2026-11-02",
            closed_on: null,
            assignee_user_id: null,
            round_count: 0,
            version: 1,
        });
        expect(actions(created.body.id)).toEqual(["created"]);
        expect(created.body.events[0]).toMatchObject({ action: "created", actor_user_id: OWNER });
        // No hours or estimate anywhere on the request.
        expect(Object.keys(created.body).filter((key) => /hour|minute|estimate|time/i.test(key))).toEqual([]);
    });

    it("refuses a bad body, another firm's type and an archived type", async () => {
        as(OWNER);
        const bad: Record<string, unknown>[] = [
            { title: "   " },
            { title: "x".repeat(161) },
            { type_id: "nope" },
            { complexity: "huge" },
            { received_on: "2026-02-30" },
            { assignee_level: "senior" },
            { assignee_user_id: EDITOR },
            { assignee_user_id: EDITOR, assignee_level: "boss" },
        ];
        for (const extra of bad) {
            const response = await create(extra);
            expect(response.status, JSON.stringify(extra)).toBe(400);
        }
        const foreign = await create({ type_id: OTHER_ORG_TYPE });
        expect(foreign.status).toBe(400);
        expect(foreign.body.code).toBe("request_type_not_available");
        expect((await create({ type_id: ARCHIVED_TYPE })).status).toBe(400);
        expect(tables().matter_requests).toHaveLength(0);
    });

    it("assigns an owner or editor with a cost level, and only them", async () => {
        as(OWNER);
        const ok = await create({ assignee_user_id: EDITOR, assignee_level: "junior" });
        expect(ok.status).toBe(201);
        expect(ok.body).toMatchObject({ assignee_user_id: EDITOR, assignee_level: "junior" });
        expect(actions(ok.body.id)).toEqual(["created", "assigned"]);

        for (const user of [VIEWER, TECH, STRANGER, ORG_ADMIN, OUTSIDER, REMOVED]) {
            const refused = await create({ assignee_user_id: user, assignee_level: "senior" });
            expect(refused.status, user).toBe(400);
            expect(refused.body.code).toBe("assignee_not_eligible");
        }
        const patchViewer = await request(app)
            .patch(`${base}/${ok.body.id}`)
            .send({ version: 1, assignee_user_id: VIEWER, assignee_level: "junior" });
        expect(patchViewer.status).toBe(400);
        expect(tables().matter_requests.find((row) => row.id === ok.body.id)?.assignee_user_id).toBe(EDITOR);
    });

    it("suggests the cost level from the training stage and the firm roles", async () => {
        as(OWNER);
        const listed = await request(app).get(base);
        const levels = Object.fromEntries(
            listed.body.assignees.map((a: { user_id: string; suggested_level: string | null }) => [a.user_id, a.suggested_level]),
        );
        expect(levels).toEqual({ [OWNER]: "partner", [EDITOR]: null, [PASANTE]: "apprentice" });
        expect(listed.body.assignees.find((a: { user_id: string }) => a.user_id === EDITOR)).toMatchObject({
            display_name: "Elena Editora",
            role: "editor",
        });
        // An apprentice can be assigned work at the apprentice level.
        const assigned = await create({ assignee_user_id: PASANTE, assignee_level: "apprentice" });
        expect(assigned.status).toBe(201);
    });

    it("moves through the states, dating the close and clearing it on reopening", async () => {
        as(EDITOR);
        const made = await create({ received_on: "2026-11-02" });
        const url = `${base}/${made.body.id}`;
        let version = 1;
        for (const status of ["in_review", "with_client", "with_counterparty"]) {
            const moved = await request(app).patch(url).send({ version, status });
            expect(moved.status).toBe(200);
            expect(moved.body).toMatchObject({ status, closed_on: null, version: ++version });
        }
        const closed = await request(app).patch(url).send({ version, status: "closed", closed_on: "2026-11-10" });
        expect(closed.body).toMatchObject({ status: "closed", closed_on: "2026-11-10", version: ++version });
        const reopened = await request(app).patch(url).send({ version, status: "in_review" });
        expect(reopened.body).toMatchObject({ status: "in_review", closed_on: null, version: ++version });
        const cancelled = await request(app).patch(url).send({ version, status: "cancelled" });
        expect(cancelled.body.status).toBe("cancelled");
        expect(cancelled.body.closed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(actions(made.body.id)).toEqual([
            "created",
            "status_changed",
            "status_changed",
            "status_changed",
            "status_changed",
            "status_changed",
            "status_changed",
        ]);
        expect(
            tables()
                .matter_request_events.filter((row) => row.action === "status_changed")
                .map((row) => (row.detail as { to: string }).to),
        ).toEqual(["in_review", "with_client", "with_counterparty", "closed", "in_review", "cancelled"]);
    });

    it("refuses a closing date before the received date or on an open request", async () => {
        as(EDITOR);
        const made = await create({ received_on: "2026-11-05" });
        const url = `${base}/${made.body.id}`;
        expect((await request(app).patch(url).send({ version: 1, status: "closed", closed_on: "2026-11-01" })).status).toBe(400);
        expect((await request(app).patch(url).send({ version: 1, closed_on: "2026-11-06" })).status).toBe(400);
        expect((await request(app).patch(url).send({ version: 1, status: "finished" })).status).toBe(400);
        expect((await request(app).patch(url).send({ version: 1, hours: 3 })).status).toBe(400);
        expect((await request(app).patch(url).send({ title: "no version" })).status).toBe(400);
        expect(actions(made.body.id)).toEqual(["created"]);
    });

    it("answers 409 to a stale version and writes nothing", async () => {
        as(EDITOR);
        const made = await create();
        const url = `${base}/${made.body.id}`;
        expect((await request(app).patch(url).send({ version: 1, title: "Primero" })).status).toBe(200);
        const stale = await request(app).patch(url).send({ version: 1, title: "Segundo" });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe("request_version_conflict");
        expect(tables().matter_requests[0]).toMatchObject({ title: "Primero", version: 2 });
        expect(actions(made.body.id)).toEqual(["created", "edited"]);
    });

    it("records one event per kind of change and none for a no-op", async () => {
        as(OWNER);
        const made = await create();
        const url = `${base}/${made.body.id}`;
        const changed = await request(app)
            .patch(url)
            .send({ version: 1, title: "Nuevo título", complexity: "complex", status: "in_review", assignee_user_id: EDITOR, assignee_level: "senior" });
        expect(changed.status).toBe(200);
        expect(changed.body).toMatchObject({ title: "Nuevo título", complexity: "complex", status: "in_review", version: 2 });
        expect(actions(made.body.id)).toEqual(["created", "edited", "status_changed", "assigned"]);
        const edited = tables().matter_request_events.find((row) => row.action === "edited");
        expect(edited?.detail).toEqual({ fields: ["title", "complexity"] });
        expect(JSON.stringify(tables().matter_request_events)).not.toContain("Nuevo título");

        const noop = await request(app).patch(url).send({ version: 2, title: "Nuevo título" });
        expect(noop.status).toBe(200);
        expect(noop.body.version).toBe(2);
        const unassigned = await request(app).patch(url).send({ version: 2, assignee_user_id: null });
        expect(unassigned.body).toMatchObject({ assignee_user_id: null, assignee_level: null, version: 3 });
        expect(actions(made.body.id).slice(-1)).toEqual(["unassigned"]);
        expect(actions(made.body.id)).toHaveLength(5);
    });
});

describe("negotiation rounds", () => {
    const rounds = (requestId: string) => `${base}/${requestId}/rounds`;

    it("links existing versions with numbers and dates, and counts distinct rounds", async () => {
        as(EDITOR);
        const made = await create();
        const versionsBefore = JSON.stringify(tables().document_versions);
        const first = await request(app).post(rounds(made.body.id)).send({ version_id: VERSION, round_date: "2026-11-03" });
        expect(first.status).toBe(201);
        expect(first.body).toMatchObject({ round_number: 1, round_date: "2026-11-03", version_id: VERSION, document_id: DOC, version_number: 1, filename: "borrador.docx" });
        const second = await request(app).post(rounds(made.body.id)).send({ version_id: VERSION_2 });
        expect(second.body.round_number).toBe(2);
        const detail = await request(app).get(`${base}/${made.body.id}`);
        expect(detail.body.round_count).toBe(2);
        expect(detail.body.rounds.map((r: { round_number: number }) => r.round_number)).toEqual([1, 2]);
        expect((await request(app).get(base)).body.requests[0].round_count).toBe(2);
        expect(actions(made.body.id)).toEqual(["created", "round_linked", "round_linked"]);
        // Linking reuses the documents' versions: no version row is written.
        expect(JSON.stringify(tables().document_versions)).toBe(versionsBefore);
        expect(tables().document_versions).toHaveLength(4);
    });

    it("counts two versions of the same round once", async () => {
        as(EDITOR);
        const made = await create();
        await request(app).post(rounds(made.body.id)).send({ version_id: VERSION, round_number: 1 });
        await request(app).post(rounds(made.body.id)).send({ version_id: VERSION_2, round_number: 1 });
        expect((await request(app).get(`${base}/${made.body.id}`)).body.round_count).toBe(1);
    });

    it("refuses a version of another project, a deleted one, a repeat and bad input", async () => {
        as(EDITOR);
        const made = await create();
        const url = rounds(made.body.id);
        for (const version_id of [FOREIGN_VERSION, GONE_VERSION, id(999)]) {
            const refused = await request(app).post(url).send({ version_id });
            expect(refused.status, version_id).toBe(400);
            expect(refused.body.code).toBe("version_not_in_matter");
        }
        expect((await request(app).post(url).send({ version_id: VERSION })).status).toBe(201);
        const again = await request(app).post(url).send({ version_id: VERSION, round_number: 2 });
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("round_already_linked");
        expect((await request(app).post(url).send({ version_id: "x" })).status).toBe(400);
        expect((await request(app).post(url).send({ version_id: VERSION_2, round_number: 0 })).status).toBe(400);
        expect((await request(app).post(url).send({ version_id: VERSION_2, round_date: "soon" })).status).toBe(400);
        expect(tables().matter_request_rounds).toHaveLength(1);
        expect((await request(app).post(rounds(id(998))).send({ version_id: VERSION })).status).toBe(404);
    });

    it("unlinks a round and leaves the document alone", async () => {
        as(OWNER);
        const made = await create();
        const link = await request(app).post(rounds(made.body.id)).send({ version_id: VERSION });
        as(VIEWER);
        expect((await request(app).delete(`${rounds(made.body.id)}/${link.body.id}`)).status).toBe(403);
        as(OWNER);
        const removed = await request(app).delete(`${rounds(made.body.id)}/${link.body.id}`);
        expect(removed.status).toBe(200);
        expect(tables().matter_request_rounds).toHaveLength(0);
        expect(tables().document_versions).toHaveLength(4);
        expect(actions(made.body.id)).toEqual(["created", "round_linked", "round_unlinked"]);
        expect((await request(app).delete(`${rounds(made.body.id)}/${link.body.id}`)).status).toBe(404);
    });

    it("lets a viewer read the rounds but not link one", async () => {
        as(OWNER);
        const made = await create();
        await request(app).post(rounds(made.body.id)).send({ version_id: VERSION });
        as(VIEWER);
        expect((await request(app).post(rounds(made.body.id)).send({ version_id: VERSION_2 })).status).toBe(403);
        const detail = await request(app).get(`${base}/${made.body.id}`);
        expect(detail.status).toBe(200);
        expect(detail.body.rounds).toHaveLength(1);
    });
});

describe("/orgs/:orgId/request-types", () => {
    const url = `/orgs/${ORG}/request-types`;

    it("gives a firm that has none the six default types, once", async () => {
        h.state!.tables.matter_request_types.length = 0;
        as(EDITOR);
        const listed = await request(app).get(url);
        expect(listed.status).toBe(200);
        expect(listed.body.can_manage).toBe(false);
        expect(listed.body.types.map((t: { seed_key: string }) => t.seed_key)).toEqual([
            "contracts_clients",
            "contracts_suppliers",
            "intellectual_property",
            "shareholder_meetings",
            "corporate_books",
            "other",
        ]);
        expect(listed.body.types.every((t: { name: unknown; archived: boolean }) => t.name === null && !t.archived)).toBe(true);
        await request(app).get(url);
        expect(tables().matter_request_types).toHaveLength(6);
    });

    it("lets an owner or admin add, rename and archive; others only read", async () => {
        as(ORG_ADMIN);
        const added = await request(app).post(url).send({ name: "Poderes" });
        expect(added.status).toBe(201);
        expect(added.body).toMatchObject({ name: "Poderes", seed_key: null, archived: false });
        const renamed = await request(app).patch(`${url}/${TYPE}`).send({ name: "Contratos con clientes finales" });
        expect(renamed.body).toMatchObject({ id: TYPE, name: "Contratos con clientes finales", seed_key: "contracts_clients" });
        const archived = await request(app).patch(`${url}/${added.body.id}`).send({ archived: true });
        expect(archived.body.archived).toBe(true);
        expect((await request(app).patch(`${url}/${added.body.id}`).send({ archived: false })).body.archived).toBe(false);
        expect(vi.mocked(recordAudit).mock.calls.map((call) => call[1].action)).toEqual([
            "request_types.created",
            "request_types.updated",
            "request_types.updated",
            "request_types.updated",
        ]);

        as(EDITOR);
        expect((await request(app).get(url)).body.can_manage).toBe(false);
        expect((await request(app).post(url).send({ name: "Otro" })).status).toBe(403);
        expect((await request(app).patch(`${url}/${TYPE}`).send({ name: "Otro" })).status).toBe(403);
    });

    it("refuses bad names, empty changes and another firm's catalog", async () => {
        as(OWNER);
        expect((await request(app).post(url).send({ name: " " })).status).toBe(400);
        expect((await request(app).post(url).send({ name: "x".repeat(81) })).status).toBe(400);
        expect((await request(app).patch(`${url}/${TYPE}`).send({})).status).toBe(400);
        expect((await request(app).patch(`${url}/${OTHER_ORG_TYPE}`).send({ name: "Mía" })).status).toBe(404);
        as(OUTSIDER);
        expect((await request(app).get(url)).status).toBe(404);
        expect((await request(app).post(url).send({ name: "x" })).status).toBe(404);
        expect((await request(app).get(`/orgs/not-an-id/request-types`)).status).toBe(404);
    });

    it("keeps an archived type on the requests that already use it", async () => {
        as(OWNER);
        const made = await create();
        as(ORG_ADMIN);
        await request(app).patch(`${url}/${TYPE}`).send({ archived: true });
        as(OWNER);
        const detail = await request(app).get(`${base}/${made.body.id}`);
        expect(detail.body.type_id).toBe(TYPE);
        expect((await create()).status).toBe(400);
    });
});
