import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// The retainer report over HTTP, against an in-memory database: the content
// (only confirmed data, calendar days, no hours), who may generate it and who
// may only read the sent history, the Word file, and the insert-only "sent"
// record. Constraints, privileges and RLS of the sent table are covered against
// PostgreSQL in retainerReport.postgres.test.ts.
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
import { docxToMarkdown } from "../../lib/docxMarkdown";
import { validateDocxPackage } from "../../lib/docxpackagevalidation";
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
const TYPE_A = id(401);
const TYPE_B = id(402);

const TEXT = "CLÁUSULA SEGUNDA. La vigencia vence el 31 de diciembre de 2026, con treinta días de aviso.";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const base = `/projects/${PROJECT}/matters/${MATTER}/report`;
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
const keyOf = (factId: string, type: string) => `${factId}:${type}`;

beforeEach(() => {
    ticks = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T18:00:00Z")); // 12:00 in Mexico City
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
        matter_request_types: [
            { id: TYPE_A, organization_id: ORG, seed_key: "contracts_clients", name: null, sort_order: 10, archived_at: null },
            { id: TYPE_B, organization_id: ORG, seed_key: null, name: "Poderes", sort_order: 20, archived_at: null },
        ],
        matter_requests: [],
        matter_request_rounds: [],
        matter_report_sent_events: [],
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
    const req = (n: number, matter: string, fields: Record<string, unknown>) =>
        tables().matter_requests.push({
            id: id(500 + n), matter_id: matter, type_id: TYPE_A, title: `Solicitud ${n}`, complexity: "routine",
            status: "received", assignee_user_id: null, assignee_level: null, received_on: "2026-10-01", closed_on: null,
            version: 1, created_at: stamp(), updated_at: stamp(), ...fields,
        });
    req(1, MATTER, { status: "closed", closed_on: "2026-10-11", complexity: "complex", assignee_user_id: EDITOR, assignee_level: "senior", title: "Contrato **con** [Patito](x) | uno" });
    req(2, MATTER, { status: "in_review", received_on: "2026-11-10", type_id: TYPE_B });
    req(3, MATTER, { status: "closed", received_on: "2026-05-01", closed_on: "2026-06-01" });
    req(4, SECOND_MATTER, { received_on: "2026-11-01" });
    tables().matter_request_rounds.push(
        { id: id(600), request_id: id(501), matter_id: MATTER, round_number: 1 },
        { id: id(601), request_id: id(501), matter_id: MATTER, round_number: 2 },
    );
});


afterEach(() => {
    vi.useRealTimers();
});

const HOURS = /\bhoras?\b|\bhours?\b|\bhrs?\b|\bminutos?\b|\bminutes?\b|\btarifa\b|\bhourly\b/i;
const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.flatMap(keysOf)
        : value && typeof value === "object"
          ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
          : [];
const binary = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
};
const download = (path: string) => request(app).get(path).buffer(true).parse(binary as never);
const ES_DISCLAIMER = "Ayuda de planeación. La fecha no es un término legal y LiTT no calcula términos procesales.";
const ES_SCOPE = "Solo incluye los datos que el despacho confirmó en los documentos revisados; puede haber vencimientos que no aparezcan.";
const EN_DISCLAIMER = "Planning aid. The date is not a legal deadline and LiTT does not calculate procedural deadlines.";
const EN_SCOPE = "It only includes the facts the firm confirmed in the documents it reviewed; some deadlines may not appear.";

describe("the report content", () => {
    it("summarizes requests, the confirmed profile and the upcoming radar of the last 90 days", async () => {
        as(OWNER);
        const res = await request(app).get(`${base}/90d`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            locale: "es-MX",
            matter_name: "Patito · Iguala 2026",
            period: { days: 90, start: "2026-08-20", end: "2026-11-17", time_zone: "America/Mexico_City" },
            horizon: { start: "2026-11-17", end: "2027-02-15" },
            disclaimer: ES_DISCLAIMER,
            scope_note: ES_SCOPE,
        });
        const { requests } = res.body;
        expect(requests.total).toBe(2);
        expect(requests.by_type.map((t: { type_id: string; count: number }) => [t.type_id, t.count])).toEqual([[TYPE_A, 1], [TYPE_B, 1]]);
        expect(requests.by_complexity).toEqual({ routine: 1, standard: 0, complex: 1 });
        expect(requests.by_level).toMatchObject({ senior: 1, unassigned: 1 });
        expect(requests.closed).toHaveLength(1);
        expect(requests.closed[0]).toMatchObject({ calendar_days: 10, rounds: 2, level: "senior", closed_on: "2026-10-11" });
        expect(requests.closed_average_calendar_days).toBe(10);
        expect(requests.open.map((r: { calendar_days: number }) => r.calendar_days)).toEqual([7]);
        // Only the confirmed, not stale facts: expiry, overdue, business, poa and noData.
        expect(res.body.profile.confirmed_total).toBe(5);
        expect(res.body.profile.confirmed_in_period).toHaveLength(5);
        expect(res.body.radar.upcoming.map((i: { key: string; days_left: number }) => [i.key, i.days_left])).toEqual([
            [keyOf(FACTS.expiry, "notice"), 14],
            [keyOf(FACTS.expiry, "expiry"), 44],
        ]);
    });

    it("never names hours, time worked or an estimate", async () => {
        as(OWNER);
        for (const locale of ["es-MX", "en-US"]) {
            const res = await request(app).get(`${base}/90d?locale=${locale}`);
            for (const key of keysOf(res.body)) expect(key).not.toMatch(HOURS);
            expect(JSON.stringify(res.body)).not.toMatch(HOURS);
        }
    });

    it("answers in English on request, and a shorter period on 30d", async () => {
        as(OWNER);
        const en = await request(app).get(`${base}/90d?locale=en-US`);
        expect(en.body).toMatchObject({ locale: "en-US", disclaimer: EN_DISCLAIMER, scope_note: EN_SCOPE });
        const short = await request(app).get(`${base}/30d`);
        expect(short.body.period).toMatchObject({ days: 30, start: "2026-10-19" });
        expect(short.body.requests.closed).toHaveLength(0);
        // The look-ahead is as long as the period: the expiry 44 days away is out of a 30 day report.
        expect(short.body.radar.upcoming.map((i: { days_left: number }) => i.days_left)).toEqual([14]);
    });

    it("follows the day in Mexico City", async () => {
        as(OWNER);
        vi.setSystemTime(new Date("2026-11-18T05:59:00Z"));
        expect((await request(app).get(`${base}/90d`)).body.period.end).toBe("2026-11-17");
        vi.setSystemTime(new Date("2026-11-18T06:00:00Z"));
        expect((await request(app).get(`${base}/90d`)).body.period.end).toBe("2026-11-18");
    });

    it("leaves a pending fact out until a lawyer confirms it", async () => {
        as(EDITOR);
        expect((await request(app).get(`${base}/90d`)).body.profile.confirmed_total).toBe(5);
        await request(app).post(`/projects/${PROJECT}/matters/${MATTER}/profile/facts/${FACTS.pending}/confirm`).send({});
        const after = await request(app).get(`${base}/90d`);
        expect(after.body.profile.confirmed_total).toBe(6);
        expect(after.body.radar.upcoming.some((i: { key: string }) => i.key === keyOf(FACTS.pending, "expiry"))).toBe(true);
    });

    it("writes nothing when it generates the report or the Word file", async () => {
        as(OWNER);
        const snapshot = () => JSON.stringify(Object.entries(tables()).filter(([, rows]) => rows.length > 0));
        const before = snapshot();
        await request(app).get(`${base}/90d`);
        await download(`${base}/90d/docx`);
        expect(snapshot()).toBe(before);
    });

    it("refuses an unknown period or language", async () => {
        as(OWNER);
        for (const period of ["45d", "90", "180d", "xx"]) expect((await request(app).get(`${base}/${period}`)).status, period).toBe(404);
        const bad = await request(app).get(`${base}/90d?locale=fr-FR`);
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe("invalid_report");
    });
});

describe("the Word file", () => {
    it("is a valid Word package with the planning-aid text and the scope note", async () => {
        as(OWNER);
        const res = await download(`${base}/90d/docx`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("wordprocessingml.document");
        expect(res.headers["content-disposition"]).toContain("attachment");
        expect(res.headers["content-disposition"]).toContain("reporte-iguala-2026-11-17.docx");
        const bytes = res.body as Buffer;
        expect(await validateDocxPackage(Uint8Array.from(bytes).buffer)).toBe(true);
        const text = await docxToMarkdown(bytes);
        expect(text).toContain(ES_DISCLAIMER);
        expect(text).toContain(ES_SCOPE);
        // The scope note comes right after the planning-aid text.
        expect(text.indexOf(ES_SCOPE) - (text.indexOf(ES_DISCLAIMER) + ES_DISCLAIMER.length)).toBeLessThan(10);
        expect(text).not.toMatch(HOURS);
        expect(text).toContain("Vigencia del arrendamiento");
        expect(text).toContain("Solicitudes atendidas");
    });

    it("still makes the Word file when the matter holds as many requests as are ever listed, all of them closed", async () => {
        as(OWNER);
        for (let n = 0; n < 1_500; n++)
            tables().matter_requests.push({
                id: id(10_000 + n), matter_id: MATTER, type_id: TYPE_A, title: `Solicitud masiva ${n}`, complexity: "routine",
                status: "closed", assignee_user_id: null, assignee_level: null, received_on: "2026-10-01", closed_on: "2026-10-11",
                version: 1, created_at: stamp(), updated_at: stamp(),
            });
        const res = await download(`${base}/90d/docx`);
        expect(res.status).toBe(200);
        expect(await validateDocxPackage(Uint8Array.from(res.body as Buffer).buffer)).toBe(true);
    });

    it("carries the English planning-aid text and scope note in the English file", async () => {
        as(OWNER);
        const res = await download(`${base}/90d/docx?locale=en-US`);
        const text = await docxToMarkdown(res.body as Buffer);
        expect(res.headers["content-disposition"]).toContain("retainer-report-2026-11-17.docx");
        expect(text).toContain(EN_DISCLAIMER);
        expect(text).toContain(EN_SCOPE);
        expect(text).not.toMatch(HOURS);
    });

    it("shows a request's title as text, never as Markdown structure", async () => {
        as(OWNER);
        const res = await download(`${base}/90d/docx`);
        const text = await docxToMarkdown(res.body as Buffer);
        // The table still has its columns: the pipe in the title did not split a cell.
        // The characters stay literal (the converter escapes them back), and the row keeps its seven cells.
        const row = text.split("\n").find((line) => line.includes("Patito") && line.startsWith("|"))!;
        expect(row).toContain("Contrato \\*\\*con\\*\\* \\[Patito\\](x) | uno | Contratos con clientes | Compleja | 2026-10-01 | 2026-10-11 | 10 | 2 |");
    });
});

describe("who generates the report (permission matrix)", () => {
    it.each([
        ["owner", OWNER, 200],
        ["editor", EDITOR, 200],
        ["viewer", VIEWER, 403],
        ["technical operator", TECH, 403],
        ["org member outside the matter", STRANGER, 404],
        ["org admin without membership", ORG_ADMIN, 404],
        ["person of another firm", OUTSIDER, 404],
        ["removed member", REMOVED, 404],
    ])("%s: preview and Word file", async (_name, user, status) => {
        as(user);
        expect((await request(app).get(`${base}/90d`)).status).toBe(status);
        expect((await download(`${base}/90d/docx`)).status).toBe(status);
    });

    it("a refused member sees the write-required code", async () => {
        as(VIEWER);
        expect((await request(app).get(`${base}/90d`)).body.code).toBe("matter_write_required");
    });

    it("answers 404 for a matter that is not a private retainer", async () => {
        as(OWNER);
        for (const [project, matter] of [[PLAIN_PROJECT, PLAIN_MATTER], [PUBLIC_PROJECT, PUBLIC_MATTER]]) {
            expect((await request(app).get(`/projects/${project}/matters/${matter}/report/90d`)).status).toBe(404);
            expect((await request(app).get(`/projects/${project}/matters/${matter}/report/90d/docx`)).status).toBe(404);
        }
    });

    it("refuses a malformed project or matter id, and a matter of another project, with 404", async () => {
        as(OWNER);
        expect((await request(app).get(`/projects/nope/matters/${MATTER}/report/90d`)).status).toBe(404);
        expect((await request(app).get(`/projects/${PROJECT}/matters/nope/report/90d`)).status).toBe(404);
        expect((await request(app).get(`/projects/${PROJECT}/matters/${SECOND_MATTER}/report/90d`)).status).toBe(404);
    });

    it("keeps the requests of another matter and another firm out", async () => {
        as(OWNER);
        const res = await request(app).get(`${base}/90d`);
        expect(JSON.stringify(res.body)).not.toContain("Solicitud 4");
        expect(JSON.stringify(res.body)).not.toContain("Mapache");
    });
});

describe("marking the report as sent", () => {
    const sent = (period = "90d", path = base) => request(app).post(`${path}/${period}/sent`);

    it.each([
        ["owner", OWNER, 201],
        ["editor", EDITOR, 201],
        ["viewer", VIEWER, 403],
        ["technical operator", TECH, 403],
        ["org admin without membership", ORG_ADMIN, 404],
        ["stranger", STRANGER, 404],
        ["person of another firm", OUTSIDER, 404],
        ["removed member", REMOVED, 404],
    ])("%s", async (_name, user, status) => {
        as(user);
        const res = await sent().send({});
        expect(res.status).toBe(status);
        expect(tables().matter_report_sent_events).toHaveLength(status === 201 ? 1 : 0);
    });

    it("records who, when, which period and the note, and nothing else is sent", async () => {
        as(EDITOR);
        const res = await sent("30d").send({ note: "  Enviado por correo a Patito  " });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            period_start: "2026-10-19",
            period_end: "2026-11-17",
            period_days: 30,
            note: "Enviado por correo a Patito",
            sent_by: EDITOR,
            sent_by_name: "Elena Editora",
        });
        expect(tables().matter_report_sent_events).toEqual([
            expect.objectContaining({ matter_id: MATTER, actor_user_id: EDITOR, period_days: 30, note: "Enviado por correo a Patito" }),
        ]);
    });

    it("takes no note, and the same period may be marked again", async () => {
        as(OWNER);
        expect((await sent().send({})).body.note).toBeNull();
        expect((await sent().send()).status).toBe(201);
        expect(tables().matter_report_sent_events).toHaveLength(2);
    });

    it("refuses a malformed body, a long note and an unknown period", async () => {
        as(OWNER);
        for (const body of [{ note: 5 }, { note: "x".repeat(501) }, []]) {
            const res = await sent().send(body as object);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.body.code).toBe("invalid_report");
        }
        expect((await sent("45d").send({})).status).toBe(404);
        expect(tables().matter_report_sent_events).toHaveLength(0);
    });

    it("refuses a matter that is not a private retainer with 409", async () => {
        as(OWNER);
        for (const [project, matter] of [[PLAIN_PROJECT, PLAIN_MATTER], [PUBLIC_PROJECT, PUBLIC_MATTER]]) {
            const res = await sent("90d", `/projects/${project}/matters/${matter}/report`).send({});
            expect(res.status).toBe(409);
            expect(res.body.code).toBe("matter_not_retainer");
        }
    });

    it("fails, without a success answer, when the record cannot be written", async () => {
        as(OWNER);
        h.state!.failNext("matter_report_sent_events", "insert", { code: "XX000", message: "boom" });
        expect((await sent().send({})).status).toBe(500);
        expect(tables().matter_report_sent_events).toHaveLength(0);
    });

    it("offers no way to change or delete a record", async () => {
        as(OWNER);
        await sent().send({});
        const row = tables().matter_report_sent_events[0];
        for (const method of ["put", "patch", "delete"] as const)
            expect((await request(app)[method](`${base}/sent/${row.id}`).send({})).status).toBeGreaterThanOrEqual(404);
        expect(tables().matter_report_sent_events).toEqual([row]);
    });
});

describe("the sent history", () => {
    it("is read by every member of the matter, newest first", async () => {
        as(EDITOR);
        await request(app).post(`${base}/90d/sent`).send({ note: "primero" });
        // memoryDb applies no column defaults (prod: now()), so seed distinct created_at.
        tables().matter_report_sent_events[0].created_at = "2026-11-17T18:00:00.000Z";
        vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
        await request(app).post(`${base}/60d/sent`).send({ note: "segundo" });
        tables().matter_report_sent_events[1].created_at = "2026-11-18T18:00:00.000Z";
        expect(tables().matter_report_sent_events.map((row) => row.note)).toEqual(["primero", "segundo"]);
        for (const [user, canWrite] of [[OWNER, true], [EDITOR, true], [VIEWER, false], [TECH, false]] as const) {
            as(user);
            const res = await request(app).get(`${base}/sent`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ retainer: true, can_write: canWrite });
            expect(res.body.sent.map((row: { note: string }) => row.note)).toEqual(["segundo", "primero"]);
            expect(res.body.sent[0]).toMatchObject({ sent_by: EDITOR, sent_by_name: "Elena Editora", period_days: 60 });
        }
    });

    it.each([
        ["org admin without membership", ORG_ADMIN],
        ["stranger", STRANGER],
        ["person of another firm", OUTSIDER],
        ["removed member", REMOVED],
    ])("is a 404 for %s", async (_name, user) => {
        as(user);
        expect((await request(app).get(`${base}/sent`)).status).toBe(404);
    });

    it("says a matter that is not a private retainer has none", async () => {
        as(OWNER);
        for (const [project, matter] of [[PLAIN_PROJECT, PLAIN_MATTER], [PUBLIC_PROJECT, PUBLIC_MATTER]]) {
            const res = await request(app).get(`/projects/${project}/matters/${matter}/report/sent`);
            expect(res.body).toEqual({ retainer: false, can_write: false, sent: [] });
        }
    });

    it("keeps the records of another matter out", async () => {
        as(OWNER);
        await request(app).post(`/projects/${SECOND_PROJECT}/matters/${SECOND_MATTER}/report/90d/sent`).send({ note: "otro" });
        expect((await request(app).get(`${base}/sent`)).body.sent).toEqual([]);
    });
});
