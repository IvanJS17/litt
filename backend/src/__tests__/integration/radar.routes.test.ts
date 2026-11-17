import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// The deadline radar of a retainer matter over HTTP, against an in-memory
// database: items are computed from CONFIRMED, not stale facts only; calendar
// days in America/Mexico_City; business-day notices are left to review; the
// access matrix; ack / dismiss / done as insert-only events (dismiss needs a
// reason); and "today" limited to matters where the caller is an active
// member. Constraints, privileges and RLS are covered against PostgreSQL in
// radar.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    texts: {} as Record<string, string | null>,
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
// The project gate answers from the matter's roster (covered by its own suites).
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
vi.mock("../../lib/documentTextCache", () => ({
    loadVersionTextState: vi.fn(async (_db: unknown, _documentId: string, versionId: string) => {
        const version = h.state!.tables.document_versions.find((row) => row.id === versionId);
        if (!version || version.deleted_at) return null;
        return { revision: "r", text: h.texts[versionId] ?? null, textlessPageCount: 0 };
    }),
}));

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const WORKSPACE = id(110);
const OTHER_WORKSPACE = id(111);
const PROJECT = id(120);
const PLAIN_PROJECT = id(122);
const PUBLIC_PROJECT = id(123);
const SECOND_PROJECT = id(124);
const FOREIGN_PROJECT = id(125);
const MATTER = id(130);
const PLAIN_MATTER = id(131);
const PUBLIC_MATTER = id(132);
const SECOND_MATTER = id(133);
const FOREIGN_MATTER = id(134);
const OWNER = id(1);
const EDITOR = id(2);
const VIEWER = id(3);
const TECH = id(4);
const STRANGER = id(5);
const ORG_ADMIN = id(6);
const OUTSIDER = id(7);
const REMOVED = id(9);
const DOC = id(200);
const DOC_2 = id(201);
const VERSION = id(210);
const VERSION_2 = id(211);
const GONE_VERSION = id(213);
const SECOND_VERSION = id(216);

const TEXT = "CLÁUSULA SEGUNDA. La vigencia vence el 31 de diciembre de 2026, con treinta días de aviso.";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const base = `/projects/${PROJECT}/matters/${MATTER}/radar`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const FACTS = {
    expiry: id(301), // expiry 2026-12-31, 30 calendar days of notice
    overdue: id(302), // renewal notice on 2026-11-10
    business: id(303), // 10 business days: to review
    pending: id(304),
    rejected: id(305),
    changed: id(306), // confirmed, but the text it cites changed
    poa: id(307), // power of attorney expiring 2028-02-29
    gone: id(308), // confirmed, version deleted
    second: id(309), // second matter: renewal on 2026-11-20
    noData: id(310), // period but no date
};
let ticks = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, 0, ticks++)).toISOString();
function seedFact(factId: string, matter: string, version: string, kind: string, data: Record<string, unknown>, opts: { actions?: string[]; sha?: string; label?: string } = {}) {
    tables().matter_profile_facts.push({
        id: factId,
        matter_id: matter,
        kind,
        label: opts.label ?? `Dato ${factId.slice(-3)}`,
        data,
        document_id: matter === SECOND_MATTER ? DOC_2 : DOC,
        version_id: version,
        start_char: 0,
        end_char: 10,
        quote: "CLÁUSULA",
        text_sha256: opts.sha ?? sha(TEXT),
        created_by: EDITOR,
        created_at: stamp(),
    });
    for (const action of ["created", ...(opts.actions ?? [])])
        tables().matter_profile_fact_events.push({
            id: id(9000 + tables().matter_profile_fact_events.length),
            fact_id: factId,
            matter_id: matter,
            actor_user_id: EDITOR,
            action,
            text_sha256: action === "confirmed" ? (opts.sha ?? sha(TEXT)) : null,
            reason: null,
            created_at: stamp(),
        });
}
const itemsOf = (res: request.Response) => res.body.items as { key: string; type: string; bucket: string; due_on: string | null; state: string; days_left: number | null }[];
const keyOf = (factId: string, type: string) => `${factId}:${type}`;
const act = (action: "ack" | "dismiss" | "done", key: string, body?: unknown, path = base) =>
    request(app).post(`${path}/items/${encodeURIComponent(key)}/${action}`).send(body as object | undefined);

beforeEach(() => {
    ticks = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z")); // 12:00 in Mexico City
    h.texts = { [VERSION]: TEXT, [VERSION_2]: TEXT, [GONE_VERSION]: TEXT, [SECOND_VERSION]: TEXT };
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
            { org_id: ORG, user_id: REMOVED, role: "member" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
            { org_id: OTHER_ORG, user_id: OWNER, role: "member" },
        ],
        workspaces: [
            { id: WORKSPACE, organization_id: ORG },
            { id: OTHER_WORKSPACE, organization_id: OTHER_ORG },
        ],
        matters: [
            { id: MATTER, project_id: PROJECT, workspace_id: WORKSPACE, name: "Patito · Iguala 2026", is_retainer: true, visibility: "private" },
            { id: PLAIN_MATTER, project_id: PLAIN_PROJECT, workspace_id: WORKSPACE, name: "Juicio", is_retainer: false, visibility: "private" },
            { id: PUBLIC_MATTER, project_id: PUBLIC_PROJECT, workspace_id: WORKSPACE, name: "Pública", is_retainer: true, visibility: "public" },
            { id: SECOND_MATTER, project_id: SECOND_PROJECT, workspace_id: WORKSPACE, name: "Mapache · Iguala", is_retainer: true, visibility: "private" },
            { id: FOREIGN_MATTER, project_id: FOREIGN_PROJECT, workspace_id: OTHER_WORKSPACE, name: "Otro despacho", is_retainer: true, visibility: "private" },
        ],
        matter_memberships: [
            ...[OWNER, EDITOR, VIEWER, TECH].map((user_id) => ({
                matter_id: MATTER,
                user_id,
                status: "active",
                role: { [OWNER]: "matter_owner", [VIEWER]: "viewer", [TECH]: "technical_operator" }[user_id] ?? "editor",
            })),
            { matter_id: MATTER, user_id: REMOVED, status: "revoked", role: "editor" },
            { matter_id: PLAIN_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: PUBLIC_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: SECOND_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: FOREIGN_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: FOREIGN_MATTER, user_id: OUTSIDER, status: "active", role: "matter_owner" },
        ],
        documents: [
            { id: DOC, project_id: PROJECT, archived_at: null },
            { id: DOC_2, project_id: SECOND_PROJECT, archived_at: null },
        ],
        document_versions: [
            { id: VERSION, document_id: DOC, version_number: 1, filename: "contrato.docx", deleted_at: null },
            { id: VERSION_2, document_id: DOC, version_number: 2, filename: "contrato-2.docx", deleted_at: null },
            { id: GONE_VERSION, document_id: DOC, version_number: 3, filename: "borrado.docx", deleted_at: "2026-11-01T00:00:00Z" },
            { id: SECOND_VERSION, document_id: DOC_2, version_number: 1, filename: "otro.docx", deleted_at: null },
        ],
        user_profiles: [{ user_id: EDITOR, display_name: "Elena Editora", email: "elena@example.test" }],
        matter_profile_facts: [],
        matter_profile_fact_events: [],
        matter_radar_item_events: [],
    }, {}, { maxRows: 1000 });
    const confirmed = ["confirmed"];
    seedFact(FACTS.expiry, MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-12-31", notice_days: 30, notice_day_type: "calendar" }, { actions: confirmed, label: "Vigencia del arrendamiento" });
    seedFact(FACTS.overdue, MATTER, VERSION, "date", { date_kind: "renewal_notice", date_on: "2026-11-10" }, { actions: confirmed });
    seedFact(FACTS.business, MATTER, VERSION, "date", { date_kind: "renewal_notice", date_on: "2027-06-30", notice_days: 10, notice_day_type: "business" }, { actions: confirmed });
    seedFact(FACTS.pending, MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-11-20" });
    seedFact(FACTS.rejected, MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-11-21" }, { actions: ["rejected"] });
    seedFact(FACTS.changed, MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-11-22" }, { actions: confirmed, sha: sha("otro texto") });
    seedFact(FACTS.poa, MATTER, VERSION_2, "power_of_attorney", { grantee: "Ana", scope: "Actos", expires_on: "2028-02-29" }, { actions: confirmed });
    seedFact(FACTS.gone, MATTER, GONE_VERSION, "date", { date_kind: "expiry", date_on: "2026-11-23" }, { actions: confirmed });
    seedFact(FACTS.noData, MATTER, VERSION, "date", { date_kind: "renewal_notice", notice_days: 30 }, { actions: confirmed });
    seedFact(FACTS.second, SECOND_MATTER, SECOND_VERSION, "date", { date_kind: "renewal_notice", date_on: "2026-11-20" }, { actions: confirmed, label: "Renovación Mapache" });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the radar is computed from confirmed, not stale facts", () => {
    it("lists items by date with their bucket, the review ones last", async () => {
        as(OWNER);
        const res = await request(app).get(base);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ retainer: true, can_write: true, today: "2026-11-16", time_zone: "America/Mexico_City" });
        expect(itemsOf(res).map((item) => [item.key, item.due_on, item.bucket, item.days_left])).toEqual([
            [keyOf(FACTS.overdue, "notice"), "2026-11-10", "overdue", -6],
            [keyOf(FACTS.expiry, "notice"), "2026-12-01", "next_30", 15],
            [keyOf(FACTS.expiry, "expiry"), "2026-12-31", "later", 45],
            [keyOf(FACTS.poa, "power_expiry"), "2028-02-29", "later", 470],
            [keyOf(FACTS.business, "notice"), null, "review", null],
            [keyOf(FACTS.noData, "notice"), null, "review", null],
        ]);
        const notice = res.body.items.find((item: { key: string }) => item.key === keyOf(FACTS.expiry, "notice"));
        expect(notice).toMatchObject({
            label: "Vigencia del arrendamiento",
            base_on: "2026-12-31",
            notice_days: 30,
            state: "open",
            review_reason: null,
            source: { version_id: VERSION, version_number: 1, filename: "contrato.docx", quote: "CLÁUSULA" },
        });
        const review = res.body.items.find((item: { key: string }) => item.key === keyOf(FACTS.business, "notice"));
        expect(review).toMatchObject({ review_reason: "business_days", due_on: null, notice_days: 10 });
        expect(res.body.items.find((item: { key: string }) => item.key === keyOf(FACTS.noData, "notice"))).toMatchObject({
            review_reason: "missing_date",
            due_on: null,
        });
    });

    it("leaves out pending, rejected, changed and gone facts", async () => {
        as(OWNER);
        const keys = itemsOf(await request(app).get(base)).map((item) => item.key);
        for (const fact of [FACTS.pending, FACTS.rejected, FACTS.changed, FACTS.gone])
            expect(keys.some((key) => key.startsWith(fact))).toBe(false);
    });

    it("recomputes when a fact is confirmed, rejected or goes stale", async () => {
        as(EDITOR);
        const has = async (fact: string) => itemsOf(await request(app).get(base)).some((item) => item.key.startsWith(fact));
        expect(await has(FACTS.pending)).toBe(false);
        // Confirmed through the profile's own route: the item appears.
        const confirm = await request(app).post(`/projects/${PROJECT}/matters/${MATTER}/profile/facts/${FACTS.pending}/confirm`).send({});
        expect(confirm.status).toBe(200);
        expect(await has(FACTS.pending)).toBe(true);
        // The cited text changes: the item goes away; the old text comes back: so does the item.
        h.texts[VERSION] = "Otro texto distinto.";
        expect(await has(FACTS.pending)).toBe(false);
        expect(await has(FACTS.expiry)).toBe(false);
        h.texts[VERSION] = TEXT;
        expect(await has(FACTS.pending)).toBe(true);
        // Rejected: gone for good.
        const reject = await request(app).post(`/projects/${PROJECT}/matters/${MATTER}/profile/facts/${FACTS.pending}/reject`).send({});
        expect(reject.status).toBe(200);
        expect(await has(FACTS.pending)).toBe(false);
        // The version is deleted: stale.
        tables().document_versions.find((row) => row.id === VERSION_2)!.deleted_at = "2026-11-15T00:00:00Z";
        expect(await has(FACTS.poa)).toBe(false);
    });

    it("follows the day in Mexico City, not UTC", async () => {
        as(OWNER);
        const when = async (iso: string) => {
            vi.setSystemTime(new Date(iso));
            const res = await request(app).get(base);
            return [res.body.today, itemsOf(res).find((item) => item.key === keyOf(FACTS.overdue, "notice"))!.days_left];
        };
        expect(await when("2026-11-17T05:59:00Z")).toEqual(["2026-11-16", -6]);
        expect(await when("2026-11-17T06:00:00Z")).toEqual(["2026-11-17", -7]);
    });

    it("puts the exact day in the next window and the day after in overdue", async () => {
        as(OWNER);
        seedFact(id(320), MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-11-16" }, { actions: ["confirmed"] });
        const find = async () => itemsOf(await request(app).get(base)).find((item) => item.key === keyOf(id(320), "expiry"))!;
        expect(await find()).toMatchObject({ bucket: "next_30", days_left: 0 });
        vi.setSystemTime(new Date("2026-11-17T18:00:00Z"));
        expect(await find()).toMatchObject({ bucket: "overdue", days_left: -1 });
    });

    it("answers an empty radar for a matter that is not a private retainer", async () => {
        as(OWNER);
        for (const [project, matter] of [[PLAIN_PROJECT, PLAIN_MATTER], [PUBLIC_PROJECT, PUBLIC_MATTER]]) {
            const res = await request(app).get(`/projects/${project}/matters/${matter}/radar`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ retainer: false, can_write: false, items: [] });
        }
    });
});

describe("who can read and act (permission matrix)", () => {
    it.each([
        ["owner", OWNER, 200, true],
        ["editor", EDITOR, 200, true],
        ["viewer", VIEWER, 200, false],
        ["technical operator", TECH, 200, false],
        ["org member outside the matter", STRANGER, 404, null],
        ["org admin without membership", ORG_ADMIN, 404, null],
        ["person of another firm", OUTSIDER, 404, null],
        ["removed member", REMOVED, 404, null],
    ])("%s reads", async (_name, user, status, canWrite) => {
        as(user);
        const res = await request(app).get(base);
        expect(res.status).toBe(status);
        if (status === 200) expect(res.body.can_write).toBe(canWrite);
    });

    it("refuses a malformed project or matter id with 404", async () => {
        as(OWNER);
        expect((await request(app).get(`/projects/nope/matters/${MATTER}/radar`)).status).toBe(404);
        expect((await request(app).get(`/projects/${PROJECT}/matters/nope/radar`)).status).toBe(404);
    });

    it.each([
        ["viewer", VIEWER, 403],
        ["technical operator", TECH, 403],
        ["org admin without membership", ORG_ADMIN, 404],
        ["stranger", STRANGER, 404],
        ["removed member", REMOVED, 404],
        ["owner", OWNER, 200],
        ["editor", EDITOR, 200],
    ])("%s acknowledging", async (_name, user, status) => {
        as(user);
        const res = await act("ack", keyOf(FACTS.expiry, "expiry"));
        expect(res.status).toBe(status);
        if (status === 403) expect(res.body.code).toBe("matter_write_required");
        expect(tables().matter_radar_item_events).toHaveLength(status === 200 ? 1 : 0);
    });
});

describe("ack, dismiss and done", () => {
    const key = keyOf(FACTS.expiry, "notice");

    it("records an acknowledgement as an event and keeps the item open", async () => {
        as(EDITOR);
        const res = await act("ack", key);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ key, state: "acknowledged", acted_by: EDITOR, bucket: "next_30" });
        expect(tables().matter_radar_item_events).toEqual([
            expect.objectContaining({ matter_id: MATTER, fact_id: FACTS.expiry, item_type: "notice", action: "ack", due_on: "2026-12-01", reason: null, actor_user_id: EDITOR }),
        ]);
        const radar = await request(app).get(base);
        expect(radar.body.people).toEqual([{ user_id: EDITOR, name: "Elena Editora" }]);
    });

    it("requires a reason to dismiss, and keeps it", async () => {
        as(EDITOR);
        for (const body of [undefined, {}, { reason: "" }, { reason: "   " }, { reason: null }]) {
            const res = await act("dismiss", key, body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.body.code).toBe("radar_reason_required");
        }
        expect(tables().matter_radar_item_events).toHaveLength(0);
        const ok = await act("dismiss", key, { reason: "  El cliente ya renovó  " });
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ state: "dismissed", reason: "El cliente ya renovó" });
        expect(tables().matter_radar_item_events[0]).toMatchObject({ action: "dismiss", reason: "El cliente ya renovó" });
    });

    it("refuses a malformed body or reason with 400 invalid_radar_action", async () => {
        as(EDITOR);
        for (const body of [{ reason: 5 }, { reason: "x".repeat(501) }, []]) {
            const res = await act("done", key, body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.body.code).toBe("invalid_radar_action");
        }
        expect(tables().matter_radar_item_events).toHaveLength(0);
    });

    it("marks done, with or without a note, from open or acknowledged", async () => {
        as(OWNER);
        expect((await act("done", key)).body).toMatchObject({ state: "done" });
        expect((await act("ack", keyOf(FACTS.expiry, "expiry"))).status).toBe(200);
        const done = await act("done", keyOf(FACTS.expiry, "expiry"), { reason: "Aviso enviado" });
        expect(done.body).toMatchObject({ state: "done", reason: null });
        expect(tables().matter_radar_item_events.map((row) => row.action)).toEqual(["done", "ack", "done"]);
    });

    it("a closed item takes no more actions (409), nor does a second acknowledgement", async () => {
        as(EDITOR);
        expect((await act("ack", key)).status).toBe(200);
        const again = await act("ack", key);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("radar_item_closed");
        expect((await act("dismiss", key, { reason: "x" })).status).toBe(200);
        for (const action of ["ack", "done", "dismiss"] as const) {
            const res = await act(action, key, { reason: "otra vez" });
            expect(res.status, action).toBe(409);
            expect(res.body.code).toBe("radar_item_closed");
        }
        expect(tables().matter_radar_item_events).toHaveLength(2);
    });

    it("turns the database's refusal of a race into 409", async () => {
        as(EDITOR);
        h.state!.failNext("matter_radar_item_events", "insert", { code: "23514", message: "does not follow" });
        const res = await act("done", key);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("radar_item_closed");
    });

    it("never reports success when the event row is lost", async () => {
        as(EDITOR);
        h.state!.failNext("matter_radar_item_events", "insert", { message: "down" });
        const res = await act("done", key);
        expect(res.status).toBe(500);
        expect(tables().matter_radar_item_events).toHaveLength(0);
        expect(itemsOf(await request(app).get(base)).find((item) => item.key === key)!.state).toBe("open");
    });

    it("lets a review item be dismissed, recording no date", async () => {
        as(EDITOR);
        const review = keyOf(FACTS.business, "notice");
        const res = await act("dismiss", review, { reason: "Lo revisa el socio" });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ state: "dismissed", due_on: null });
        expect(tables().matter_radar_item_events[0].due_on).toBeNull();
    });

    it("404s an item that is not on the radar: unknown, malformed, or of a fact that does not count", async () => {
        as(EDITOR);
        for (const bad of [
            keyOf(FACTS.pending, "expiry"),
            keyOf(FACTS.changed, "expiry"),
            keyOf(FACTS.expiry, "power_expiry"),
            keyOf(id(999), "expiry"),
            "nope",
            `${FACTS.expiry}:other`,
        ]) {
            const res = await act("done", bad);
            expect(res.status, bad).toBe(404);
        }
        expect(tables().matter_radar_item_events).toHaveLength(0);
    });

    it("409s on a matter that is not a retainer", async () => {
        as(OWNER);
        const res = await act("ack", keyOf(FACTS.expiry, "expiry"), undefined, `/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/radar`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("matter_not_retainer");
    });

    it("an action recorded against another date is ignored: the item starts over", async () => {
        as(EDITOR);
        tables().matter_radar_item_events.push({
            id: id(8000), matter_id: MATTER, fact_id: FACTS.expiry, item_type: "notice", action: "done",
            due_on: "2026-11-30", reason: null, actor_user_id: EDITOR, created_at: "2026-11-02T00:00:00Z",
        });
        expect(itemsOf(await request(app).get(base)).find((item) => item.key === key)!.state).toBe("open");
    });
    it("reads every event past PostgREST's max_rows, so the newest action counts", async () => {
        as(EDITOR);
        // 1,100 earlier acknowledgements of another item fill the first page;
        // the action that closes the expiry notice is the newest event.
        for (let n = 0; n < 1100; n++)
            tables().matter_radar_item_events.push({
                id: id(20000 + n), matter_id: MATTER, fact_id: FACTS.overdue, item_type: "notice", action: "ack",
                due_on: "2026-11-10", reason: null, actor_user_id: EDITOR, created_at: "2026-11-02T00:00:00Z",
            });
        tables().matter_radar_item_events.push({
            id: id(8000), matter_id: MATTER, fact_id: FACTS.expiry, item_type: "notice", action: "done",
            due_on: "2026-12-01", reason: null, actor_user_id: EDITOR, created_at: "2026-11-03T00:00:00Z",
        });
        const items = itemsOf(await request(app).get(base));
        expect(items.find((item) => item.key === key)!.state).toBe("done");
        expect(items.find((item) => item.key === keyOf(FACTS.overdue, "notice"))!.state).toBe("acknowledged");
    });
});

describe("today", () => {
    const today = `/orgs/${ORG}/radar/today`;

    it("lists the open items of every matter where I am a member, by date", async () => {
        as(OWNER);
        const res = await request(app).get(today);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ today: "2026-11-16", time_zone: "America/Mexico_City", truncated: false });
        expect(res.body.items.map((item: { key: string; due_on: string | null }) => [item.key, item.due_on])).toEqual([
            [keyOf(FACTS.overdue, "notice"), "2026-11-10"],
            [keyOf(FACTS.second, "notice"), "2026-11-20"],
            [keyOf(FACTS.expiry, "notice"), "2026-12-01"],
            [keyOf(FACTS.business, "notice"), null],
            [keyOf(FACTS.noData, "notice"), null],
        ]);
        expect(res.body.items[1]).toMatchObject({ project_id: SECOND_PROJECT, matter_id: SECOND_MATTER, matter_name: "Mapache · Iguala", label: "Renovación Mapache" });
    });

    it("leaves out later items, closed ones and matters of other firms or public/plain matters", async () => {
        as(OWNER);
        await act("done", keyOf(FACTS.overdue, "notice"));
        await act("ack", keyOf(FACTS.expiry, "notice"));
        const res = await request(app).get(today);
        const keys = res.body.items.map((item: { key: string }) => item.key);
        expect(keys).not.toContain(keyOf(FACTS.overdue, "notice"));
        expect(keys).not.toContain(keyOf(FACTS.expiry, "expiry")); // 45 days away
        expect(keys).not.toContain(keyOf(FACTS.poa, "power_expiry"));
        // Acknowledged is still open.
        expect(res.body.items.find((item: { key: string }) => item.key === keyOf(FACTS.expiry, "notice"))).toMatchObject({ state: "acknowledged" });
        // Dismissing takes it off too.
        await act("dismiss", keyOf(FACTS.second, "notice"), { reason: "No aplica" }, `/projects/${SECOND_PROJECT}/matters/${SECOND_MATTER}/radar`);
        const after = await request(app).get(today);
        expect(after.body.items.map((item: { key: string }) => item.key)).not.toContain(keyOf(FACTS.second, "notice"));
    });

    it("shows a member only the matters they belong to", async () => {
        as(EDITOR);
        const res = await request(app).get(today);
        expect(res.status).toBe(200);
        expect(res.body.items.every((item: { matter_id: string }) => item.matter_id === MATTER)).toBe(true);
        expect(res.body.items).toHaveLength(4);
        as(VIEWER);
        expect((await request(app).get(today)).body.items).toHaveLength(4);
    });

    it("shows nothing to an org admin or a member who belongs to no matter, and nothing after leaving", async () => {
        for (const user of [ORG_ADMIN, STRANGER, REMOVED]) {
            as(user);
            const res = await request(app).get(today);
            expect(res.status, user).toBe(200);
            expect(res.body.items, user).toEqual([]);
        }
        as(EDITOR);
        tables().matter_memberships.find((row) => row.matter_id === MATTER && row.user_id === EDITOR)!.status = "revoked";
        expect((await request(app).get(today)).body.items).toEqual([]);
    });

    it("keeps each firm to its own matters, and answers 404 to someone outside the firm", async () => {
        as(OUTSIDER);
        expect((await request(app).get(today)).status).toBe(404);
        const own = await request(app).get(`/orgs/${OTHER_ORG}/radar/today`);
        expect(own.status).toBe(200);
        expect(own.body.items).toEqual([]);
        // OWNER belongs to both firms; the other firm's matter has no confirmed facts here.
        as(OWNER);
        const other = await request(app).get(`/orgs/${OTHER_ORG}/radar/today`);
        expect(other.status).toBe(200);
        expect(other.body.items).toEqual([]);
        expect((await request(app).get(`/orgs/nope/radar/today`)).status).toBe(404);
    });

    it("says when matters were left out beyond the cap", async () => {
        as(OWNER);
        for (let n = 0; n < 52; n++) {
            const matter = id(5000 + n);
            const project = id(6000 + n);
            tables().matters.push({ id: matter, project_id: project, workspace_id: WORKSPACE, name: `M${n}`, is_retainer: true, visibility: "private" });
            tables().matter_memberships.push({ matter_id: matter, user_id: OWNER, status: "active", role: "matter_owner" });
        }
        const res = await request(app).get(today);
        expect(res.status).toBe(200);
        expect(res.body.truncated).toBe(true);
    });

    it("reads memberships past max_rows and still reports the cap truthfully", async () => {
        as(OWNER);
        // 1,100 memberships whose matters sort before the real one fill the first page.
        for (let n = 0; n < 1100; n++)
            tables().matter_memberships.push({ matter_id: id(10000 + n), user_id: OWNER, status: "active", role: "matter_owner" });
        const late = id(90000);
        tables().matters.push({ id: late, project_id: id(90001), workspace_id: WORKSPACE, name: "Tardía", is_retainer: true, visibility: "private" });
        tables().matter_memberships.push({ matter_id: late, user_id: OWNER, status: "active", role: "matter_owner" });
        tables().documents.push({ id: id(90003), project_id: id(90001), archived_at: null });
        tables().document_versions.push({ id: id(90004), document_id: id(90003), version_number: 1, filename: "tardio.docx", deleted_at: null });
        h.texts[id(90004)] = TEXT;
        seedFact(id(90002), late, id(90004), "date", { date_kind: "renewal_notice", date_on: "2026-11-18" }, { actions: ["confirmed"], label: "Dato tardío" });
        const res = await request(app).get(today);
        expect(res.status).toBe(200);
        expect(res.body.truncated).toBe(false);
        expect(res.body.items.some((item: { matter_id: string }) => item.matter_id === late)).toBe(true);
    });

    it("counts today from the Mexico City day", async () => {
        as(OWNER);
        seedFact(id(321), MATTER, VERSION, "date", { date_kind: "expiry", date_on: "2026-11-16" }, { actions: ["confirmed"] });
        const keys = async () => (await request(app).get(today)).body.items.map((item: { key: string; bucket: string }) => [item.key, item.bucket]);
        vi.setSystemTime(new Date("2026-11-17T05:59:00Z"));
        expect(await keys()).toContainEqual([keyOf(id(321), "expiry"), "next_30"]);
        vi.setSystemTime(new Date("2026-11-17T06:00:00Z"));
        expect(await keys()).toContainEqual([keyOf(id(321), "expiry"), "overdue"]);
    });

    it("fails with 500 when the database does", async () => {
        as(OWNER);
        h.state!.failNext("matter_memberships", "select", { message: "down" });
        expect((await request(app).get(today)).status).toBe(500);
    });
});
