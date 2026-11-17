import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Row } from "../helpers/memoryDb";
import type { ObligationRuleDef } from "../../modules/radar/radar.rules";

// The obligation rules of a retainer matter over HTTP, against an in-memory
// database and a catalog of FIXTURE rules (the shipped catalog is empty until
// legal verifies the first rules): who may read and who may turn rules on or
// off, that an unverified rule is refused, and that active verified rules feed
// the radar as `obligation_due` items computed on read, with the same actions
// (ack, dismiss, done) as the other items. Constraints, privileges and RLS are
// covered against PostgreSQL in radarRules.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    catalog: [] as unknown[],
    texts: {} as Record<string, string | null>,
    state: null as null | { db: any; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
    stamp: 0,
}));
vi.mock("../../modules/radar/radar.rules.catalog", () => ({ OBLIGATION_RULES: h.catalog }));
vi.mock("../../lib/supabase", () => ({
    // Rows get a created_at, as the database's default would give them.
    createServerSupabase: vi.fn(() => ({
        ...h.state!.db,
        from: (table: string) => {
            const builder = h.state!.db.from(table);
            const insert = builder.insert.bind(builder);
            builder.insert = (payload: Row) => insert({ created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, h.stamp++)).toISOString(), ...payload });
            return builder;
        },
    })),
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
const PROJECT = id(120);
const PLAIN_PROJECT = id(122);
const MATTER = id(130);
const PLAIN_MATTER = id(131);
const OWNER = id(1);
const EDITOR = id(2);
const VIEWER = id(3);
const TECH = id(4);
const STRANGER = id(5);
const ORG_ADMIN = id(6);
const OUTSIDER = id(7);
const REMOVED = id(9);
const DOC = id(200);
const VERSION = id(210);
const EXPIRY = id(301); // expiry 2026-12-31
const RENEWAL = id(302); // renewal notice 2026-11-10
const RENEWAL_NO_DATE = id(303); // renewal notice, no date
const POA = id(304); // power of attorney expiring 2028-02-29
const CHANGED = id(305); // confirmed, but its text changed
const PENDING = id(306);

const TEXT = "CLÁUSULA SEGUNDA. La vigencia vence el 31 de diciembre de 2026.";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const citation = { sourceCode: "LEY", law: "Ley de ejemplo", location: "Artículo 1", text: "Texto de ejemplo.", url: "https://example.gob.mx/ley", lastReform: "DOF 20-10-2023" };
const verified = { status: "verified", verifiedBy: "socium-legal", verifiedOn: "2026-11-17" } as const;
const fixture = (over: Partial<ObligationRuleDef> & Pick<ObligationRuleDef, "code">): ObligationRuleDef => ({
    version: 1,
    nameKey: "radar.rules.title",
    appliesWhenKey: "radar.rules.description",
    anchorKey: "radar.rules.countsFrom",
    anchorName: "fecha_ejemplo",
    kind: "deadline",
    milestones: [{ kind: "due", ops: [{ unit: "months", amount: -1 }] }],
    requiresBusinessDays: false,
    citations: [citation],
    notes: "Nota de ejemplo.",
    consultedOn: "2026-11-17",
    verification: verified,
    ...over,
});
const RULES = {
    // 2026-12-31 minus 1 month: 2026-11-30.
    monthBefore: fixture({ code: "contract.month_before" }),
    // A window: opens the day after the date and closes 30 days after it.
    window: fixture({
        code: "poa.window",
        kind: "window",
        milestones: [{ kind: "opens", ops: [{ unit: "days", amount: 1 }] }, { kind: "closes", ops: [{ unit: "days", amount: 30 }] }],
    }),
    business: fixture({ code: "contract.business", milestones: [{ kind: "due", ops: [{ unit: "business_days", amount: -5 }] }], requiresBusinessDays: true }),
    // Counts from the grant date when asked: + 10 years first, then 6 months back.
    firstCycle: fixture({ code: "contract.first_cycle", firstCycle: { from: "fecha_otorgamiento_registro", ops: [{ unit: "years", amount: 10 }], onlyIf: "otorgado desde 2018-08-10" } }),
    draft: fixture({ code: "contract.draft", verification: { status: "unverified" } }),
};
const key = (rule: ObligationRuleDef) => `${rule.code}@${rule.version}`;

const base = `/projects/${PROJECT}/matters/${MATTER}/radar`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const rulesOf = (res: request.Response) => res.body.rules as { key: string; active: boolean; verification: { status: string } }[];
const ON = { anchor_fact_id: EXPIRY };
const NO_BODY = Symbol("no body");
const turn = (rule: ObligationRuleDef | string, on: boolean, body: unknown = on ? ON : NO_BODY, path = base) =>
    request(app)
        .post(`${path}/rules/${encodeURIComponent(typeof rule === "string" ? rule : key(rule))}/${on ? "activate" : "deactivate"}`)
        .send(body === NO_BODY ? undefined : (body as object));
const items = async () => (await request(app).get(base)).body.items as Array<Record<string, any>>;
const obligations = async () => (await items()).filter((item) => item.type === "obligation_due");
const act = (action: "ack" | "dismiss" | "done", itemKey: string, body?: unknown) =>
    request(app).post(`${base}/items/${encodeURIComponent(itemKey)}/${action}`).send(body as object | undefined);

let ticks = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, 0, ticks++)).toISOString();
function seedFact(factId: string, kind: string, data: Record<string, unknown>, opts: { confirmed?: boolean; sha?: string; label?: string } = {}) {
    tables().matter_profile_facts.push({
        id: factId, matter_id: MATTER, kind, label: opts.label ?? `Dato ${factId.slice(-3)}`, data,
        document_id: DOC, version_id: VERSION, start_char: 0, end_char: 10, quote: "CLÁUSULA",
        text_sha256: opts.sha ?? sha(TEXT), created_by: EDITOR, created_at: stamp(),
    });
    for (const action of ["created", ...(opts.confirmed === false ? [] : ["confirmed"])])
        tables().matter_profile_fact_events.push({
            id: id(9000 + tables().matter_profile_fact_events.length), fact_id: factId, matter_id: MATTER, actor_user_id: EDITOR,
            action, text_sha256: action === "confirmed" ? (opts.sha ?? sha(TEXT)) : null, reason: null, created_at: stamp(),
        });
}

beforeEach(() => {
    ticks = 0;
    h.stamp = 0;
    h.catalog.splice(0, h.catalog.length, ...Object.values(RULES));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    h.texts = { [VERSION]: TEXT };
    h.state = memoryDb({
        organizations: [{ id: ORG, kind: "team" }, { id: OTHER_ORG, kind: "team" }],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" }, { org_id: ORG, user_id: EDITOR, role: "member" },
            { org_id: ORG, user_id: VIEWER, role: "member" }, { org_id: ORG, user_id: TECH, role: "member" },
            { org_id: ORG, user_id: STRANGER, role: "member" }, { org_id: ORG, user_id: ORG_ADMIN, role: "admin" },
            { org_id: ORG, user_id: REMOVED, role: "member" }, { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
        ],
        workspaces: [{ id: WORKSPACE, organization_id: ORG }],
        matters: [
            { id: MATTER, project_id: PROJECT, workspace_id: WORKSPACE, name: "Patito · Iguala 2026", is_retainer: true, visibility: "private" },
            { id: PLAIN_MATTER, project_id: PLAIN_PROJECT, workspace_id: WORKSPACE, name: "Juicio", is_retainer: false, visibility: "private" },
        ],
        matter_memberships: [
            ...[OWNER, EDITOR, VIEWER, TECH].map((user_id) => ({
                matter_id: MATTER, user_id, status: "active",
                role: { [OWNER]: "matter_owner", [VIEWER]: "viewer", [TECH]: "technical_operator" }[user_id] ?? "editor",
            })),
            { matter_id: MATTER, user_id: REMOVED, status: "revoked", role: "editor" },
            { matter_id: PLAIN_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
        ],
        documents: [{ id: DOC, project_id: PROJECT, archived_at: null }],
        document_versions: [{ id: VERSION, document_id: DOC, version_number: 1, filename: "contrato.docx", deleted_at: null }],
        user_profiles: [{ user_id: EDITOR, display_name: "Elena Editora", email: "elena@example.test" }],
        matter_profile_facts: [], matter_profile_fact_events: [], matter_radar_item_events: [],
        matter_obligation_rule_events: [], matter_obligation_item_events: [],
    }, {}, { maxRows: 1000 });
    seedFact(EXPIRY, "date", { date_kind: "expiry", date_on: "2026-12-31" }, { label: "Vigencia del arrendamiento" });
    seedFact(RENEWAL, "date", { date_kind: "renewal_notice", date_on: "2026-11-10" });
    seedFact(RENEWAL_NO_DATE, "date", { date_kind: "renewal_notice", notice_days: 30 });
    seedFact(POA, "power_of_attorney", { grantee: "Ana", scope: "Actos", expires_on: "2028-02-29" });
    seedFact(CHANGED, "date", { date_kind: "expiry", date_on: "2026-11-22" }, { sha: sha("otro texto") });
    seedFact(PENDING, "date", { date_kind: "expiry", date_on: "2026-11-21" }, { confirmed: false });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("who reads and who decides", () => {
    it("lists the whole catalog, with the verification of each rule, to every active member", async () => {
        for (const user of [OWNER, EDITOR, VIEWER, TECH]) {
            as(user);
            const res = await request(app).get(`${base}/rules`);
            expect(res.status, user).toBe(200);
            expect(res.body).toMatchObject({ retainer: true, can_write: user === OWNER || user === EDITOR });
            expect(rulesOf(res).map((rule) => [rule.key, rule.active, rule.verification.status])).toEqual([
                ["contract.month_before@1", false, "verified"],
                ["poa.window@1", false, "verified"],
                ["contract.business@1", false, "verified"],
                ["contract.first_cycle@1", false, "verified"],
                ["contract.draft@1", false, "unverified"],
            ]);
        }
        const rule = rulesOf(await request(app).get(`${base}/rules`))[0] as Record<string, any>;
        expect(rule).toMatchObject({
            code: "contract.month_before", version: 1, name_key: "radar.rules.title", applies_when_key: "radar.rules.description", anchor_key: "radar.rules.countsFrom",
            kind: "deadline", first_cycle: null, requires_business_days: false, notes: "Nota de ejemplo.", consulted_on: "2026-11-17", anchor: null,
            milestones: [{ kind: "due", ops: [{ unit: "months", amount: -1 }] }],
            citations: [{ source_code: "LEY", law: "Ley de ejemplo", location: "Artículo 1", text: "Texto de ejemplo.", url: "https://example.gob.mx/ley", last_reform: "DOF 20-10-2023" }],
            verification: { status: "verified", verified_by: "socium-legal", verified_on: "2026-11-17" },
        });
        const cycle = rulesOf(await request(app).get(`${base}/rules`))[3] as Record<string, any>;
        expect(cycle.first_cycle).toEqual({ from: "fecha_otorgamiento_registro", ops: [{ unit: "years", amount: 10 }], only_if: "otorgado desde 2018-08-10", cap_years: null });
    });

    it("offers as anchors only the confirmed, not stale facts that have a date", async () => {
        as(VIEWER);
        const res = await request(app).get(`${base}/rules`);
        expect(res.body.anchor_choices).toEqual([
            { fact_id: RENEWAL, label: `Dato ${RENEWAL.slice(-3)}`, date_on: "2026-11-10", date_kind: "renewal_notice" },
            { fact_id: EXPIRY, label: "Vigencia del arrendamiento", date_on: "2026-12-31", date_kind: "expiry" },
        ]);
    });

    it("gives 404 to everybody who is not an active member of the matter, admins included", async () => {
        for (const user of [ORG_ADMIN, STRANGER, OUTSIDER, REMOVED]) {
            as(user);
            expect((await request(app).get(`${base}/rules`)).status, `read ${user}`).toBe(404);
            expect((await turn(RULES.monthBefore, true)).status, `on ${user}`).toBe(404);
            expect((await turn(RULES.monthBefore, false)).status, `off ${user}`).toBe(404);
        }
        expect(tables().matter_obligation_rule_events).toEqual([]);
    });

    it("lets the owner and the editor turn a rule on and off; viewers and technical operators cannot", async () => {
        for (const user of [VIEWER, TECH]) {
            as(user);
            expect((await turn(RULES.monthBefore, true)).status, user).toBe(403);
        }
        expect(tables().matter_obligation_rule_events).toEqual([]);
        for (const user of [OWNER, EDITOR]) {
            as(user);
            const on = await turn(RULES.monthBefore, true);
            expect(on.status, user).toBe(200);
            expect(on.body).toMatchObject({ key: "contract.month_before@1", active: true, changed_by: user, anchor: { fact_id: EXPIRY, mode: "direct" } });
            const off = await turn(RULES.monthBefore, false);
            expect(off.body).toMatchObject({ active: false, changed_by: user, anchor: null });
        }
        as(VIEWER);
        expect((await turn(RULES.monthBefore, false)).status).toBe(403);
    });

    it("names who changed a rule", async () => {
        as(EDITOR);
        await turn(RULES.monthBefore, true);
        as(VIEWER);
        const res = await request(app).get(`${base}/rules`);
        expect(res.body.people).toEqual([{ user_id: EDITOR, name: "Elena Editora" }]);
        expect(rulesOf(res)[0]).toMatchObject({ active: true, changed_by: EDITOR });
    });

    it("answers a matter that is not a retainer with no rules, and refuses to change them", async () => {
        as(OWNER);
        const path = `/projects/${PLAIN_PROJECT}/matters/${PLAIN_MATTER}/radar`;
        expect((await request(app).get(`${path}/rules`)).body).toEqual({ retainer: false, can_write: false, rules: [], anchor_choices: [], people: [] });
        const res = await turn(RULES.monthBefore, true, ON, path);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("matter_not_retainer");
    });
});

describe("a rule nobody verified cannot be turned on", () => {
    it("refuses it with 409 obligation_rule_unverified and records nothing", async () => {
        as(OWNER);
        const res = await turn(RULES.draft, true);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("obligation_rule_unverified");
        expect(tables().matter_obligation_rule_events).toEqual([]);
        // Turning an unverified rule off is harmless.
        expect((await turn(RULES.draft, false)).status).toBe(200);
        expect(tables().matter_obligation_rule_events).toEqual([]);
    });

    it("refuses a verified rule that is not sound (no citations) as it does an unverified one", async () => {
        h.catalog.push(fixture({ code: "contract.broken", citations: [] }));
        as(OWNER);
        const res = await turn("contract.broken@1", true);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("obligation_rule_unverified");
    });

    it("answers 404 for a rule that is not in the catalog, a version that is not, or a key that is not one", async () => {
        as(OWNER);
        for (const name of ["contract.nothing@1", "contract.month_before@2", "contract.month_before", "../x", "contract.month_before@0"])
            expect((await turn(name, true)).status, name).toBe(404);
    });

    it("stops a rule that was on when it stops being verified: it is off and yields no items", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        expect(await obligations()).toHaveLength(1);
        h.catalog[0] = { ...RULES.monthBefore, verification: { status: "unverified" } };
        expect(await obligations()).toEqual([]);
        const listed = rulesOf(await request(app).get(`${base}/rules`))[0];
        expect(listed).toMatchObject({ active: false, verification: { status: "unverified" }, anchor: null });
        // It can still be turned off.
        expect((await turn("contract.month_before@1", false)).status).toBe(200);
    });
});

describe("naming the date a rule counts from", () => {
    it("is required: a body without it, a malformed one or a way of counting the rule does not have is a 400", async () => {
        as(OWNER);
        const bad: [unknown, string][] = [
            [NO_BODY, "no body"],
            [{}, "empty"],
            [{ anchor_fact_id: 5 }, "number"],
            [{ anchor_fact_id: "not-a-uuid" }, "not a uuid"],
            [{ anchor_fact_id: EXPIRY, anchor_mode: "sometimes" }, "unknown mode"],
            [{ anchor_fact_id: EXPIRY, anchor_mode: 3 }, "mode not text"],
            [{ anchor_fact_id: EXPIRY, anchor_mode: "first_cycle" }, "this rule has no first cycle"],
            [[EXPIRY], "array"],
        ];
        for (const [body, name] of bad) {
            const res = await turn(RULES.monthBefore, true, body);
            expect(res.status, name).toBe(400);
            expect(res.body.code, name).toBe("obligation_anchor_required");
        }
        expect(tables().matter_obligation_rule_events).toEqual([]);
    });

    it("must be a confirmed, not stale fact with a date, of this matter (409 obligation_anchor_unavailable)", async () => {
        as(OWNER);
        for (const [fact, name] of [
            [PENDING, "pending"],
            [CHANGED, "its text changed"],
            [POA, "not a date fact"],
            [RENEWAL_NO_DATE, "no date"],
            [id(999), "does not exist"],
        ] as const) {
            const res = await turn(RULES.monthBefore, true, { anchor_fact_id: fact });
            expect(res.status, name).toBe(409);
            expect(res.body.code, name).toBe("obligation_anchor_unavailable");
        }
        expect(tables().matter_obligation_rule_events).toEqual([]);
    });

    it("is kept in the activation event with how the rule counts from it", async () => {
        as(EDITOR);
        await turn(RULES.firstCycle, true, { anchor_fact_id: RENEWAL, anchor_mode: "first_cycle" });
        expect(tables().matter_obligation_rule_events).toEqual([
            expect.objectContaining({ matter_id: MATTER, rule_code: "contract.first_cycle", rule_version: 1, action: "activate", anchor_fact_id: RENEWAL, anchor_mode: "first_cycle", actor_user_id: EDITOR }),
        ]);
        const listed = rulesOf(await request(app).get(`${base}/rules`)).find((rule) => rule.key === "contract.first_cycle@1") as Record<string, any>;
        expect(listed.anchor).toEqual({ fact_id: RENEWAL, mode: "first_cycle" });
        await turn(RULES.firstCycle, false);
        expect(tables().matter_obligation_rule_events[1]).toMatchObject({ action: "deactivate", anchor_fact_id: null, anchor_mode: null });
    });

    it("changes with one call while the rule is on: an off and an on, each its own event", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true, { anchor_fact_id: EXPIRY });
        const res = await turn(RULES.monthBefore, true, { anchor_fact_id: RENEWAL });
        expect(res.body).toMatchObject({ active: true, anchor: { fact_id: RENEWAL, mode: "direct" } });
        expect(tables().matter_obligation_rule_events.map((row) => [row.action, row.anchor_fact_id])).toEqual([
            ["activate", EXPIRY],
            ["deactivate", null],
            ["activate", RENEWAL],
        ]);
        expect((await obligations()).map((item) => item.fact_id)).toEqual([RENEWAL]);
    });

    it("answers 500 when the facts cannot be read", async () => {
        as(OWNER);
        h.state!.failNext("matter_profile_facts", "select", { code: "XX000", message: "boom" });
        expect((await turn(RULES.monthBefore, true)).status).toBe(500);
        h.state!.failNext("matter_profile_facts", "select", { code: "XX000", message: "boom" });
        expect((await request(app).get(`${base}/rules`)).status).toBe(500);
    });
});

describe("turning rules on and off", () => {
    it("repeating the current state changes nothing and records nothing", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        await turn(RULES.monthBefore, true);
        await turn(RULES.window, false);
        expect(tables().matter_obligation_rule_events).toHaveLength(1);
        expect(tables().matter_obligation_rule_events[0]).toMatchObject({ rule_code: "contract.month_before", rule_version: 1, action: "activate", actor_user_id: OWNER, matter_id: MATTER });
    });

    it("keeps every decision as an event and reads the latest one", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        await turn(RULES.monthBefore, false);
        await turn(RULES.monthBefore, true);
        expect(tables().matter_obligation_rule_events.map((row) => row.action)).toEqual(["activate", "deactivate", "activate"]);
        expect(rulesOf(await request(app).get(`${base}/rules`))[0].active).toBe(true);
    });

    it("starts a new version of a rule switched off", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        h.catalog[0] = { ...RULES.monthBefore, version: 2 };
        const listed = rulesOf(await request(app).get(`${base}/rules`));
        expect(listed[0]).toMatchObject({ key: "contract.month_before@2", active: false });
        expect(await obligations()).toEqual([]);
    });

    it("treats a decision the database refused as already made (two at once)", async () => {
        as(OWNER);
        h.state!.failNext("matter_obligation_rule_events", "insert", { code: "23514", message: "does not follow" });
        const res = await turn(RULES.monthBefore, true);
        expect(res.status).toBe(200);
        expect(res.body.active).toBe(false);
    });

    it("answers 500 when the decision cannot be recorded, and when the rules cannot be read", async () => {
        as(OWNER);
        h.state!.failNext("matter_obligation_rule_events", "insert", { code: "XX000", message: "boom" });
        expect((await turn(RULES.monthBefore, true)).status).toBe(500);
        h.state!.failNext("matter_obligation_rule_events", "select", { code: "XX000", message: "boom" });
        expect((await request(app).get(`${base}/rules`)).status).toBe(500);
    });
});

describe("active rules feed the radar", () => {
    it("shows no obligation item until a rule is turned on, and none for a rule turned off", async () => {
        as(OWNER);
        expect(await obligations()).toEqual([]);
        await turn(RULES.monthBefore, true);
        expect(await obligations()).toHaveLength(1);
        await turn(RULES.monthBefore, false);
        expect(await obligations()).toEqual([]);
    });

    it("computes the date on read from the chosen anchor fact, with the rule's sources and notes", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        const [item] = await obligations();
        expect(item).toMatchObject({
            key: `contract.month_before@1:${EXPIRY}`,
            type: "obligation_due",
            fact_id: EXPIRY,
            label: "Vigencia del arrendamiento",
            due_on: "2026-11-30",
            days_left: 14,
            bucket: "next_30",
            base_on: "2026-12-31",
            review_reason: null,
            state: "open",
            source: { version_id: VERSION, filename: "contrato.docx", quote: "CLÁUSULA" },
            obligation: {
                rule_key: "contract.month_before@1", name_key: "radar.rules.title", kind: "deadline", starts_on: null,
                milestones: [{ kind: "due", ops: [{ unit: "months", amount: -1 }] }], requires_business_days: false, notes: "Nota de ejemplo.",
                citations: [{ source_code: "LEY", law: "Ley de ejemplo", location: "Artículo 1", text: "Texto de ejemplo.", url: "https://example.gob.mx/ley", last_reform: "DOF 20-10-2023" }],
            },
        });
        // Only the one the lawyer chose counts: the other dated facts are not turned into items.
        expect(await obligations()).toHaveLength(1);
    });

    it("counts a window from the anchor and shows where it opens and ends", async () => {
        as(OWNER);
        await turn(RULES.window, true, { anchor_fact_id: RENEWAL });
        const [item] = await obligations();
        expect(item).toMatchObject({ key: `poa.window@1:${RENEWAL}`, due_on: "2026-12-10", bucket: "next_30" });
        expect(item.obligation).toMatchObject({ kind: "window", starts_on: "2026-11-11" });
    });

    it("works the first expiry out from the grant date when the lawyer says the date is that", async () => {
        as(OWNER);
        await turn(RULES.firstCycle, true, { anchor_fact_id: RENEWAL, anchor_mode: "first_cycle" });
        const [item] = await obligations();
        // 2026-11-10 + 10 years = 2036-11-10; the rule's due date is 6 months before... fixture counts -1 month: 2036-10-10.
        expect(item).toMatchObject({ due_on: "2036-10-10", base_on: "2036-11-10", bucket: "later" });
    });

    it("leaves a business-day rule to review, with no date", async () => {
        as(OWNER);
        await turn(RULES.business, true);
        const [item] = await obligations();
        expect(item).toMatchObject({ key: `contract.business@1:${EXPIRY}`, due_on: null, days_left: null, bucket: "review", review_reason: "business_days", base_on: "2026-12-31" });
        expect(item.obligation.requires_business_days).toBe(true);
    });

    it("goes to review when the anchor stops counting: its text changed", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        h.texts[VERSION] = "otro texto";
        // The text now reads as the one the CHANGED fact cited; the chosen fact is stale.
        const [item] = await obligations();
        expect(item).toMatchObject({ key: `contract.month_before@1:${EXPIRY}`, due_on: null, bucket: "review", review_reason: "anchor_unavailable", source: null, fact_id: EXPIRY });
        // It comes back when the text does.
        h.texts[VERSION] = TEXT;
        expect((await obligations())[0]).toMatchObject({ due_on: "2026-11-30", review_reason: null });
    });

    it("goes to review when the anchor fact is rejected", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        tables().matter_profile_fact_events.push({ id: id(9900), fact_id: EXPIRY, matter_id: MATTER, actor_user_id: EDITOR, action: "rejected", text_sha256: null, reason: null, created_at: stamp() });
        expect((await obligations())[0]).toMatchObject({ due_on: null, review_reason: "anchor_unavailable" });
    });

    it("orders obligation items among the fact items by date, the ones to review last", async () => {
        seedFact(id(310), "date", { date_kind: "expiry", date_on: "2026-12-31", notice_days: 30, notice_day_type: "calendar" });
        as(OWNER);
        await turn(RULES.monthBefore, true);
        await turn(RULES.business, true);
        const all = await items();
        const dated = all.filter((item) => item.due_on).map((item) => item.due_on);
        expect([...dated].sort()).toEqual(dated);
        expect(all.slice(-2).map((item) => item.due_on)).toEqual([null, null]);
        expect(all.some((item) => item.type === "expiry")).toBe(true);
        expect(all.some((item) => item.type === "obligation_due")).toBe(true);
    });

    it("is read by viewers too, and appears in the firm's Today list", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        as(VIEWER);
        expect(await obligations()).toHaveLength(1);
        as(OWNER);
        const today = await request(app).get(`/orgs/${ORG}/radar/today`);
        expect(today.status).toBe(200);
        expect(today.body.items.map((item: { key: string; matter_id: string }) => [item.key, item.matter_id])).toContainEqual(
            [`contract.month_before@1:${EXPIRY}`, MATTER],
        );
    });

    it("answers 500 when the obligation events cannot be read", async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
        h.state!.failNext("matter_obligation_item_events", "select", { code: "XX000", message: "boom" });
        expect((await request(app).get(base)).status).toBe(500);
    });
});

describe("the actions on an obligation item", () => {
    const itemKey = () => `contract.month_before@1:${EXPIRY}`;
    beforeEach(async () => {
        as(OWNER);
        await turn(RULES.monthBefore, true);
    });

    it("acknowledges, then completes, as insert-only events on the item key", async () => {
        as(EDITOR);
        const acked = await act("ack", itemKey());
        expect(acked.status).toBe(200);
        expect(acked.body).toMatchObject({ key: itemKey(), state: "acknowledged", acted_by: EDITOR, type: "obligation_due" });
        const done = await act("done", itemKey());
        expect(done.body.state).toBe("done");
        expect(tables().matter_obligation_item_events.map((row) => [row.item_key, row.action, row.due_on, row.actor_user_id, row.matter_id])).toEqual([
            [itemKey(), "ack", "2026-11-30", EDITOR, MATTER],
            [itemKey(), "done", "2026-11-30", EDITOR, MATTER],
        ]);
        expect(tables().matter_radar_item_events).toEqual([]);
        expect((await obligations())[0].state).toBe("done");
    });

    it("needs a reason to dismiss, and shows it", async () => {
        const missing = await act("dismiss", itemKey(), {});
        expect(missing.status).toBe(400);
        expect(missing.body.code).toBe("radar_reason_required");
        const res = await act("dismiss", itemKey(), { reason: "El cliente ya renovó" });
        expect(res.body).toMatchObject({ state: "dismissed", reason: "El cliente ya renovó" });
    });

    it("acts on an item left to review, which has no date", async () => {
        await turn(RULES.business, true);
        const res = await act("ack", `contract.business@1:${EXPIRY}`);
        expect(res.body).toMatchObject({ state: "acknowledged", due_on: null });
        expect(tables().matter_obligation_item_events.at(-1)).toMatchObject({ due_on: null });
    });

    it("refuses to handle an item twice (409 radar_item_closed)", async () => {
        await act("done", itemKey());
        const again = await act("ack", itemKey());
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("radar_item_closed");
    });

    it("is for owners and editors; a viewer reads only, and an outsider gets 404", async () => {
        as(VIEWER);
        expect((await act("ack", itemKey())).status).toBe(403);
        as(ORG_ADMIN);
        expect((await act("ack", itemKey())).status).toBe(404);
        expect(tables().matter_obligation_item_events).toEqual([]);
    });

    it("answers 404 for an item that does not exist: a rule that is off, another anchor, or a malformed key", async () => {
        as(OWNER);
        for (const name of [`contract.business@1:${EXPIRY}`, `contract.month_before@1:${RENEWAL}`, "contract.month_before@1:matter", "contract.month_before@1:not-a-uuid", `contract.month_before:${EXPIRY}`])
            expect((await act("ack", name)).status, name).toBe(404);
    });

    it("answers a database that refuses the order as already handled, and a failure as 500", async () => {
        as(OWNER);
        h.state!.failNext("matter_obligation_item_events", "insert", { code: "23514", message: "does not follow" });
        expect((await act("ack", itemKey())).body.code).toBe("radar_item_closed");
        h.state!.failNext("matter_obligation_item_events", "insert", { code: "XX000", message: "boom" });
        expect((await act("ack", itemKey())).status).toBe(500);
    });

    it("keeps the state of an item across turning its rule off and on", async () => {
        as(OWNER);
        await act("done", itemKey());
        await turn(RULES.monthBefore, false);
        expect(await obligations()).toEqual([]);
        await turn(RULES.monthBefore, true);
        expect((await obligations())[0].state).toBe("done");
    });
});
