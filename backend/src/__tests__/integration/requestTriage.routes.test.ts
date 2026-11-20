import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Donna's triage of a request over HTTP, against an in-memory database, a
// scripted Jev and a scripted AI route: the automatic run on creating a request
// (switch on, off, existing requests), what Jev is sent, the BYOK part with and
// without a key, validation in code, the decisions, the monthly cap and the
// permissions. Constraints, insert-only and the migration: requestTriage.postgres.test.ts.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
    jev: { calls: [] as { key: string; request: { state: unknown; questions: Record<string, unknown> } }[], answer: null as null | (() => unknown), error: null as unknown },
    llm: { calls: [] as Record<string, unknown>[], answer: "{}", error: null as unknown },
    route: { ok: true },
    texts: {} as Record<string, string | null>,
    /** Documents linked as rounds to every new request, the first time its rounds are read. */
    rounds: [] as { round_number: number; document_id: string; version_id: string; created_at: string }[],
    egress: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
}));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => {
        const state = h.state!;
        const db = state.db as { from: (table: string) => unknown };
        // The automatic run starts as the request is created, before a test could link a
        // document to it: the test says what is linked, and it is there when the run reads.
        return {
            ...db,
            from: (table: string) => {
                if (table === "matter_request_rounds")
                    for (const row of state.tables.matter_requests)
                        if (!state.tables.matter_request_rounds.some((round) => round.request_id === row.id))
                            for (const round of h.rounds)
                                state.tables.matter_request_rounds.push({ id: `${row.id}-${round.round_number}`, request_id: row.id, matter_id: MATTER_ID, round_date: "2026-11-19", ...round });
                return db.from(table);
            },
            rpc: (state.db as { rpc: unknown }).rpc,
        };
    }),
}));
const MATTER_ID = "00000000-0000-4000-8000-000000000130";
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
    insertAuditEvent: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
        h.audit.push(event);
    }),
}));
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
vi.mock("../../lib/jev", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/jev")>()),
    jevApiKey: () => "synthetic-jev-key",
    askJev: vi.fn(async (key: string, req: { state: unknown; questions: Record<string, unknown> }) => {
        h.jev.calls.push({ key, request: JSON.parse(JSON.stringify(req)) });
        if (h.jev.error) throw h.jev.error;
        return h.jev.answer!();
    }),
}));
vi.mock("../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm")>()),
    completeText: vi.fn(async (params: Record<string, unknown>) => {
        h.llm.calls.push(params);
        if (h.llm.error) throw h.llm.error;
        return h.llm.answer;
    }),
}));
vi.mock("../../modules/client-profile/client-profile.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/client-profile/client-profile.service")>()),
    resolveExtractionRoute: vi.fn(async () =>
        h.route.ok
            ? { ok: true, data: { route: { provider: "claude", model: "claude-sonnet-5-5" }, resolved: { route: { provider: "claude", model: "claude-sonnet-5-5", credentialRef: "personal" }, apiKeys: { claude: "sk-own" } } } }
            : { ok: false, kind: "unprocessable", detail: "An API key is required.", code: "missing_api_key" },
    ),
}));
vi.mock("../../modules/user/user.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/user/user.service")>()),
    recordChatEgressOrThrow: vi.fn(async (_db: unknown, args: Record<string, unknown>) => {
        h.egress.push(args);
    }),
}));
vi.mock("../../lib/documentTextCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/documentTextCache")>()),
    loadVersionTextState: vi.fn(async (_db: unknown, _doc: string, versionId: string) =>
        versionId in h.texts ? { revision: "r", text: h.texts[versionId], textlessPageCount: 0 } : null,
    ),
}));

import { app } from "../../app";
import { JEV_MODEL, JevError } from "../../lib/jev";
import { settleTriageRuns } from "../../modules/requests/requests.service";
import { DONNA_MONTHLY_RUN_CAP } from "../../modules/requests/requests.triage.shared";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const WORKSPACE = id(110);
const PROJECT = id(120);
const MATTER = id(130);
const OWNER = id(1);
const EDITOR = id(2);
const VIEWER = id(3);
const PASANTE = id(8);
const ORG_ADMIN = id(6);
const STRANGER = id(5);
const DOC = id(200);
const DOC2 = id(201);
const VERSION = id(210);
const VERSION2 = id(211);
const TYPE = id(300);
const TYPE_LABORAL = id(301);
const PLAYBOOK = id(400);
const DRAFT_PLAYBOOK = id(401);

const NAME = "Elena Editora";
const EMAIL = "elena@example.test";
const MARKER = "CLAUSULA-SECRETA-ZX81";

const base = `/projects/${PROJECT}/matters/${MATTER}/requests`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const create = (extra: Record<string, unknown> = {}) =>
    request(app).post(base).send({ title: "Contrato de arrendamiento", type_id: TYPE, complexity: "standard", ...extra });
const card = (requestId: string) => request(app).get(`${base}/${requestId}/triage`);

const choice = (pick: string, p = 0.9) => ({ type: "choice", choice: pick, confidence: p, probabilities: { [pick]: p } });
const jevAnswer = (over: Record<string, unknown> = {}) => ({
    model: JEV_MODEL,
    answers: {
        tipo: choice("tipo_2"),
        tipo_aplica: { type: "noul", noul: 0.95 },
        complejidad: choice("complex"),
        urgencia: { type: "score", score: 0.2, confidence: 0.9 },
        abogado: choice("abogado_1"),
        abogado_aplica: { type: "noul", noul: 0.9 },
        ...over,
    },
    inputTokens: 2_000,
    outputTokens: 40,
    latencyMs: 12,
});
const generative = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
        strategy: [
            { text: "Revisar la cláusula de rescisión", document_id: "doc_1", quote: "rescisión anticipada" },
            { text: "Pedir los anexos", document_id: null, quote: null },
        ],
        questions: ["¿Existen anexos firmados?", "¿Cuándo vence el plazo?"],
        documents: [{ name: "Respuesta al cliente", purpose: "Contestar la consulta", playbook_id: PLAYBOOK }],
        ...over,
    });

beforeEach(() => {
    h.jev.calls = [];
    h.jev.error = null;
    h.jev.answer = () => jevAnswer();
    h.llm.calls = [];
    h.llm.error = null;
    h.llm.answer = generative();
    h.route.ok = true;
    h.rounds = [];
    h.egress = [];
    h.audit = [];
    h.texts = { [VERSION]: `Contrato. La rescisión anticipada procede por incumplimiento. ${MARKER}`, [VERSION2]: "Anexo sin cláusulas relevantes." };
    h.state = memoryDb({
        organizations: [{ id: ORG, kind: "team" }],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: EDITOR, role: "member" },
            { org_id: ORG, user_id: VIEWER, role: "member" },
            { org_id: ORG, user_id: STRANGER, role: "member" },
            { org_id: ORG, user_id: ORG_ADMIN, role: "admin" },
            { org_id: ORG, user_id: PASANTE, role: "member" },
        ],
        workspaces: [{ id: WORKSPACE, organization_id: ORG }],
        projects: [{ id: PROJECT, org_id: ORG, donna_enabled: true }],
        matters: [{ id: MATTER, project_id: PROJECT, workspace_id: WORKSPACE, is_retainer: true, visibility: "private" }],
        matter_memberships: [OWNER, EDITOR, VIEWER, PASANTE].map((user_id) => ({
            matter_id: MATTER,
            user_id,
            status: "active",
            role: { [OWNER]: "matter_owner", [VIEWER]: "viewer" }[user_id] ?? "editor",
        })),
        training_stages: [{ org_id: ORG, trainee_user_id: PASANTE, practice: null, stage: "pasante" }],
        user_profiles: [{ user_id: EDITOR, display_name: NAME, email: EMAIL }],
        documents: [
            { id: DOC, project_id: PROJECT, archived_at: null },
            { id: DOC2, project_id: PROJECT, archived_at: null },
        ],
        document_versions: [
            { id: VERSION, document_id: DOC, version_number: 1, filename: "contrato.docx", deleted_at: null },
            { id: VERSION2, document_id: DOC2, version_number: 1, filename: "anexo.docx", deleted_at: null },
        ],
        matter_request_types: [
            { id: TYPE, organization_id: ORG, seed_key: "contracts_clients", name: null, sort_order: 10, archived_at: null },
            { id: TYPE_LABORAL, organization_id: ORG, seed_key: null, name: "Litigio laboral", sort_order: 20, archived_at: null },
        ],
        request_type_playbooks: [{ id: id(500), org_id: ORG, type_id: TYPE_LABORAL, playbook_id: PLAYBOOK, unlinked_at: null, linked_at: "2026-11-01T00:00:00Z" }],
        playbooks: [
            { id: PLAYBOOK, org_id: ORG, visibility: "organization", status: "ready", name: "Playbook laboral" },
            { id: DRAFT_PLAYBOOK, org_id: ORG, visibility: "organization", status: "draft", name: "Borrador" },
        ],
        matter_requests: [],
        matter_request_rounds: [],
        matter_request_events: [],
        matter_request_triage_runs: [],
        matter_request_triage_items: [],
        matter_request_triage_decisions: [],
    });
});

/** Creates a request (with one linked document) and waits for the automatic run. */
async function createRequest(withDocument = true) {
    h.rounds = withDocument ? [{ round_number: 1, document_id: DOC, version_id: VERSION, created_at: "2026-11-19T10:00:00Z" }] : [];
    as(OWNER);
    const created = await create();
    expect(created.status).toBe(201);
    await settleTriageRuns();
    return created.body.id as string;
}

describe("the automatic run", () => {
    it("classifies and drafts every new request when the project's switch is on", async () => {
        as(OWNER);
        const created = await create();
        expect(created.status).toBe(201);
        await settleTriageRuns();
        const runs = tables().matter_request_triage_runs;
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ trigger: "auto", classify_status: "ok", generative_status: "ok", org_id: ORG, request_id: created.body.id });
        expect(h.jev.calls).toHaveLength(1);
        expect(h.llm.calls).toHaveLength(1);
        expect(tables().matter_request_events.map((row) => row.action)).toContain("triage_proposed");
    });

    it("does not run when the project's switch is off, nor read anything", async () => {
        tables().projects[0].donna_enabled = false;
        as(OWNER);
        expect((await create()).status).toBe(201);
        await settleTriageRuns();
        expect(tables().matter_request_triage_runs).toHaveLength(0);
        expect(h.jev.calls).toHaveLength(0);
        expect(h.llm.calls).toHaveLength(0);
    });

    it("never re-runs a request that already existed when the switch is turned on", async () => {
        tables().projects[0].donna_enabled = false;
        const requestId = await createRequest(false);
        tables().projects[0].donna_enabled = true;
        await settleTriageRuns();
        expect(tables().matter_request_triage_runs).toHaveLength(0);
        const read = await card(requestId);
        expect(read.body).toMatchObject({ enabled: true, run: null, items: [] });
        // Neither opening the card nor reading the list starts a run.
        await request(app).get(base);
        expect(tables().matter_request_triage_runs).toHaveLength(0);
    });

    it("answers the creation at once and shows the card as pending until the run is written", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        h.jev.answer = () => gate.then(() => jevAnswer());
        as(OWNER);
        const created = await create();
        expect(created.status).toBe(201);
        const waiting = await card(created.body.id);
        expect(waiting.body).toMatchObject({ pending: true, run: null });
        release();
        await settleTriageRuns();
        expect((await card(created.body.id)).body).toMatchObject({ pending: false, run: { classify_status: "ok" } });
    });
});

describe("what leaves LiTT", () => {
    it("sends Jev the title and the documents, and the candidates only as an opaque key and a function", async () => {
        await createRequest();
        const sent = JSON.stringify(h.jev.calls[0].request);
        expect(h.jev.calls[0].key).toBe("synthetic-jev-key");
        expect(sent).toContain("Contrato de arrendamiento");
        expect(sent).toContain(MARKER);
        expect(sent).toContain("abogado_1");
        for (const secret of [NAME, EMAIL, OWNER, EDITOR, VIEWER, PASANTE, ORG, MATTER, PROJECT, TYPE, "contrato.docx"]) expect(sent).not.toContain(secret);
        expect(Object.keys(h.jev.calls[0].request.questions)).toEqual(
            expect.arrayContaining(["tipo", "tipo_aplica", "complejidad", "urgencia", "abogado", "abogado_aplica"]),
        );
    });

    it("records the egress of both engines before the text leaves, and never uses the firm's key for Jev", async () => {
        await createRequest();
        expect(h.audit).toHaveLength(1);
        expect(h.audit[0]).toMatchObject({ action: "llm.egress", surface: "donna_triage_jev", model: JEV_MODEL, orgId: ORG });
        expect(JSON.stringify(h.audit)).not.toContain(MARKER);
        expect(h.egress).toHaveLength(1);
        expect(h.egress[0]).toMatchObject({ surface: "donna_triage", orgId: ORG, projectId: PROJECT });
        expect(h.jev.calls[0].key).not.toBe("sk-own");
        expect(h.llm.calls[0].apiKeys).toEqual({ claude: "sk-own" });
    });
});

describe("the card", () => {
    it("proposes type, complexity, urgency and candidate, and the drafts, with the playbooks linked to the suggested type", async () => {
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.status).toBe(200);
        const byKind = (kind: string) => read.body.items.filter((item: { kind: string }) => item.kind === kind);
        expect(byKind("type")[0]).toMatchObject({ type_id: TYPE_LABORAL });
        expect(byKind("complexity")[0]).toMatchObject({ enum_value: "complex" });
        expect(byKind("urgency")[0]).toMatchObject({ enum_value: "low", forced_by_alarm: false });
        expect(byKind("candidate")[0]).toMatchObject({ user_id: OWNER });
        expect(byKind("strategy").map((item: { text: string }) => item.text)).toEqual(["Revisar la cláusula de rescisión", "Pedir los anexos"]);
        expect(byKind("strategy")[0].cited).toBe(true);
        expect(byKind("strategy")[1].cited).toBe(false);
        expect(byKind("question")).toHaveLength(2);
        expect(byKind("document")[0]).toMatchObject({ text: "Respuesta al cliente", playbook: { id: PLAYBOOK, name: "Playbook laboral" } });
        expect(read.body.playbooks).toEqual([{ id: PLAYBOOK, name: "Playbook laboral" }]);
        expect(read.body.run).toMatchObject({ docs_total: 1, docs_read: 1, docs_partial: 0, unread: [] });
        expect(read.body.usage).toEqual({ used: 1, limit: DONNA_MONTHLY_RUN_CAP });
    });

    it("never assigns anybody and never changes the request by itself", async () => {
        const requestId = await createRequest();
        const row = tables().matter_requests.find((one) => one.id === requestId)!;
        expect(row).toMatchObject({ type_id: TYPE, complexity: "standard", version: 1 });
        expect(row.assignee_user_id ?? null).toBeNull();
    });

    it("raises the urgency from an alarm word, whatever Jev said", async () => {
        as(OWNER);
        const created = await create({ title: "Emplazamiento recibido hoy" });
        await settleTriageRuns();
        const item = tables().matter_request_triage_items.find((row) => row.kind === "urgency")!;
        expect(item).toMatchObject({ value_enum: "urgent", forced_by_alarm: true });
        expect(created.status).toBe(201);
    });

    it("drops a strategy step whose cited passage is not in the document, and counts it", async () => {
        h.llm.answer = generative({ strategy: [{ text: "Paso inventado", document_id: "doc_1", quote: "texto que no existe" }, { text: "Paso libre", document_id: null, quote: null }] });
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.body.items.filter((item: { kind: string }) => item.kind === "strategy").map((item: { text: string }) => item.text)).toEqual(["Paso libre"]);
        expect(read.body.run.quotes_rejected).toBe(1);
    });

    it("drops a playbook the model was not offered, and a type or candidate outside the lists", async () => {
        h.llm.answer = generative({ documents: [{ name: "Escrito", purpose: "x", playbook_id: DRAFT_PLAYBOOK }] });
        h.jev.answer = () => jevAnswer({ tipo: choice("tipo_9"), abogado: choice("abogado_9") });
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.body.items.find((item: { kind: string }) => item.kind === "document").playbook).toBeNull();
        expect(read.body.items.some((item: { kind: string }) => item.kind === "type" || item.kind === "candidate")).toBe(false);
    });

    it("reports what was not read when the documents pass the size budget", async () => {
        h.texts[VERSION] = "a".repeat(79_000);
        h.texts[VERSION2] = "b".repeat(5_000);
        h.rounds = [
            { round_number: 2, document_id: DOC2, version_id: VERSION2, created_at: "2026-11-19T10:00:00Z" },
            { round_number: 1, document_id: DOC, version_id: VERSION, created_at: "2026-11-19T09:00:00Z" },
        ];
        as(OWNER);
        const created = await create();
        await settleTriageRuns();
        const read = await card(created.body.id);
        // Newest round first: the 5,000-character annex fits, the 79,000 one does not.
        expect(read.body.run).toMatchObject({ docs_total: 2, docs_read: 1, docs_partial: 0, unread: [{ version_id: VERSION, filename: "contrato.docx" }] });
    });
});

describe("without an AI key and when Jev fails", () => {
    it("classifies but drafts nothing when the firm has no key, and says so", async () => {
        h.route.ok = false;
        const requestId = await createRequest();
        expect(h.llm.calls).toHaveLength(0);
        expect(h.egress).toHaveLength(0);
        const read = await card(requestId);
        expect(read.body.run).toMatchObject({ classify_status: "ok", generative_status: "no_key" });
        expect(read.body.items.map((item: { kind: string }) => item.kind).sort()).toEqual(["candidate", "complexity", "type", "urgency"]);
    });

    it("says «clasificación no disponible» when Jev fails and never classifies with the firm's key", async () => {
        h.jev.error = new JevError("unavailable", 503);
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.body.run).toMatchObject({ classify_status: "unavailable", generative_status: "ok" });
        expect(read.body.items.filter((item: { kind: string }) => ["type", "complexity", "candidate"].includes(item.kind))).toEqual([]);
        expect(tables().matter_request_triage_runs[0]).toMatchObject({ classify_error: "unavailable", jev_input_tokens: null, jev_cost_usd: null });
        // The drafts used the firm's route; the classification did not.
        const system = String(h.llm.calls[0].systemPrompt);
        expect(system).not.toMatch(/classif/i);
    });

    it("keeps the run when the firm's route fails: the classification stands", async () => {
        h.llm.error = new Error("provider said: " + MARKER);
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.body.run).toMatchObject({ classify_status: "ok", generative_status: "unavailable" });
        expect(JSON.stringify(tables())).not.toContain("provider said");
    });

    it("rejects a generative answer with an extra key whole, and keeps the classification", async () => {
        h.llm.answer = JSON.stringify({ strategy: [], questions: [], documents: [], extra: "x" });
        const requestId = await createRequest();
        const read = await card(requestId);
        expect(read.body.run.generative_status).toBe("invalid");
        expect(read.body.items.some((item: { kind: string }) => item.kind === "strategy")).toBe(false);
    });
});

describe("what is stored", () => {
    it("keeps no document text and no title in the run, the items or the events, and records tokens, engine and cost", async () => {
        const requestId = await createRequest();
        await request(app).get(`${base}/${requestId}/triage`);
        const stored = JSON.stringify({
            runs: tables().matter_request_triage_runs,
            items: tables().matter_request_triage_items,
            decisions: tables().matter_request_triage_decisions,
            events: tables().matter_request_events,
        });
        expect(stored).not.toContain(MARKER);
        expect(stored).not.toContain("rescisión anticipada procede");
        expect(stored).not.toContain("Contrato de arrendamiento");
        const run = tables().matter_request_triage_runs[0];
        expect(run).toMatchObject({ jev_model: JEV_MODEL, jev_input_tokens: 2_000, jev_output_tokens: 40, jev_cost_usd: 0.000084, generative_provider: "claude", generative_model: "claude-sonnet-5-5" });
        // Tokens and engine of each call go to ai_call_usage through the shared meter (Jev here; the scripted AI route reports no usage).
        const usage = tables().ai_call_usage;
        expect(usage.find((row) => row.engine === "jev")).toMatchObject({ surface: "donna_triage_jev", provider: "typesafe", model: JEV_MODEL, input_tokens: 2_000, output_tokens: 40, cost_usd: 0.000084, org_id: ORG });
        expect(usage.find((row) => row.engine === "byok")).toMatchObject({ surface: "donna_triage", provider: "claude", cost_usd: null });
        expect(JSON.stringify(usage)).not.toContain(MARKER);
        expect(run.input_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(run.read_version_ids).toEqual([VERSION]);
        // A citation is a position and a hash, not the passage.
        expect(tables().matter_request_triage_items.find((row) => row.kind === "strategy")).toMatchObject({ version_id: VERSION, text_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    });
});

describe("deciding", () => {
    it("accepting a type changes the request with its version; an edit chooses another catalog type", async () => {
        const requestId = await createRequest();
        const read = await card(requestId);
        const item = read.body.items.find((one: { kind: string }) => one.kind === "type");
        as(EDITOR);
        const stale = await request(app).post(`${base}/${requestId}/triage/items/${item.id}/decision`).send({ action: "accepted", version: 99 });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe("request_version_conflict");
        expect(tables().matter_request_triage_decisions).toHaveLength(0);
        const accepted = await request(app).post(`${base}/${requestId}/triage/items/${item.id}/decision`).send({ action: "accepted", version: 1 });
        expect(accepted.status).toBe(200);
        expect(tables().matter_requests.find((row) => row.id === requestId)).toMatchObject({ type_id: TYPE_LABORAL, version: 2 });
        expect(accepted.body.items.find((one: { id: string }) => one.id === item.id).decision).toMatchObject({ action: "accepted" });
        expect(tables().matter_request_events.map((row) => row.action)).toEqual(expect.arrayContaining(["triage_accepted", "edited"]));
        // One decision per item.
        const again = await request(app).post(`${base}/${requestId}/triage/items/${item.id}/decision`).send({ action: "discarded" });
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("triage_item_decided");
    });

    it("edits a complexity and a draft, discards another, and records the decision, not the text, in the events", async () => {
        const requestId = await createRequest();
        const read = await card(requestId);
        const complexity = read.body.items.find((one: { kind: string }) => one.kind === "complexity");
        const step = read.body.items.find((one: { kind: string }) => one.kind === "strategy");
        const question = read.body.items.find((one: { kind: string }) => one.kind === "question");
        as(EDITOR);
        const decide = (itemId: string, body: Record<string, unknown>) => request(app).post(`${base}/${requestId}/triage/items/${itemId}/decision`).send(body);
        expect((await decide(complexity.id, { action: "edited", complexity: "routine", version: 1 })).status).toBe(200);
        expect(tables().matter_requests.find((row) => row.id === requestId)!.complexity).toBe("routine");
        expect((await decide(step.id, { action: "edited", text: "Mi propio paso" })).status).toBe(200);
        expect((await decide(question.id, { action: "discarded" })).status).toBe(200);
        const decisions = tables().matter_request_triage_decisions;
        expect(decisions.map((row) => row.action)).toEqual(["edited", "edited", "discarded"]);
        expect(decisions[1]).toMatchObject({ edited_text: "Mi propio paso", actor_user_id: EDITOR });
        const events = JSON.stringify(tables().matter_request_events);
        expect(events).not.toContain("Mi propio paso");
        expect(tables().matter_request_events.filter((row) => String(row.action).startsWith("triage_"))).toHaveLength(4);
        // An urgency or a candidate is recorded as a decision and assigns nobody.
        const candidate = read.body.items.find((one: { kind: string }) => one.kind === "candidate");
        expect((await decide(candidate.id, { action: "accepted" })).status).toBe(200);
        expect(tables().matter_requests.find((row) => row.id === requestId)!.assignee_user_id ?? null).toBeNull();
        // Invalid edits are refused.
        const urgency = read.body.items.find((one: { kind: string }) => one.kind === "urgency");
        expect((await decide(urgency.id, { action: "edited", urgency: "enorme" })).status).toBe(400);
        expect((await decide(urgency.id, { action: "edited", urgency: "urgent", titulo: "x" })).status).toBe(400);
        expect((await decide(urgency.id, { action: "edited", urgency: "urgent" })).status).toBe(200);
    });

    it("refuses to decide on an earlier run's proposals", async () => {
        const requestId = await createRequest();
        const first = await card(requestId);
        as(OWNER);
        expect((await request(app).post(`${base}/${requestId}/triage`)).status).toBe(200);
        const stale = await request(app).post(`${base}/${requestId}/triage/items/${first.body.items[0].id}/decision`).send({ action: "discarded" });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe("triage_item_obsolete");
    });
});

describe("permissions", () => {
    it("lets a trainee see the card but not run it or decide", async () => {
        const requestId = await createRequest();
        const item = (await card(requestId)).body.items[0];
        as(PASANTE);
        const seen = await card(requestId);
        expect(seen.status).toBe(200);
        expect(seen.body.can_decide).toBe(false);
        const accept = await request(app).post(`${base}/${requestId}/triage/items/${item.id}/decision`).send({ action: "discarded" });
        expect(accept.status).toBe(403);
        expect(accept.body.code).toBe("triage_trainee");
        const run = await request(app).post(`${base}/${requestId}/triage`);
        expect(run.status).toBe(403);
        expect(run.body.code).toBe("triage_trainee");
        expect(tables().matter_request_triage_decisions).toHaveLength(0);
    });

    it("lets a viewer read and nothing more; a stranger and a firm admin without membership get 404", async () => {
        const requestId = await createRequest();
        const item = (await card(requestId)).body.items[0];
        as(VIEWER);
        const seen = await card(requestId);
        expect(seen.status).toBe(200);
        expect(seen.body.can_decide).toBe(false);
        expect((await request(app).post(`${base}/${requestId}/triage/items/${item.id}/decision`).send({ action: "discarded" })).body.code).toBe("matter_write_required");
        expect((await request(app).post(`${base}/${requestId}/triage`)).status).toBe(403);
        for (const user of [STRANGER, ORG_ADMIN]) {
            as(user);
            expect((await card(requestId)).status).toBe(404);
        }
    });

    it("refuses a manual run when the project's switch is off", async () => {
        const requestId = await createRequest();
        tables().projects[0].donna_enabled = false;
        as(OWNER);
        const run = await request(app).post(`${base}/${requestId}/triage`);
        expect(run.status).toBe(409);
        expect(run.body.code).toBe("donna_disabled");
    });
});

describe("the monthly cap", () => {
    const fill = (count: number, orgId = ORG, createdAt = new Date().toISOString()) => {
        for (let i = 0; i < count; i += 1)
            tables().matter_request_triage_runs.push({ id: id(10_000 + i), org_id: orgId, project_id: PROJECT, created_at: createdAt, classify_error: null, generative_status: "ok" });
    };

    it("answers 429 with the message once the firm has used 1,000 runs this month, and runs nothing", async () => {
        const requestId = await createRequest();
        fill(DONNA_MONTHLY_RUN_CAP - 2);
        as(OWNER);
        expect((await request(app).post(`${base}/${requestId}/triage`)).status).toBe(200);
        h.jev.calls = [];
        h.llm.calls = [];
        const refused = await request(app).post(`${base}/${requestId}/triage`);
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe("donna_monthly_cap");
        expect(refused.body.detail).toContain("Límite mensual de Donna");
        expect(h.jev.calls).toHaveLength(0);
        expect(h.llm.calls).toHaveLength(0);
        expect((await card(requestId)).body.usage).toMatchObject({ limit: 1_000 });
    });

    it("stops the automatic run too, but still creates the request, and counts only this month and this firm", async () => {
        fill(DONNA_MONTHLY_RUN_CAP);
        as(OWNER);
        expect((await create()).status).toBe(201);
        await settleTriageRuns();
        expect(h.jev.calls).toHaveLength(0);
        expect(tables().matter_request_triage_runs).toHaveLength(DONNA_MONTHLY_RUN_CAP);
        tables().matter_request_triage_runs.length = 0;
        fill(DONNA_MONTHLY_RUN_CAP, id(101));
        fill(DONNA_MONTHLY_RUN_CAP, ORG, "2020-01-15T12:00:00.000Z");
        expect((await create()).status).toBe(201);
        await settleTriageRuns();
        expect(h.jev.calls).toHaveLength(1);
    });
});

describe("the usage view", () => {
    it("shows the firm's owner or admin the month's runs, tokens and cost, with no text and no names", async () => {
        const requestId = await createRequest();
        as(OWNER);
        await request(app).post(`${base}/${requestId}/triage`);
        for (const user of [OWNER, ORG_ADMIN]) {
            as(user);
            const usage = await request(app).get(`/orgs/${ORG}/donna/usage`);
            expect(usage.status).toBe(200);
            expect(usage.body).toMatchObject({
                limit: 1_000,
                used: 2,
                remaining: 998,
                engines: { jev: { runs: 2, input_tokens: 4_000, output_tokens: 80, cost_usd: 0.000168 }, byok: { runs: 2 } },
                projects: [{ label: "Proyecto 1", runs: 2 }],
            });
            const body = JSON.stringify(usage.body);
            expect(body).not.toContain(MARKER);
            expect(body).not.toContain("Contrato de arrendamiento");
            expect(body).not.toContain(PROJECT);
        }
    });

    it("is closed to a member who is not an owner or admin, and to a stranger to the firm", async () => {
        as(EDITOR);
        const member = await request(app).get(`/orgs/${ORG}/donna/usage`);
        expect(member.status).toBe(403);
        expect(member.body.code).toBe("org_admin_required");
        as(id(77));
        expect((await request(app).get(`/orgs/${ORG}/donna/usage`)).status).toBe(404);
    });
});
