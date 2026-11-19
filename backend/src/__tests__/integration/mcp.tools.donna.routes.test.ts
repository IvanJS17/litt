import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";

// The Donna tools of /mcp (list_retainer_requests, get_client_profile,
// get_deadline_radar, get_retainer_report) end to end: OAuth → tools/call over
// JSON-RPC, against the in-memory firm of helpers/mcpToolsWorld.ts plus three
// retainer matters. The web routes run on the same data, so the matrix compares
// what each person gets from a tool with what the web answers.
const h = vi.hoisted(() => ({
    caller: { id: "", email: "" },
    state: null as null | { db: unknown; tables: Record<string, Record<string, unknown>[]>; failNext: (t: string, o: string, e: unknown) => void },
    texts: {} as Record<string, string | null>,
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
                res.locals.userEmail = h.caller.email;
                res.locals.personalWorkspaceDisabled = false;
                res.locals.token = "web-session-token";
                next();
            }),
    };
});
// The cited text of a version (the real reader joins the text index).
vi.mock("../../lib/documentTextCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/documentTextCache")>()),
    loadVersionTextState: vi.fn(async (_db: unknown, _documentId: string, versionId: string) => {
        const version = h.state!.tables.document_versions.find((row) => row.id === versionId);
        if (!version || version.deleted_at) return null;
        return { revision: "r", text: h.texts[versionId] ?? null, textlessPageCount: 0 };
    }),
}));

import { app } from "../../app";
import { resetGrantBudgets } from "../../modules/mcp/mcp.limits";
import { registerLegalVersion } from "../../lib/managedAccounts";
import {
    buildWorld,
    DOC_PRIVATE,
    ORG,
    ORG2,
    PEOPLE,
    PROJECT_PRIVATE,
    PROJECT_PUBLIC,
    VERSION_PRIVATE,
    type PersonName,
} from "../helpers/mcpToolsWorld";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WS = id("f1111111", 1);
const WS2 = id("f2222222", 1);
// Matters: M1 is mcpToolsWorld's private matter (PROJECT_PRIVATE), made a retainer.
const MATTER = id("f3333333", 1);
const PROJECT_R2 = id("aaaaaaaa", 21);
const MATTER_R2 = id("f3333333", 2);
const PROJECT_PLAIN = id("aaaaaaaa", 22);
const MATTER_PLAIN = id("f3333333", 3);
const PROJECT_FOREIGN = id("aaaaaaaa", 23);
const MATTER_FOREIGN = id("f3333333", 4);
const DOC_R2 = id("bbbbbbbb", 21);
const VERSION_R2 = id("cccccccc", 21);
const DOC_RHELD = id("bbbbbbbb", 22);
const VERSION_RHELD = id("cccccccc", 22);
const TYPE_A = id("f4444444", 1);
const TYPE_B = id("f4444444", 2);

const TEXT = "CLÁUSULA SEGUNDA. La vigencia vence pronto, con treinta días de aviso.";
const QUOTE = "CLÁUSULA SEGUNDA";
const HELD_TEXT = "Borrador del pasante: cláusula tercera, secreto del borrador.";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const mexicoToday = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (days: number) => new Date(Date.parse(`${mexicoToday()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const FACTS = {
    expiry: id("f5555555", 1), // expiry today+20, notice 10 days → notice today+10
    overdue: id("f5555555", 2), // renewal notice today-5
    far: id("f5555555", 3), // expiry today+60
    pending: id("f5555555", 4),
    rejected: id("f5555555", 5),
    stale: id("f5555555", 6), // confirmed, but the cited text changed
    held: id("f5555555", 7), // confirmed, cites a pasante's unapproved version
    r2: id("f5555555", 8), // M2: expiry today+3
};
let ticks = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, 0, ticks++)).toISOString();

beforeEach(() => {
    ticks = 0;
    h.state = buildWorld();
    h.texts = { [VERSION_PRIVATE]: TEXT, [VERSION_R2]: TEXT, [VERSION_RHELD]: HELD_TEXT };
    resetGrantBudgets();
    registerLegalVersion("test-terms");
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_READ_MAX", "100000");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "100000");
    seed();
});
afterEach(() => vi.unstubAllEnvs());

const tables = () => h.state!.tables;
const as = (name: PersonName) => {
    h.caller = { id: PEOPLE[name].id, email: PEOPLE[name].email };
};

function seedFact(factId: string, matter: string, doc: string, version: string, kind: string, data: Record<string, unknown>, opts: { actions?: string[]; sha?: string; label?: string; text?: string } = {}) {
    tables().matter_profile_facts.push({
        id: factId,
        matter_id: matter,
        kind,
        label: opts.label ?? `Dato ${factId.slice(-3)}`,
        data,
        document_id: doc,
        version_id: version,
        start_char: 0,
        end_char: QUOTE.length,
        quote: QUOTE,
        text_sha256: opts.sha ?? sha(opts.text ?? TEXT),
        created_by: PEOPLE.editor.id,
        created_at: stamp(),
    });
    for (const action of ["created", ...(opts.actions ?? [])])
        tables().matter_profile_fact_events.push({
            id: id("f6666666", tables().matter_profile_fact_events.length + 1),
            fact_id: factId,
            matter_id: matter,
            actor_user_id: PEOPLE.editor.id,
            action,
            text_sha256: action === "confirmed" ? (opts.sha ?? sha(opts.text ?? TEXT)) : null,
            reason: null,
            created_at: stamp(),
        });
}

let requestCounter = 0;
function seedRequest(matter: string, fields: Record<string, unknown> = {}) {
    requestCounter += 1;
    tables().matter_requests.push({
        id: id("f7777777", requestCounter),
        matter_id: matter,
        type_id: TYPE_A,
        title: `Solicitud ${requestCounter}`,
        complexity: "routine",
        status: "received",
        assignee_user_id: null,
        assignee_level: null,
        received_on: plusDays(-3),
        closed_on: null,
        version: 1,
        created_at: stamp(),
        updated_at: stamp(),
        ...fields,
    });
}

function seed() {
    requestCounter = 0;
    const t = tables();
    t.organizations.forEach((o) => (o.kind = "team"));
    t.workspaces = [
        { id: WS, organization_id: ORG },
        { id: WS2, organization_id: ORG2 },
    ];
    // M1 = the world's private matter; M2 only the owner (and an org admin on the team without a membership); a plain private matter; a matter of Firm B.
    t.projects.push(
        { id: PROJECT_R2, user_id: PEOPLE.owner.id, org_id: ORG, name: "Iguala Dos", cm_number: "CM-021", practice: "corporativo", visibility: "private", archived_at: null, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" },
        { id: PROJECT_PLAIN, user_id: PEOPLE.owner.id, org_id: ORG, name: "Juicio Simple", cm_number: "CM-022", practice: "litigio", visibility: "private", archived_at: null, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" },
        { id: PROJECT_FOREIGN, user_id: PEOPLE.outsider.id, org_id: ORG2, name: "Iguala Firm B", cm_number: "CM-023", practice: "civil", visibility: "private", archived_at: null, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" },
    );
    t.private_matter_team.push(
        { project_id: PROJECT_R2, user_id: PEOPLE.owner.id },
        { project_id: PROJECT_R2, user_id: PEOPLE.admin.id },
        { project_id: PROJECT_PLAIN, user_id: PEOPLE.owner.id },
        { project_id: PROJECT_FOREIGN, user_id: PEOPLE.outsider.id },
        // `narrow` may open M1 on the web (and is a member of Firm B, where its app connects).
        { project_id: PROJECT_PRIVATE, user_id: PEOPLE.narrow.id },
    );
    t.project_org_access_overrides.push({ project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.narrow.id, role: "viewer" });
    t.matters = [
        { id: MATTER, project_id: PROJECT_PRIVATE, workspace_id: WS, name: "Litigio Reservado", is_retainer: true, visibility: "private" },
        { id: MATTER_R2, project_id: PROJECT_R2, workspace_id: WS, name: "Iguala Dos", is_retainer: true, visibility: "private" },
        { id: MATTER_PLAIN, project_id: PROJECT_PLAIN, workspace_id: WS, name: "Juicio Simple", is_retainer: false, visibility: "private" },
        { id: MATTER_FOREIGN, project_id: PROJECT_FOREIGN, workspace_id: WS2, name: "Iguala Firm B", is_retainer: true, visibility: "private" },
    ];
    const member = (matter: string, person: PersonName, role: string) => ({ matter_id: matter, user_id: PEOPLE[person].id, status: "active", role });
    t.matter_memberships = [
        member(MATTER, "owner", "matter_owner"),
        member(MATTER, "editor", "editor"),
        member(MATTER, "viewer", "viewer"),
        member(MATTER, "apprentice", "editor"),
        member(MATTER, "narrow", "viewer"),
        member(MATTER_R2, "owner", "matter_owner"),
        member(MATTER_PLAIN, "owner", "matter_owner"),
        member(MATTER_FOREIGN, "outsider", "matter_owner"),
    ];
    t.matter_request_types = [
        { id: TYPE_A, organization_id: ORG, seed_key: "contracts_clients", name: null, sort_order: 10, archived_at: null },
        { id: TYPE_B, organization_id: ORG, seed_key: null, name: "Poderes", sort_order: 20, archived_at: null },
    ];
    t.matter_requests = [];
    t.matter_request_rounds = [];
    t.matter_profile_facts = [];
    t.matter_profile_fact_events = [];
    t.matter_radar_item_events = [];
    t.matter_obligation_item_events = [];
    t.matter_report_sent_events = [];
    // Documents the facts cite: a version of M2, and a pasante's unapproved one in M1.
    t.documents.push(
        { id: DOC_R2, project_id: PROJECT_R2, org_id: ORG, user_id: PEOPLE.owner.id, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: VERSION_R2, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" },
        { id: DOC_RHELD, project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.apprentice.id, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: VERSION_RHELD, created_at: "2026-11-04T10:00:00Z", updated_at: "2026-11-06T10:00:00Z" },
    );
    t.document_versions.push(
        { id: VERSION_R2, document_id: DOC_R2, storage_path: "p/21", source: "upload", version_number: 1, filename: "iguala.docx", file_type: "docx", size_bytes: 10, page_count: 1, textless_page_count: 0, content_sha256: "d".repeat(64), training_stage: null, deleted_at: null, text_revision: "rev-21", created_at: "2026-11-03T10:00:00Z" },
        { id: VERSION_RHELD, document_id: DOC_RHELD, storage_path: "p/22", source: "upload", version_number: 1, filename: "borrador-pasante.docx", file_type: "docx", size_bytes: 10, page_count: 1, textless_page_count: 0, content_sha256: "e".repeat(64), training_stage: "pasante", deleted_at: null, text_revision: "rev-22", created_at: "2026-11-04T10:00:00Z" },
    );

    const confirmed = ["confirmed"];
    seedFact(FACTS.expiry, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(20), notice_days: 10, notice_day_type: "calendar" }, { actions: confirmed, label: "Vigencia del arrendamiento" });
    seedFact(FACTS.overdue, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "renewal_notice", date_on: plusDays(-5) }, { actions: confirmed, label: "Aviso de renovación" });
    seedFact(FACTS.far, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(60) }, { actions: confirmed, label: "Vigencia lejana" });
    seedFact(FACTS.pending, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(2) }, { label: "Propuesto por IA" });
    seedFact(FACTS.rejected, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(3) }, { actions: ["rejected"], label: "Rechazado" });
    seedFact(FACTS.stale, MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(4) }, { actions: confirmed, sha: sha("otro texto"), label: "Obsoleto" });
    seedFact(FACTS.held, MATTER, DOC_RHELD, VERSION_RHELD, "other", { note: "Nota del pasante" }, { actions: confirmed, text: HELD_TEXT, label: "Dato del borrador" });
    seedFact(FACTS.r2, MATTER_R2, DOC_R2, VERSION_R2, "date", { date_kind: "expiry", date_on: plusDays(3) }, { actions: confirmed, label: "Vigencia Iguala Dos" });

    seedRequest(MATTER, { status: "received", received_on: plusDays(-2), title: "Contrato nuevo proveedor" });
    seedRequest(MATTER, { status: "in_review", received_on: plusDays(-10), type_id: TYPE_B, assignee_user_id: PEOPLE.editor.id, assignee_level: "senior" });
    seedRequest(MATTER, { status: "closed", received_on: plusDays(-30), closed_on: plusDays(-20) });
    seedRequest(MATTER_R2, { title: "Solicitud de la iguala dos" });
    t.matter_request_rounds.push(
        { id: id("f8888888", 1), request_id: id("f7777777", 3), matter_id: MATTER, round_number: 1 },
        { id: id("f8888888", 2), request_id: id("f7777777", 3), matter_id: MATTER, round_number: 2 },
    );
}

const ALL_SCOPES = ["litt.read", "litt.run", "litt.write", "litt.chat"];

async function connect(opts: { workspaces?: string[]; scopes?: string[] } = {}) {
    const reg = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const clientId = reg.body.client_id as string;
    const v = randomBytes(32).toString("base64url");
    const auth = await request(app)
        .get("/oauth/authorize")
        .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: "S256", resource: RESOURCE, scope: ALL_SCOPES.join(" "), state: "s" })
        .redirects(0);
    const requestId = new URL(auth.headers.location).searchParams.get("request")!;
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: opts.workspaces ?? [ORG], scopes: opts.scopes ?? ["litt.read"] });
    expect(decision.status).toBe(200);
    const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
    const token = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT, resource: RESOURCE });
    expect(token.status).toBe(200);
    return token.body.access_token as string;
}

const rpc = (token: string, method: string, params: object = {}) =>
    request(app)
        .post("/mcp")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Authorization", `Bearer ${token}`)
        .send({ jsonrpc: "2.0", id: 1, method, params });

type Reply = { result?: { content: { text: string }[]; isError?: boolean; tools?: { name: string; description: string; annotations: Record<string, boolean> }[] }; error?: { message: string } };
const bodyOf = (res: { body: unknown; text: string }): Reply =>
    (res.body && Object.keys(res.body as object).length ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1])) as Reply;

type ToolAnswer = {
    ok: boolean;
    code: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>;
    raw: string;
};

async function callTool(token: string, name: string, args: object = {}): Promise<ToolAnswer> {
    const res = await rpc(token, "tools/call", { name, arguments: args });
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    if (body.error || !body.result?.content?.[0]) return { ok: false, code: "invalid_params", data: { detail: body.error?.message }, raw: res.text };
    let data: ToolAnswer["data"];
    try {
        data = JSON.parse(body.result.content[0].text);
    } catch {
        return { ok: false, code: "invalid_params", data: { detail: body.result.content[0].text }, raw: res.text };
    }
    return body.result.isError ? { ok: false, code: data.code as string, data, raw: res.text } : { ok: true, code: null, data, raw: res.text };
}

const web = (projectId: string, matterId: string) => `/projects/${projectId}/matters/${matterId}`;
const DONNA_TOOLS = ["list_retainer_requests", "get_client_profile", "get_deadline_radar", "get_retainer_report"];

describe("the catalog as a client sees it", () => {
    it("lists the four Donna tools as read-only, with both languages and a url-bearing contract", async () => {
        as("owner");
        const token = await connect();
        const list = bodyOf(await rpc(token, "tools/list")).result!.tools!;
        for (const name of DONNA_TOOLS) {
            const tool = list.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
            expect(tool!.description).toContain(" | ");
        }
    });
});

// ---------------------------------------------------------------------------
// Permission matrix: every tool allows what the web route allows
// ---------------------------------------------------------------------------

type Want = { requests: boolean; profile: boolean; radar: boolean; report: boolean };
const ALL: Want = { requests: true, profile: true, radar: true, report: true };
const NONE: Want = { requests: false, profile: false, radar: false, report: false };
const EXPECTED: Record<PersonName, { web: Want; tool: Want }> = {
    owner: { web: ALL, tool: ALL },
    editor: { web: ALL, tool: ALL },
    // A viewer reads requests, profile and radar; the report is for owners and editors.
    viewer: { web: { ...ALL, report: false }, tool: { ...ALL, report: false } },
    // A pasante with an editor membership reads like any editor.
    apprentice: { web: ALL, tool: ALL },
    // An org admin is not on the private matter's team.
    admin: { web: NONE, tool: NONE },
    outsider: { web: NONE, tool: NONE },
    // The web lets it in; its app's grant only covers Firm B.
    narrow: { web: { ...ALL, report: false }, tool: NONE },
};
const PEOPLE_NAMES = Object.keys(PEOPLE) as PersonName[];
const restOk = (status: number) => status >= 200 && status < 300;

describe("parity: each tool allows and denies what the web route does (M1, a private retainer)", () => {
    for (const person of PEOPLE_NAMES) {
        it(`${person}`, async () => {
            as(person);
            if (person === "apprentice") tables().training_stages.push({ org_id: ORG, trainee_user_id: PEOPLE.apprentice.id, stage: "pasante", practice: null });
            const workspaces = person === "outsider" || person === "narrow" ? [ORG2] : [ORG];
            const token = await connect({ workspaces });
            const base = web(PROJECT_PRIVATE, MATTER);
            const rest = {
                requests: await request(app).get(`${base}/requests`),
                profile: await request(app).get(`${base}/profile`),
                radar: await request(app).get(`${base}/radar`),
                report: await request(app).get(`${base}/report/90d`),
            };
            const tools = {
                requests: await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE }),
                profile: await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE }),
                radar: await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE }),
                report: await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE }),
            };
            const want = EXPECTED[person];
            for (const key of ["requests", "profile", "radar", "report"] as const) {
                expect(restOk(rest[key].status), `REST ${key}`).toBe(want.web[key]);
                expect(tools[key].ok, `tool ${key}`).toBe(want.tool[key]);
                if (!want.tool[key]) {
                    // Never a hint that the matter exists, unless the person is a reader refused the report.
                    expect(tools[key].code, `${key} code`).toBe(person !== "narrow" && rest[key].status === 403 ? "matter_write_required" : "not_found");
                }
            }
            if (want.tool.requests) expect(tools.requests.data.total).toBe(3);
        });
    }

    it("an org admin on the team of a matter, with no matter membership, gets not_found (the web's 404)", async () => {
        as("admin");
        const token = await connect();
        const base = web(PROJECT_R2, MATTER_R2);
        for (const path of ["requests", "profile", "radar", "report/90d"]) expect((await request(app).get(`${base}/${path}`)).status).toBe(404);
        for (const [name, args] of [
            ["list_retainer_requests", {}],
            ["get_client_profile", {}],
            ["get_deadline_radar", {}],
            ["get_retainer_report", {}],
        ] as const) {
            const out = await callTool(token, name, { matter_id: PROJECT_R2, ...args });
            expect(out.code, name).toBe("not_found");
        }
    });

    it("a viewer asking for the report gets forbidden, as the web's 403", async () => {
        as("viewer");
        const token = await connect();
        expect((await request(app).get(`${web(PROJECT_PRIVATE, MATTER)}/report/90d`)).status).toBe(403);
        const out = await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE });
        expect(out.code).toBe("matter_write_required");
        expect(out.data.suggested_action).toBeTruthy();
    });

    it("a matter of another firm is not found (never forbidden)", async () => {
        as("owner");
        const token = await connect();
        for (const name of DONNA_TOOLS) expect((await callTool(token, name, { matter_id: PROJECT_FOREIGN })).code, name).toBe("not_found");
    });

    it("a matter that does not exist is not found", async () => {
        as("owner");
        const token = await connect();
        for (const name of DONNA_TOOLS) expect((await callTool(token, name, { matter_id: id("aaaaaaaa", 999) })).code, name).toBe("not_found");
    });
});

describe("a matter that is not a retainer", () => {
    it("answers matter_not_retainer for a private matter that is not marked and for a public matter", async () => {
        as("owner");
        const token = await connect();
        for (const project of [PROJECT_PLAIN, PROJECT_PUBLIC]) {
            for (const name of DONNA_TOOLS) {
                const out = await callTool(token, name, { matter_id: project });
                expect(out.ok, `${name} ${project}`).toBe(false);
                expect(out.code, name).toBe("matter_not_retainer");
                expect(out.data.suggested_action).toBeTruthy();
            }
        }
        // The web: empty answers (the report is a 404).
        const plain = web(PROJECT_PLAIN, MATTER_PLAIN);
        expect((await request(app).get(`${plain}/requests`)).body).toMatchObject({ retainer: false, requests: [] });
        expect((await request(app).get(`${plain}/report/90d`)).status).toBe(404);
    });
});

// ---------------------------------------------------------------------------
// What each tool returns
// ---------------------------------------------------------------------------

describe("list_retainer_requests", () => {
    it("lists the matter's requests with type, level and rounds, never hours, and a url", async () => {
        as("viewer");
        const token = await connect();
        const out = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(true);
        expect(out.data.total).toBe(3);
        expect(out.data.url).toBe(`http://localhost:3000/projects/${PROJECT_PRIVATE}/matters/${MATTER}/requests`);
        const byTitle = Object.fromEntries(out.data.requests.map((r: { title: string }) => [r.title, r]));
        expect(byTitle["Contrato nuevo proveedor"]).toMatchObject({ status: "received", type: "contracts_clients", assigned: false, round_count: 0 });
        const closed = out.data.requests.find((r: { status: string }) => r.status === "closed");
        expect(closed).toMatchObject({ round_count: 2, closed_on: plusDays(-20) });
        const review = out.data.requests.find((r: { status: string }) => r.status === "in_review");
        expect(review).toMatchObject({ type: "Poderes", assigned: true, assignee_level: "senior" });
        expect(out.raw).not.toMatch(/\b(hours?|horas?|minutes?|minutos?)\b/i);
        // Requests of the other matter never appear.
        expect(out.raw).not.toContain("Solicitud de la iguala dos");
        // Nobody's user id leaks: only the level.
        expect(out.raw).not.toContain(PEOPLE.editor.id);
    });

    it("filters by status and by open", async () => {
        as("owner");
        const token = await connect();
        const closed = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, status: "closed" });
        expect(closed.data.requests.map((r: { status: string }) => r.status)).toEqual(["closed"]);
        const open = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, status: "open" });
        expect(open.data.total).toBe(2);
        expect((await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, status: "nonsense" })).code).toBe("invalid_params");
    });

    it("pages with a cursor and caps a page at 50", async () => {
        as("owner");
        for (let i = 0; i < 27; i++) seedRequest(MATTER, { received_on: plusDays(-40 - i), title: `Bulk ${i}` });
        const token = await connect();
        const first = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, limit: 10 });
        expect(first.data.requests).toHaveLength(10);
        expect(first.data.total).toBe(30);
        expect(first.data.next_cursor).toBeTruthy();
        const second = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, limit: 10, cursor: first.data.next_cursor });
        expect(second.data.requests).toHaveLength(10);
        const ids = new Set([...first.data.requests, ...second.data.requests].map((r: { id: string }) => r.id));
        expect(ids.size).toBe(20);
        const big = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, limit: 50 });
        expect(big.data.requests).toHaveLength(30);
        expect(big.data.next_cursor).toBeNull();
        expect((await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, limit: 51 })).code).toBe("invalid_params");
        expect((await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE, cursor: "bogus" })).code).toBe("invalid_cursor");
    });
});

describe("get_client_profile", () => {
    it("returns only confirmed, not stale facts with their citation; the rest are counted", async () => {
        as("viewer");
        const token = await connect();
        const out = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(true);
        const ids = out.data.facts.map((f: { id: string }) => f.id).sort();
        expect(ids).toEqual([FACTS.expiry, FACTS.overdue, FACTS.far, FACTS.held].sort());
        expect(out.data).toMatchObject({ confirmed_total: 4, truncated: false, pending_count: 1, stale_count: 1 });
        // Neither a proposal, a rejected nor a stale fact is in the answer.
        for (const hidden of [FACTS.pending, FACTS.rejected, FACTS.stale]) expect(out.raw).not.toContain(hidden);
        const expiry = out.data.facts.find((f: { id: string }) => f.id === FACTS.expiry);
        expect(expiry).toMatchObject({
            kind: "date",
            label: "Vigencia del arrendamiento",
            data: { date_kind: "expiry", date_on: plusDays(20) },
            citation: { document_id: DOC_PRIVATE, version_id: VERSION_PRIVATE, version_number: 1, filename: "demanda.pdf", start_char: 0, end_char: QUOTE.length },
        });
        // The quote is data, marked as such.
        expect(expiry.citation.quote).toMatch(/^<<<LITT_UNTRUSTED_DOCUMENT_TEXT \S+>>>\n/);
        expect(expiry.citation.quote).toContain(QUOTE);
        expect(out.data.url).toBe(`http://localhost:3000/projects/${PROJECT_PRIVATE}/matters/${MATTER}/profile`);
    });

    it("withholds the quote of a pasante's unapproved version and records the egress of the rest first", async () => {
        as("owner");
        const token = await connect();
        const out = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        const held = out.data.facts.find((f: { id: string }) => f.id === FACTS.held);
        expect(held.citation.quote_withheld).toBe(true);
        expect(held.citation.quote).toBeUndefined();
        expect(out.raw).not.toContain("Borrador del pasante");
        const egress = tables().audit_events.filter((a) => a.action === "mcp.client_ai_egress");
        // One row per cited version that left: three facts quoted VERSION_PRIVATE.
        expect(egress).toHaveLength(1);
        expect(egress[0]).toMatchObject({ document_id: DOC_PRIVATE, detail: expect.objectContaining({ version_id: VERSION_PRIVATE, characters: 3 * QUOTE.length }) });
        expect(tables().audit_events.some((a) => a.action === "mcp.get_client_profile" && a.project_id === PROJECT_PRIVATE)).toBe(true);
    });

    it("does not return the quotes when the egress cannot be recorded", async () => {
        as("owner");
        const token = await connect();
        let inserts = 0;
        const real = (h.state!.db as { from: (t: string) => unknown }).from.bind(h.state!.db);
        // The strict audit row passes, the egress row fails.
        (h.state!.db as { from: (t: string) => unknown }).from = (table: string) => {
            if (table === "audit_events" && ++inserts === 2) h.state!.failNext("audit_events", "insert", { message: "disk full at /var/lib/pg" });
            return real(table);
        };
        const out = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("internal_error");
        expect(out.raw).not.toContain(QUOTE);
        expect(out.raw).not.toContain("disk full");
    });

    it("does not run when the audit row cannot be written (strict)", async () => {
        as("owner");
        const token = await connect();
        h.state!.failNext("audit_events", "insert", { message: "down" });
        const out = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        expect(out.code).toBe("audit_unavailable");
    });

    it("caps the facts at 100 and says so", async () => {
        as("owner");
        for (let i = 0; i < 105; i++) seedFact(id("f9999999", i + 1), MATTER, DOC_PRIVATE, VERSION_PRIVATE, "other", { note: `n${i}` }, { actions: ["confirmed"], label: `Extra ${i}` });
        const token = await connect();
        const out = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        expect(out.data.facts).toHaveLength(100);
        expect(out.data.confirmed_total).toBe(109);
        expect(out.data.truncated).toBe(true);
    });
});

describe("get_deadline_radar", () => {
    it("one matter: open items overdue and within the window, computed from confirmed facts only", async () => {
        as("editor");
        const token = await connect();
        const out = await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(true);
        expect(out.data.window_days).toBe(30);
        const keys = out.data.items.map((i: { key: string }) => i.key);
        // overdue, notice (today+10), expiry (today+20); the +60 one is beyond 30 days; pending/rejected/stale yield nothing.
        expect(keys).toEqual([`${FACTS.overdue}:notice`, `${FACTS.expiry}:notice`, `${FACTS.expiry}:expiry`]);
        expect(out.data.items[0]).toMatchObject({ due_on: plusDays(-5), days_left: -5, bucket: "overdue", state: "open", type: "notice" });
        expect(out.data.items[2]).toMatchObject({ due_on: plusDays(20), days_left: 20, bucket: "next_30" });
        // Pointers, not text.
        expect(out.data.items[2].source).toMatchObject({ document_id: DOC_PRIVATE, version_id: VERSION_PRIVATE, filename: "demanda.pdf" });
        expect(out.raw).not.toContain(QUOTE);
        expect(out.data.url).toBe(`http://localhost:3000/projects/${PROJECT_PRIVATE}/matters/${MATTER}/radar`);
        expect(out.data.planning_aid).toMatch(/not a legal deadline/);
    });

    it("window_days widens the look-ahead (up to 90) and leaves closed items out", async () => {
        as("owner");
        const token = await connect();
        const wide = await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE, window_days: 90 });
        expect(wide.data.items.map((i: { key: string }) => i.key)).toContain(`${FACTS.far}:expiry`);
        const narrow = await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE, window_days: 5 });
        expect(narrow.data.items.map((i: { key: string }) => i.key)).toEqual([`${FACTS.overdue}:notice`]);
        expect((await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE, window_days: 91 })).code).toBe("invalid_params");
        expect((await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE, window_days: 0 })).code).toBe("invalid_params");
        // Done on the web: it leaves the open list and is counted as omitted.
        tables().matter_radar_item_events.push({ id: id("fa000000", 1), matter_id: MATTER, fact_id: FACTS.overdue, item_type: "notice", action: "done", due_on: plusDays(-5), reason: null, actor_user_id: PEOPLE.owner.id, created_at: stamp() });
        const after = await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE, window_days: 5 });
        expect(after.data.items).toEqual([]);
        expect(after.data.closed_items_omitted).toBe(1);
    });

    it("«Hoy»: the open items across the matters the person is an active member of", async () => {
        as("owner");
        const token = await connect();
        const out = await callTool(token, "get_deadline_radar", {});
        expect(out.ok).toBe(true);
        expect(out.data.window_days).toBe(30);
        expect(out.data.workspaces).toEqual([ORG]);
        expect(out.data.items.map((i: { key: string }) => i.key)).toEqual([
            `${FACTS.overdue}:notice`,
            `${FACTS.r2}:expiry`,
            `${FACTS.expiry}:notice`,
            `${FACTS.expiry}:expiry`,
        ]);
        const r2 = out.data.items.find((i: { key: string }) => i.key === `${FACTS.r2}:expiry`);
        expect(r2).toMatchObject({ matter_id: PROJECT_R2, matter_name: "Iguala Dos", workspace: ORG, days_left: 3 });
        expect(r2.url).toBe(`http://localhost:3000/projects/${PROJECT_R2}/matters/${MATTER_R2}/radar`);
        // The facade's own rule: «Hoy» stops at 30 days even when a wider window is asked.
        const wide = await callTool(token, "get_deadline_radar", { window_days: 90 });
        expect(wide.data.window_days).toBe(30);
        expect(wide.data.items.map((i: { key: string }) => i.key)).not.toContain(`${FACTS.far}:expiry`);
        const short = await callTool(token, "get_deadline_radar", { window_days: 5 });
        expect(short.data.items.map((i: { key: string }) => i.key)).toEqual([`${FACTS.overdue}:notice`, `${FACTS.r2}:expiry`]);
        // The web's own «Hoy» holds the same items.
        as("owner");
        const webToday = await request(app).get(`/orgs/${ORG}/radar/today`);
        expect(webToday.body.items.map((i: { key: string }) => i.key).sort()).toEqual(out.data.items.map((i: { key: string }) => i.key).sort());
    });

    it("«Hoy» follows each person's memberships, exactly like the web", async () => {
        const cases: [PersonName, string[]][] = [
            ["editor", [`${FACTS.overdue}:notice`, `${FACTS.expiry}:notice`, `${FACTS.expiry}:expiry`]],
            ["viewer", [`${FACTS.overdue}:notice`, `${FACTS.expiry}:notice`, `${FACTS.expiry}:expiry`]],
            // The org admin has no matter membership: nothing, as the web.
            ["admin", []],
        ];
        for (const [person, keys] of cases) {
            as(person);
            const token = await connect();
            const out = await callTool(token, "get_deadline_radar", {});
            expect(out.ok, person).toBe(true);
            expect(out.data.items.map((i: { key: string }) => i.key), person).toEqual(keys);
            const webToday = await request(app).get(`/orgs/${ORG}/radar/today`);
            expect(webToday.body.items.map((i: { key: string }) => i.key).sort(), `${person} web`).toEqual([...keys].sort());
        }
    });

    it("«Hoy» only covers the firms of the connection; a workspace outside it is refused", async () => {
        as("narrow");
        const token = await connect({ workspaces: [ORG2] });
        const out = await callTool(token, "get_deadline_radar", {});
        expect(out.ok).toBe(true);
        expect(out.data.items).toEqual([]);
        expect(out.data.workspaces).toEqual([ORG2]);
        const other = await callTool(token, "get_deadline_radar", { workspace: ORG });
        expect(other.code).toBe("workspace_not_found");
        // Personal has no «Hoy».
        expect((await callTool(token, "get_deadline_radar", { workspace: "personal" })).code).toBe("workspace_not_found");
        // The matter of Firm A is not found through this app either, even though `narrow` may open it on the web.
        expect((await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE })).code).toBe("not_found");
    });

    it("«Hoy» restricted to one workspace", async () => {
        as("owner");
        const token = await connect();
        const out = await callTool(token, "get_deadline_radar", { workspace: ORG });
        expect(out.data.items.length).toBe(4);
    });

    it("caps the items at 100 and says so", async () => {
        as("owner");
        // Each fact with a notice period makes two items: 60 facts, 120 items, all due within a month.
        for (let i = 0; i < 60; i++)
            seedFact(id("fb000000", i + 1), MATTER, DOC_PRIVATE, VERSION_PRIVATE, "date", { date_kind: "expiry", date_on: plusDays(25), notice_days: 5, notice_day_type: "calendar" }, { actions: ["confirmed"] });
        const token = await connect();
        const one = await callTool(token, "get_deadline_radar", { matter_id: PROJECT_PRIVATE });
        expect(one.data.items).toHaveLength(100);
        expect(one.data.truncated).toBe(true);
        const today = await callTool(token, "get_deadline_radar", {});
        expect(today.data.items).toHaveLength(100);
        expect(today.data.truncated).toBe(true);
    });
});

describe("get_retainer_report", () => {
    it("is the web's 90-day report, with the planning-aid texts and no hours", async () => {
        as("owner");
        const token = await connect();
        const out = await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(true);
        const webReport = await request(app).get(`${web(PROJECT_PRIVATE, MATTER)}/report/90d`);
        expect(out.data).toMatchObject({
            matter_id: PROJECT_PRIVATE,
            locale: "es-MX",
            matter_name: "Litigio Reservado",
            period: webReport.body.period,
            horizon: webReport.body.horizon,
            disclaimer: webReport.body.disclaimer,
            scope_note: webReport.body.scope_note,
            truncated: false,
        });
        expect(out.data.requests.total).toBe(webReport.body.requests.total);
        expect(out.data.requests.closed_count).toBe(webReport.body.requests.closed.length);
        expect(out.data.profile.confirmed_total).toBe(webReport.body.profile.confirmed_total);
        expect(out.data.radar.upcoming.map((i: { key: string }) => i.key)).toEqual(webReport.body.radar.upcoming.map((i: { key: string }) => i.key));
        expect(out.data.url).toBe(`http://localhost:3000/projects/${PROJECT_PRIVATE}/matters/${MATTER}/report`);
        expect(out.raw).not.toMatch(/\b(hours?|horas?|hrs?|minutes?|minutos?|tarifa|hourly)\b/i);
    });

    it("takes 30, 60 or 90 days and a locale; anything else is refused", async () => {
        as("editor");
        const token = await connect();
        const short = await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE, days: 30, locale: "en-US" });
        expect(short.data.period.days).toBe(30);
        expect(short.data.locale).toBe("en-US");
        expect(short.data.disclaimer).toMatch(/^Planning aid/);
        // The expiry 60 days away is outside a 30-day look-ahead.
        expect(short.data.radar.upcoming.map((i: { key: string }) => i.key)).not.toContain(`${FACTS.far}:expiry`);
        expect((await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE, days: 60 })).data.period.days).toBe(60);
        expect((await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE, days: 45 })).code).toBe("invalid_params");
        expect((await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE, locale: "fr-FR" })).code).toBe("invalid_params");
    });

    it("caps each list at 50 rows and keeps the counts complete", async () => {
        as("owner");
        for (let i = 0; i < 55; i++) seedRequest(MATTER, { received_on: plusDays(-1), title: `Abierta ${i}` });
        const token = await connect();
        const out = await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE });
        expect(out.data.requests.open).toHaveLength(50);
        expect(out.data.requests.open_count).toBe(57);
        expect(out.data.truncated).toBe(true);
        expect(out.data.requests.total).toBeGreaterThanOrEqual(57);
    });

    it("writes nothing: it marks nothing as sent", async () => {
        as("owner");
        const token = await connect();
        await callTool(token, "get_retainer_report", { matter_id: PROJECT_PRIVATE });
        expect(tables().matter_report_sent_events).toHaveLength(0);
    });
});

describe("read-only, audited, sanitized", () => {
    it("no Donna tool changes any table except the audit records", async () => {
        as("owner");
        const token = await connect();
        const snapshot = () =>
            JSON.stringify(Object.entries(tables()).filter(([name, rows]) => rows.length > 0 && !["audit_events", "mcp_tool_calls", "mcp_grants", "mcp_oauth_clients", "mcp_oauth_requests", "mcp_oauth_codes", "mcp_oauth_tokens", "mcp_oauth_audit"].includes(name)));
        const byTable = () => Object.fromEntries(Object.entries(tables()).filter(([, rows]) => rows.length > 0).map(([name, rows]) => [name, JSON.stringify(rows)]));
        const before = snapshot();
        const was = byTable();
        for (const [name, args] of [
            ["list_retainer_requests", { matter_id: PROJECT_PRIVATE }],
            ["get_client_profile", { matter_id: PROJECT_PRIVATE }],
            ["get_deadline_radar", { matter_id: PROJECT_PRIVATE }],
            ["get_deadline_radar", {}],
            ["get_retainer_report", { matter_id: PROJECT_PRIVATE }],
        ] as const)
            expect((await callTool(token, name, args)).ok, name).toBe(true);
        const now = byTable();
        const changed = Object.keys({ ...was, ...now }).filter((name) => ["audit_events", "mcp_tool_calls", "mcp_grants", "mcp_oauth_clients", "mcp_oauth_requests", "mcp_oauth_codes", "mcp_oauth_tokens", "mcp_oauth_audit"].indexOf(name) < 0 && now[name] !== was[name]);
        expect(changed).toEqual([]);
        expect(snapshot()).toBe(before);
    });

    it("records every call in mcp_tool_calls on the read lane, and the profile also in audit_events", async () => {
        as("owner");
        const token = await connect();
        await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE });
        await callTool(token, "get_deadline_radar", {});
        await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        const calls = tables().mcp_tool_calls.filter((c) => DONNA_TOOLS.includes(String(c.tool)));
        expect(calls.map((c) => [c.tool, c.outcome])).toEqual([
            ["list_retainer_requests", "ok"],
            ["get_deadline_radar", "ok"],
            ["get_client_profile", "ok"],
        ]);
        expect(tables().audit_events.filter((a) => a.action === "mcp.get_client_profile")).toHaveLength(1);
        expect(tables().audit_events.filter((a) => a.action === "mcp.list_retainer_requests")).toHaveLength(0);
    });

    it("a failing service reads as a sanitized internal_error", async () => {
        as("owner");
        const token = await connect();
        h.state!.failNext("matter_requests", "select", { message: 'relation "matter_requests" is broken at /srv/db' });
        const out = await callTool(token, "list_retainer_requests", { matter_id: PROJECT_PRIVATE });
        expect(out.ok).toBe(false);
        expect(out.code).toBe("internal_error");
        expect(out.raw).not.toContain("/srv/db");
        expect(out.raw).not.toContain("matter_requests");
    });

    it("refuses an id that is not an id before any service sees it", async () => {
        as("owner");
        const token = await connect();
        for (const name of DONNA_TOOLS) expect((await callTool(token, name, { matter_id: "not-an-id" })).code, name).toBe("invalid_params");
        expect((await callTool(token, "list_retainer_requests", {})).code).toBe("invalid_params");
    });
});

// ---------------------------------------------------------------------------
// The client profile as an MCP resource (layer 2c): litt://matters/{id}/client-profile
// is read through get_client_profile, so it is the tool's answer, audit and egress record.
// ---------------------------------------------------------------------------

const profileUri = (matterId: string) => `litt://matters/${matterId}/client-profile`;
const readResource = async (token: string, uri: string) => {
    const res = await rpc(token, "resources/read", { uri });
    const body = bodyOf(res) as unknown as { result?: { contents: { uri: string; mimeType: string; text: string }[] }; error?: { message: string } };
    return { status: res.status, result: body.result, error: body.error, raw: res.text };
};

describe("the client profile as a resource", () => {
    it("reads the same confirmed facts as the tool, with the tool's strict audit row and its egress record", async () => {
        as("viewer");
        const token = await connect();
        const read = await readResource(token, profileUri(PROJECT_PRIVATE));
        expect(read.result!.contents[0]).toMatchObject({ uri: profileUri(PROJECT_PRIVATE), mimeType: "application/json" });
        const viaResource = JSON.parse(read.result!.contents[0].text);
        const viaTool = await callTool(token, "get_client_profile", { matter_id: PROJECT_PRIVATE });
        expect(viaResource.facts.map((f: { id: string }) => f.id).sort()).toEqual(viaTool.data.facts.map((f: { id: string }) => f.id).sort());
        // Only confirmed, not stale facts: a proposal, a rejection and a stale fact never leave.
        for (const hidden of [FACTS.pending, FACTS.rejected, FACTS.stale]) expect(read.raw).not.toContain(hidden);
        // The quotes are data, fenced, and they left LiTT only after being recorded (once per read).
        expect(viaResource.facts.find((f: { id: string }) => f.id === FACTS.expiry).citation.quote).toMatch(/^<<<LITT_UNTRUSTED_DOCUMENT_TEXT \S+>>>\n/);
        expect(tables().audit_events.filter((a) => a.action === "mcp.client_ai_egress")).toHaveLength(2);
        expect(tables().audit_events.filter((a) => a.action === "mcp.get_client_profile" && a.project_id === PROJECT_PRIVATE)).toHaveLength(2);
    });

    it("does not return the quotes when the egress cannot be recorded, and does not run when the audit row cannot", async () => {
        as("owner");
        const token = await connect();
        let inserts = 0;
        const real = (h.state!.db as { from: (t: string) => unknown }).from.bind(h.state!.db);
        (h.state!.db as { from: (t: string) => unknown }).from = (table: string) => {
            if (table === "audit_events" && ++inserts === 2) h.state!.failNext("audit_events", "insert", { message: "disk full at /var/lib/pg" });
            return real(table);
        };
        const failed = await readResource(token, profileUri(PROJECT_PRIVATE));
        expect(failed.result).toBeUndefined();
        expect(failed.error!.message).not.toContain("disk full");
        expect(failed.raw).not.toContain(QUOTE);
        (h.state!.db as { from: (t: string) => unknown }).from = real;
        h.state!.failNext("audit_events", "insert", { message: "down" });
        const notRun = await readResource(token, profileUri(PROJECT_PRIVATE));
        expect(notRun.result).toBeUndefined();
        expect(notRun.raw).not.toContain(QUOTE);
    });

    it("answers the same not found for what the person cannot open, what is not a retainer, another firm's matter and an unknown id", async () => {
        as("owner");
        const token = await connect();
        const refused = [
            await readResource(token, profileUri(PROJECT_PLAIN)),
            await readResource(token, profileUri(PROJECT_FOREIGN)),
            await readResource(token, profileUri("33333333-3333-4333-8333-333333333333")),
            await readResource(token, "litt://matters/not-an-id/client-profile"),
        ];
        for (const r of refused) expect(r.error, r.raw).toMatchObject({ message: "That resource was not found." });
        for (const name of ["admin", "outsider"] as PersonName[]) {
            as(name);
            const denied = await readResource(await connect({ workspaces: name === "outsider" ? [ORG2] : [ORG] }), profileUri(PROJECT_PRIVATE));
            expect(denied.error, name).toMatchObject({ message: "That resource was not found." });
            expect(denied.raw).not.toContain(QUOTE);
        }
        // The tool gives the same people the same verdicts.
        for (const name of PEOPLE_NAMES) {
            as(name);
            const t = await connect({ workspaces: name === "outsider" ? [ORG2] : [ORG] });
            const viaTool = await callTool(t, "get_client_profile", { matter_id: PROJECT_PRIVATE });
            const viaResource = await readResource(t, profileUri(PROJECT_PRIVATE));
            expect(Boolean(viaResource.result), name).toBe(viaTool.ok);
        }
    });
});
