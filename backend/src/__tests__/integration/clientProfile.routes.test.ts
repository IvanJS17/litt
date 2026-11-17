import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Row } from "../helpers/memoryDb";

// The client profile of a retainer matter over HTTP, against an in-memory
// database: a fact needs a citation that is really in the cited text (400/422,
// nothing saved otherwise), who may read and write (matrix), the lawyer's
// confirmation as insert-only events, and staleness computed on read.
// Constraints, privileges and RLS are covered against PostgreSQL in
// clientProfile.postgres.test.ts.
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
// The extracted-text cache joins tables the in-memory database does not have:
// a version's text is whatever the test says, and a deleted version has none.
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
const OTHER_PROJECT = id(121);
const MATTER = id(130);
const PLAIN_PROJECT = id(122);
const PLAIN_MATTER = id(131);
const PUBLIC_PROJECT = id(123);
const PUBLIC_MATTER = id(132);
const SECOND_PROJECT = id(124);
const SECOND_MATTER = id(133);
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
const NO_TEXT_VERSION = id(214);
const ARCHIVED_VERSION = id(215);
const ARCHIVED_DOC = id(202);

const TEXT =
    "CONTRATO DE ARRENDAMIENTO. Las partes son Inmuebles del Norte, S.A. de C.V. y Patito, S.A. de C.V.\n" +
    "CLÁUSULA SEGUNDA. La vigencia será de tres años contados desde el 1 de enero de 2026.\n" +
    "CLÁUSULA TERCERA. Cualquiera de las partes podrá no renovar con noventa días de aviso.";
const QUOTE = "La vigencia será de tres años contados desde el 1 de enero de 2026.";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const base = `/projects/${PROJECT}/matters/${MATTER}/profile`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const contract = (extra: Record<string, unknown> = {}) => ({
    kind: "contract",
    label: "Arrendamiento de la bodega",
    data: { counterparty: "Inmuebles del Norte", object: "Bodega en Monterrey" },
    source: { version_id: VERSION, quote: QUOTE },
    ...extra,
});
const create = (body: Record<string, unknown> = contract()) => request(app).post(`${base}/facts`).send(body);
const eventsOf = (factId: string) => tables().matter_profile_fact_events.filter((row) => row.fact_id === factId);

beforeEach(() => {
    h.texts = { [VERSION]: TEXT, [VERSION_2]: TEXT, [FOREIGN_VERSION]: TEXT, [GONE_VERSION]: TEXT, [NO_TEXT_VERSION]: null, [ARCHIVED_VERSION]: TEXT };
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
            { id: SECOND_MATTER, project_id: SECOND_PROJECT, workspace_id: WORKSPACE, is_retainer: true, visibility: "private" },
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
            { matter_id: PUBLIC_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
            { matter_id: SECOND_MATTER, user_id: OWNER, status: "active", role: "matter_owner" },
        ],
        documents: [
            { id: DOC, project_id: PROJECT, archived_at: null },
            { id: id(201), project_id: OTHER_PROJECT, archived_at: null },
            { id: ARCHIVED_DOC, project_id: PROJECT, archived_at: "2026-11-01T00:00:00Z" },
        ],
        document_versions: [
            { id: VERSION, document_id: DOC, version_number: 1, filename: "contrato.docx", deleted_at: null, created_at: "2026-11-01T00:00:00Z" },
            { id: VERSION_2, document_id: DOC, version_number: 2, filename: "contrato-2.docx", deleted_at: null, created_at: "2026-11-02T00:00:00Z" },
            { id: FOREIGN_VERSION, document_id: id(201), version_number: 1, filename: "otro.docx", deleted_at: null },
            { id: GONE_VERSION, document_id: DOC, version_number: 3, filename: "borrado.docx", deleted_at: "2026-11-01T00:00:00Z" },
            { id: NO_TEXT_VERSION, document_id: DOC, version_number: 4, filename: "escaneo.pdf", deleted_at: null },
            { id: ARCHIVED_VERSION, document_id: ARCHIVED_DOC, version_number: 1, filename: "archivado.docx", deleted_at: null },
        ],
        user_profiles: [{ user_id: EDITOR, display_name: "Elena Editora", email: "elena@example.test" }, { user_id: OWNER, display_name: null, email: "owner@example.test" }],
        matter_profile_facts: [],
        matter_profile_fact_events: [],
    });
});

describe("a fact needs a citation that is in the text", () => {
    it("answers 400 and saves nothing when the citation is missing", async () => {
        as(EDITOR);
        const { source: _source, ...withoutSource } = contract();
        const variants: Record<string, unknown>[] = [
            withoutSource,
            contract({ source: {} }),
            contract({ source: { version_id: VERSION } }),
            contract({ source: { version_id: VERSION, quote: "   " } }),
            contract({ source: { quote: QUOTE } }),
            contract({ source: { version_id: "not-a-uuid", quote: QUOTE } }),
            contract({ source: "La vigencia" }),
        ];
        for (const body of variants) {
            const res = await create(body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.body.code).toBe("citation_required");
        }
        expect(tables().matter_profile_facts).toHaveLength(0);
        expect(tables().matter_profile_fact_events).toHaveLength(0);
    });

    it("answers 422 and saves nothing when the passage is not in that version", async () => {
        as(EDITOR);
        const res = await create(contract({ source: { version_id: VERSION, quote: "La vigencia será de diez años." } }));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("quote_not_found");
        expect(tables().matter_profile_facts).toHaveLength(0);
        expect(tables().matter_profile_fact_events).toHaveLength(0);
        // The same passage in a version that does not have it.
        h.texts[VERSION_2] = "Otro texto distinto.";
        const other = await create(contract({ source: { version_id: VERSION_2, quote: QUOTE } }));
        expect(other.status).toBe(422);
        expect(tables().matter_profile_facts).toHaveLength(0);
    });

    it("answers 422 when the version's text is not ready", async () => {
        as(EDITOR);
        const res = await create(contract({ source: { version_id: NO_TEXT_VERSION, quote: QUOTE } }));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("source_text_unavailable");
        expect(tables().matter_profile_facts).toHaveLength(0);
    });

    it("answers 400 for a version that is not a live document of this matter", async () => {
        as(EDITOR);
        for (const versionId of [FOREIGN_VERSION, GONE_VERSION, ARCHIVED_VERSION, id(999)]) {
            const res = await create(contract({ source: { version_id: versionId, quote: QUOTE } }));
            expect(res.status, versionId).toBe(400);
            expect(res.body.code).toBe("version_not_in_matter");
        }
        expect(tables().matter_profile_facts).toHaveLength(0);
    });

    it("saves the offsets, the passage as the document words it and the hash of the text", async () => {
        as(EDITOR);
        // The passage as the lawyer pasted it: other case, one line.
        const pasted = "la vigencia será de tres años contados desde el 1 de enero de 2026.";
        const res = await create(contract({ source: { version_id: VERSION, quote: pasted } }));
        expect(res.status).toBe(201);
        const start = TEXT.indexOf(QUOTE);
        expect(res.body).toMatchObject({
            kind: "contract",
            label: "Arrendamiento de la bodega",
            status: "pending",
            effective_status: "pending",
            stale_reason: null,
            created_by: EDITOR,
            source: {
                document_id: DOC,
                version_id: VERSION,
                version_number: 1,
                filename: "contrato.docx",
                start_char: start,
                end_char: start + QUOTE.length,
                quote: QUOTE,
                text_sha256: sha(TEXT),
            },
        });
        expect(tables().matter_profile_facts).toHaveLength(1);
        expect(tables().matter_profile_facts[0]).toMatchObject({ matter_id: MATTER, created_by: EDITOR, text_sha256: sha(TEXT) });
        expect(eventsOf(res.body.id).map((row) => row.action)).toEqual(["created"]);
    });

    it("keeps the fact when its history row is lost", async () => {
        as(EDITOR);
        h.state!.failNext("matter_profile_fact_events", "insert", { message: "down" });
        const res = await create();
        expect(res.status).toBe(201);
        expect(tables().matter_profile_facts).toHaveLength(1);
        expect(tables().matter_profile_fact_events).toHaveLength(0);
    });
});

describe("the fields of each kind", () => {
    it("stores a date with the structure the radar will need", async () => {
        as(EDITOR);
        const res = await create(
            contract({
                kind: "date",
                label: "Aviso de no renovación",
                data: { date_kind: "renewal_notice", rule_text: "noventa días de aviso", notice_days: 90 },
            }),
        );
        expect(res.status).toBe(201);
        expect(res.body.data).toEqual({
            date_kind: "renewal_notice",
            rule_text: "noventa días de aviso",
            notice_days: 90,
            notice_day_type: "calendar",
        });
        const dated = await create(
            contract({ kind: "date", label: "Vigencia", data: { date_kind: "expiry", date_on: "2028-12-31", notice_days: 30, notice_day_type: "business" } }),
        );
        expect(dated.status).toBe(201);
        expect(dated.body.data).toMatchObject({ date_on: "2028-12-31", notice_day_type: "business" });
    });

    it("stores a power of attorney, an obligation and anything else", async () => {
        as(EDITOR);
        const poa = await create(
            contract({ kind: "power_of_attorney", label: "Poder general", data: { grantee: "Ana Pérez", scope: "Actos de administración", granted_on: "2026-01-01", expires_on: "2028-01-01" } }),
        );
        expect(poa.status).toBe(201);
        const duty = await create(contract({ kind: "obligation", label: "Informe", data: { description: "Entregar el informe", periodicity: "mensual" } }));
        expect(duty.status).toBe(201);
        const other = await create(contract({ kind: "other", label: "Nota", data: { note: "Domicilio convencional" } }));
        expect(other.status).toBe(201);
        expect(tables().matter_profile_facts).toHaveLength(3);
    });

    it("refuses a malformed fact with 400 and saves nothing", async () => {
        as(EDITOR);
        const bad: Record<string, unknown>[] = [
            contract({ kind: "mortgage" }),
            contract({ kind: undefined }),
            contract({ label: "  " }),
            contract({ label: "x".repeat(161) }),
            contract({ data: "x" }),
            contract({ data: [] }),
            contract({ data: { counterparty: "A" } }),
            contract({ data: { counterparty: "A", object: "B", surprise: "x" } }),
            contract({ data: { counterparty: 5, object: "B" } }),
            contract({ kind: "date", data: { date_kind: "expiry" } }),
            contract({ kind: "date", data: { date_kind: "sometime", date_on: "2026-01-01" } }),
            contract({ kind: "date", data: { date_kind: "expiry", date_on: "2026-02-30" } }),
            contract({ kind: "date", data: { date_kind: "expiry", rule_text: "x".repeat(301) } }),
            contract({ kind: "date", data: { date_kind: "expiry", notice_days: -1 } }),
            contract({ kind: "date", data: { date_kind: "expiry", notice_days: 1.5 } }),
            contract({ kind: "date", data: { date_kind: "expiry", notice_days: 99999 } }),
            contract({ kind: "date", data: { date_kind: "expiry", notice_days: 5, notice_day_type: "lunar" } }),
            contract({ kind: "date", data: { date_kind: "expiry", date_on: "2026-01-01", notice_day_type: "business" } }),
            contract({ kind: "date", data: { date_kind: "expiry", date_on: "2026-01-01", counterparty: "x" } }),
            contract({ kind: "power_of_attorney", data: { grantee: "A", scope: "B", granted_on: "2026-05-01", expires_on: "2026-01-01" } }),
            contract({ kind: "power_of_attorney", data: { grantee: "A", scope: "B", granted_on: "ayer" } }),
            contract({ kind: "obligation", data: {} }),
            contract({ kind: "other", data: { note: "" } }),
            contract({ source: { version_id: VERSION, quote: "q".repeat(2001) } }),
        ];
        for (const body of bad) {
            const res = await create(body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(["invalid_profile_fact", "citation_required"]).toContain(res.body.code);
        }
        const none = await request(app).post(`${base}/facts`).send([]);
        expect(none.status).toBe(400);
        expect(tables().matter_profile_facts).toHaveLength(0);
    });
});

describe("who can read and write (matrix)", () => {
    it("lets owner and editor create, and the rest of the roster read only", async () => {
        for (const user of [OWNER, EDITOR, PASANTE]) {
            as(user);
            expect((await create()).status, user).toBe(201);
        }
        const factId = tables().matter_profile_facts[0].id as string;
        for (const user of [VIEWER, TECH]) {
            as(user);
            const refused = await create();
            expect(refused.status, user).toBe(403);
            expect(refused.body.code).toBe("matter_write_required");
            expect((await request(app).post(`${base}/facts/${factId}/confirm`)).status, user).toBe(403);
            expect((await request(app).post(`${base}/facts/${factId}/reject`)).status, user).toBe(403);
            const listed = await request(app).get(base);
            expect(listed.status).toBe(200);
            expect(listed.body.can_write).toBe(false);
            expect(listed.body.versions).toEqual([]);
            expect(listed.body.facts).toHaveLength(3);
        }
        expect(tables().matter_profile_facts).toHaveLength(3);
        expect(eventsOf(factId).map((row) => row.action)).toEqual(["created"]);
    });

    it("names the people behind the facts, by display name or by email", async () => {
        as(EDITOR);
        const made = await create();
        await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        as(OWNER);
        await create();
        as(VIEWER);
        const listed = await request(app).get(base);
        const people = new Map(listed.body.people.map((p: { user_id: string; name: string | null }) => [p.user_id, p.name]));
        expect(people.get(EDITOR)).toBe("Elena Editora");
        expect(people.get(OWNER)).toBe("owner@example.test");
        expect(people.size).toBe(2);
    });

    it("offers the writer the versions a fact can cite", async () => {
        as(EDITOR);
        const listed = await request(app).get(base);
        expect(listed.status).toBe(200);
        expect(listed.body).toMatchObject({ retainer: true, can_write: true, facts: [] });
        expect(listed.body.versions.map((v: { version_id: string }) => v.version_id)).toEqual([VERSION_2, VERSION, NO_TEXT_VERSION]);
        expect(listed.body.versions[0]).toEqual({ document_id: DOC, version_id: VERSION_2, version_number: 2, filename: "contrato-2.docx" });
    });

    it("answers 404 to everyone outside the matter's roster, the firm's admins included", async () => {
        as(OWNER);
        const made = await create();
        const factId = made.body.id;
        for (const user of [STRANGER, ORG_ADMIN, OUTSIDER, REMOVED]) {
            as(user);
            expect((await request(app).get(base)).status, user).toBe(404);
            expect((await create()).status, user).toBe(404);
            expect((await request(app).post(`${base}/facts/${factId}/confirm`)).status, user).toBe(404);
            expect((await request(app).post(`${base}/facts/${factId}/reject`)).status, user).toBe(404);
        }
        expect(tables().matter_profile_facts).toHaveLength(1);
        expect(eventsOf(factId)).toHaveLength(1);
    });

    it("cuts a removed member off on their very next request", async () => {
        as(EDITOR);
        expect((await request(app).get(base)).status).toBe(200);
        tables().matter_memberships.find((row) => row.user_id === EDITOR && row.matter_id === MATTER)!.status = "revoked";
        expect((await request(app).get(base)).status).toBe(404);
        expect((await create()).status).toBe(404);
    });

    it("rejects a malformed or foreign matter or project id with 404", async () => {
        as(OWNER);
        expect((await request(app).get(`/projects/x/matters/y/profile`)).status).toBe(404);
        expect((await request(app).get(`/projects/${OTHER_PROJECT}/matters/${MATTER}/profile`)).status).toBe(404);
    });

    it("keeps a matter that is not a private retainer out of the feature", async () => {
        as(OWNER);
        for (const [project, matter] of [
            [PLAIN_PROJECT, PLAIN_MATTER],
            [PUBLIC_PROJECT, PUBLIC_MATTER],
        ]) {
            const path = `/projects/${project}/matters/${matter}/profile`;
            const listed = await request(app).get(path);
            expect(listed.status).toBe(200);
            expect(listed.body).toEqual({ retainer: false, can_write: false, facts: [], versions: [], people: [] });
            const created = await request(app).post(`${path}/facts`).send(contract());
            expect(created.status).toBe(409);
            expect(created.body.code).toBe("matter_not_retainer");
            expect((await request(app).post(`${path}/facts/${id(1)}/confirm`)).status).toBe(409);
        }
        expect(tables().matter_profile_facts).toHaveLength(0);
    });

    it("never shows or touches a fact of another matter", async () => {
        as(OWNER);
        const made = await create();
        const otherBase = `/projects/${SECOND_PROJECT}/matters/${SECOND_MATTER}/profile`;
        const listed = await request(app).get(otherBase);
        expect(listed.body.facts).toEqual([]);
        expect((await request(app).post(`${otherBase}/facts/${made.body.id}/confirm`)).status).toBe(404);
        expect((await request(app).post(`${otherBase}/facts/${made.body.id}/reject`)).status).toBe(404);
    });
});

describe("the lawyer's decision", () => {
    it("confirms with an insert-only event of who and when, and the fact row is untouched", async () => {
        as(EDITOR);
        const made = await create();
        const before = JSON.stringify(tables().matter_profile_facts);
        as(OWNER);
        const res = await request(app).post(`${base}/facts/${made.body.id}/confirm`).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "confirmed", effective_status: "confirmed", decided_by: OWNER, stale_reason: null });
        expect(JSON.stringify(tables().matter_profile_facts)).toBe(before);
        const events = eventsOf(made.body.id);
        expect(events.map((row) => row.action)).toEqual(["created", "confirmed"]);
        expect(events[1]).toMatchObject({ actor_user_id: OWNER, matter_id: MATTER, text_sha256: sha(TEXT), reason: null });
        expect(res.body.events.map((event: { action: string }) => event.action)).toEqual(["created", "confirmed"]);
        // It reads confirmed afterwards, for a viewer too.
        as(VIEWER);
        const listed = await request(app).get(base);
        expect(listed.body.facts[0]).toMatchObject({ status: "confirmed", decided_by: OWNER });
    });

    it("confirms with no body at all", async () => {
        as(EDITOR);
        const made = await create();
        expect((await request(app).post(`${base}/facts/${made.body.id}/confirm`)).status).toBe(200);
    });

    it("rejects with a reason, and a rejected fact is final", async () => {
        as(EDITOR);
        const made = await create();
        const rejected = await request(app).post(`${base}/facts/${made.body.id}/reject`).send({ reason: "Cláusula derogada" });
        expect(rejected.status).toBe(200);
        expect(rejected.body).toMatchObject({ status: "rejected", effective_status: "rejected" });
        expect(eventsOf(made.body.id)[1]).toMatchObject({ action: "rejected", reason: "Cláusula derogada", actor_user_id: EDITOR, text_sha256: null });
        for (const action of ["confirm", "reject"]) {
            const again = await request(app).post(`${base}/facts/${made.body.id}/${action}`).send({});
            expect(again.status).toBe(409);
            expect(again.body.code).toBe("fact_already_decided");
        }
        expect(eventsOf(made.body.id)).toHaveLength(2);
    });

    it("lets a confirmed fact be rejected later, but not confirmed twice", async () => {
        as(EDITOR);
        const made = await create();
        await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        const twice = await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        expect(twice.status).toBe(409);
        expect(twice.body.code).toBe("fact_already_decided");
        const rejected = await request(app).post(`${base}/facts/${made.body.id}/reject`);
        expect(rejected.status).toBe(200);
        expect(rejected.body.status).toBe("rejected");
        expect(eventsOf(made.body.id).map((row) => row.action)).toEqual(["created", "confirmed", "rejected"]);
    });

    it("refuses a bad reason or body, and an unknown fact", async () => {
        as(EDITOR);
        const made = await create();
        const long = await request(app).post(`${base}/facts/${made.body.id}/reject`).send({ reason: "x".repeat(501) });
        expect(long.status).toBe(400);
        const wrongType = await request(app).post(`${base}/facts/${made.body.id}/reject`).send({ reason: 5 });
        expect(wrongType.status).toBe(400);
        const array = await request(app).post(`${base}/facts/${made.body.id}/reject`).send([1]);
        expect(array.status).toBe(400);
        expect((await request(app).post(`${base}/facts/${id(777)}/confirm`)).status).toBe(404);
        expect((await request(app).post(`${base}/facts/nope/confirm`)).status).toBe(404);
        expect(eventsOf(made.body.id)).toHaveLength(1);
    });

    it("does not answer success when the decision row cannot be written", async () => {
        as(EDITOR);
        const made = await create();
        h.state!.failNext("matter_profile_fact_events", "insert", { message: "down" });
        const lost = await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        expect(lost.status).toBe(500);
        expect(eventsOf(made.body.id).map((row) => row.action)).toEqual(["created"]);
        const listed = await request(app).get(base);
        expect(listed.body.facts[0].status).toBe("pending");
        // A decision that lost the race at the database is a conflict, not a 500.
        h.state!.failNext("matter_profile_fact_events", "insert", { code: "23514", message: "a confirmed event does not follow confirmed" });
        expect((await request(app).post(`${base}/facts/${made.body.id}/confirm`)).status).toBe(409);
    });
});

describe("a fact is stale when its source is no longer what was cited", () => {
    const confirmed = async () => {
        as(EDITOR);
        const made = await create();
        await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        return made.body.id as string;
    };
    const fact = async (factId: string) => {
        const listed = await request(app).get(base);
        return listed.body.facts.find((f: { id: string }) => f.id === factId);
    };

    it("is not stale while the text is the same", async () => {
        const factId = await confirmed();
        expect(await fact(factId)).toMatchObject({ status: "confirmed", effective_status: "confirmed", stale_reason: null });
    });

    it("turns stale when the text of the version changes, and no longer counts as confirmed", async () => {
        const factId = await confirmed();
        h.texts[VERSION] = TEXT.replace("tres años", "cinco años");
        expect(await fact(factId)).toMatchObject({ status: "confirmed", effective_status: "stale", stale_reason: "text_changed" });
        // The quote is kept as it was cited.
        expect((await fact(factId)).source.quote).toBe(QUOTE);
        // Back to the same text, back to confirmed: nothing was stored.
        h.texts[VERSION] = TEXT;
        expect(await fact(factId)).toMatchObject({ effective_status: "confirmed", stale_reason: null });
    });

    it("turns stale when the version is deleted, replaced by a gone one, or its document is archived or moved", async () => {
        const factId = await confirmed();
        const version = tables().document_versions.find((row) => row.id === VERSION)!;
        version.deleted_at = "2026-11-10T00:00:00Z";
        expect(await fact(factId)).toMatchObject({ effective_status: "stale", stale_reason: "version_missing" });
        version.deleted_at = null;
        expect((await fact(factId)).stale_reason).toBeNull();
        tables().documents.find((row) => row.id === DOC)!.archived_at = "2026-11-10T00:00:00Z";
        expect((await fact(factId)).stale_reason).toBe("version_missing");
        tables().documents.find((row) => row.id === DOC)!.archived_at = null;
        tables().documents.find((row) => row.id === DOC)!.project_id = OTHER_PROJECT;
        expect((await fact(factId)).stale_reason).toBe("version_missing");
        tables().documents.find((row) => row.id === DOC)!.project_id = PROJECT;
        // Hard-deleted version row.
        tables().document_versions.splice(tables().document_versions.indexOf(version), 1);
        const gone = await fact(factId);
        expect(gone).toMatchObject({ effective_status: "stale", stale_reason: "version_missing" });
        expect(gone.source).toMatchObject({ version_number: null, filename: null });
    });

    it("turns stale when the text is no longer ready", async () => {
        const factId = await confirmed();
        h.texts[VERSION] = null;
        expect(await fact(factId)).toMatchObject({ effective_status: "stale", stale_reason: "text_unavailable" });
    });

    it("cannot be confirmed while stale, but can be rejected", async () => {
        as(EDITOR);
        const made = await create();
        h.texts[VERSION] = "Texto nuevo.";
        const refused = await request(app).post(`${base}/facts/${made.body.id}/confirm`);
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe("fact_stale");
        expect(eventsOf(made.body.id)).toHaveLength(1);
        const rejected = await request(app).post(`${base}/facts/${made.body.id}/reject`);
        expect(rejected.status).toBe(200);
        // A rejected fact is closed: the source no longer matters.
        expect(rejected.body).toMatchObject({ status: "rejected", effective_status: "rejected", stale_reason: null });
    });

    it("reads a pending fact as stale too, and a viewer sees it", async () => {
        as(EDITOR);
        const made = await create();
        h.texts[VERSION] = "Texto nuevo.";
        as(VIEWER);
        const listed = await request(app).get(base);
        expect(listed.body.facts[0]).toMatchObject({ id: made.body.id, status: "pending", effective_status: "stale" });
    });

    it("checks each cited version once and tells the facts apart", async () => {
        as(EDITOR);
        const a = await create();
        const b = await create(contract({ source: { version_id: VERSION_2, quote: QUOTE } }));
        h.texts[VERSION_2] = "Cambió.";
        const listed = await request(app).get(base);
        const byId = new Map(listed.body.facts.map((f: { id: string }) => [f.id, f]));
        expect(byId.get(a.body.id)).toMatchObject({ effective_status: "pending" });
        expect(byId.get(b.body.id)).toMatchObject({ effective_status: "stale", stale_reason: "text_changed" });
    });
});
