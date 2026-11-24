import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../lib/supabase";
import type { Row } from "../helpers/memoryDb";
import { toolsOfClass } from "../helpers/mcpKeyClasses";

// Which key work started by a connected app runs on, for each tool that has
// LiTT run model work, in four situations:
//   1. firm workspace, only the firm has a key for the model's provider;
//   2. firm workspace, the person has their own key and the firm allows it;
//   3. firm workspace, the firm turned personal keys off, the firm has a key;
//   4. personal workspace, the person's own key.
// Key rows are real (encrypted) rows; the route is resolved by the real
// functions the web's turn uses (resolveUserChatSelection, governChatRoute,
// pinPlaybookRoute, prepareTabularGenerate). What needs a model, a queue or a
// lease is stood in for at the seam the web route uses: the turn seams stop
// right after the route is resolved, so these tests prove WHICH key a turn
// would be pinned to, not the turn itself.
vi.hoisted(() => {
    process.env.RATE_LIMIT_MCP_REGISTER_MAX = "100000";
});

const h = vi.hoisted(() => ({
    caller: { id: "", email: "" },
    state: null as null | { db: unknown; tables: Record<string, Record<string, unknown>[]>; failNext: (t: string, o: string, e: unknown) => void },
    routes: [] as { seam: string; ok: boolean; credentialRef: string | null; code: string | null; requested: string | null | undefined; model: string | null }[],
    generated: [] as { apiKeys: Record<string, unknown> }[],
    matrix: [] as string[],
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
// The person's settings: the model the chat would pick; the keys are the real rows.
vi.mock("../../modules/user/user.settings", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/user/user.settings")>();
    const { getEffectiveApiKeys } = await import("../../lib/providerCredentials/index.js");
    return {
        ...original,
        getUserModelSettings: vi.fn(async (userId: string, db: Db, options: { orgId?: string | null } = {}) => ({
            title_model: null,
            tabular_model: null,
            memory_curator_model: null,
            subagent_model: null,
            subagent_reasoning: null,
            last_selected_chat_model: "claude-sonnet-5-5",
            last_selected_reasoning_level: null,
            api_keys: await getEffectiveApiKeys(userId, options.orgId, db),
            router_models: {},
            subagent_routes: null,
        })),
    };
});

// The conversation an existing thread id names, as the service reads it: the
// route columns it was pinned with (none for a thread started before keys were pinned).
const existingChat = (table: "chats" | "tabular_review_chats", id: string | null | undefined) => {
    const row = id ? h.state!.tables[table].find((chat) => chat.id === id) : undefined;
    return row ? { model: row.model as string | null, model_provider: (row.model_provider as string | null) ?? null, credential_ref: (row.credential_ref as string | null) ?? null } : null;
};

// The three conversation seams: the route is resolved for real, then the
// stand-in stops (a refused route answers with its own code).
async function resolveTurnRoute(
    seam: string,
    db: Db,
    args: { userId: string; orgId: string | null; model: string | null | undefined; credentialRef: string | null | undefined; chat?: { model?: string | null; model_provider?: string | null; credential_ref?: string | null } | null },
) {
    const { resolveUserChatSelection, governChatRoute } = await import("../../modules/user/user.service.js");
    const selection = await resolveUserChatSelection(db, { userId: args.userId, requestedModel: args.model, orgId: args.orgId });
    const note = (ok: boolean, credentialRef: string | null, code: string | null) =>
        h.routes.push({ seam, ok, credentialRef, code, requested: args.credentialRef, model: args.model ?? null });
    if (!selection.ok) {
        note(false, null, selection.code);
        return { ok: false as const, status: selection.status, code: selection.code, detail: selection.detail };
    }
    const governed = await governChatRoute(db, {
        userId: args.userId,
        orgId: args.orgId,
        chat: args.chat ?? null,
        requestedModel: args.model,
        selectedModel: selection.selectedModel,
        requestedCredentialRef: args.credentialRef,
    });
    if (!governed.ok) {
        note(false, null, governed.code);
        return { ok: false as const, status: governed.status, code: governed.code, detail: governed.detail };
    }
    note(true, governed.route.credentialRef, null);
    return { ok: false as const, status: 409, code: "route_checked", detail: "Route resolved." };
}

vi.mock("../../modules/chat/chat.turn", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/chat/chat.turn")>();
    const { checkProjectAccess, resolveStandaloneOrgId } = await import("../../lib/access.js");
    return {
        ...original,
        startChatTurn: vi.fn(async (db: Db, args: { userId: string; userEmail?: string; parsed: { model?: string | null; credentialRef?: string | null; chatId?: string | null; orgId?: unknown; project: { projectId: string | null } } }) => {
            let orgId: string | null;
            if (args.parsed.project.projectId) {
                const access = await checkProjectAccess(args.parsed.project.projectId, args.userId, args.userEmail ?? "", db);
                if (!access.ok) return { ok: false as const, status: 404, detail: "Project not found" };
                orgId = (access.project.org_id as string | null) ?? null;
            } else if (args.parsed.chatId) {
                // An existing conversation runs in the organization it was created in.
                orgId = ((h.state!.tables.chats.find((chat) => chat.id === args.parsed.chatId)?.org_id as string | null | undefined) ?? null);
            } else {
                const standalone = await resolveStandaloneOrgId(db, { userId: args.userId, orgId: args.parsed.orgId });
                if (!standalone.ok) return { ok: false as const, status: 400, detail: standalone.detail };
                orgId = standalone.orgId;
            }
            return resolveTurnRoute("chat", db, { userId: args.userId, orgId, model: args.parsed.model, credentialRef: args.parsed.credentialRef, chat: existingChat("chats", args.parsed.chatId) });
        }),
    };
});
vi.mock("../../modules/project-chat/projectChat.turn", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/project-chat/projectChat.turn")>();
    const { checkProjectAccess } = await import("../../lib/access.js");
    return {
        ...original,
        startProjectChatTurn: vi.fn(async (db: Db, args: { userId: string; userEmail?: string; projectId: string; parsed: { model?: string | null; credentialRef?: string | null; chatId?: string | null } }) => {
            const access = await checkProjectAccess(args.projectId, args.userId, args.userEmail ?? "", db);
            if (!access.ok) return { ok: false as const, status: 404, detail: "Project not found" };
            return resolveTurnRoute("project_chat", db, { userId: args.userId, orgId: (access.project.org_id as string | null) ?? null, model: args.parsed.model, credentialRef: args.parsed.credentialRef, chat: existingChat("chats", args.parsed.chatId) });
        }),
    };
});
vi.mock("../../modules/tabular/tabular.chatTurn", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/tabular/tabular.chatTurn")>();
    return {
        ...original,
        startTabularChatTurn: vi.fn(async (db: Db, args: { userId: string; reviewId: string; parsed: { model?: string; credentialRef?: string | null; chatId?: string | null } }) => {
            const review = h.state!.tables.tabular_reviews.find((r) => r.id === args.reviewId)!;
            const out = await resolveTurnRoute("tabular_chat", db, { userId: args.userId, orgId: (review.org_id as string | null) ?? null, model: args.parsed.model, credentialRef: args.parsed.credentialRef, chat: existingChat("tabular_review_chats", args.parsed.chatId) });
            return { ok: false as const, status: out.status, code: out.code, detail: out.detail, kind: "status" as const, body: { code: out.code, detail: out.detail } };
        }),
    };
});

// Playbook review: the real beginPlaybookReview (route pin, model check, firm
// content rule) with the queue left out.
vi.mock("../../modules/playbooks/playbooks.jobs", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/playbooks/playbooks.jobs")>();
    const ops = await import("../../modules/playbooks/playbooks.operations.js");
    return {
        ...original,
        queuePlaybookReview: vi.fn(async (args: Parameters<typeof ops.beginPlaybookReview>[0]) => {
            const { run } = await ops.beginPlaybookReview(args);
            return run;
        }),
    };
});

// Tabular generation: the real preparation (model + keys), then the lease and
// the run are stood in for; the key bag the run would use is kept.
vi.mock("../../modules/tabular/tabular.generation", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/tabular/tabular.generation")>();
    return {
        ...original,
        startTabularGeneration: vi.fn(async (_db: Db, args: { apiKeys: Record<string, unknown> }) => {
            h.generated.push({ apiKeys: args.apiKeys });
            return { ok: true as const, data: { run: { finished: true }, aborted: false, generationId: "gen-1", release: async () => undefined } };
        }),
        runTabularGeneration: vi.fn(async () => undefined),
    };
});
vi.mock("../../lib/workflowCatalog", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/workflowCatalog")>()),
    ensureDefaultWorkflows: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { resetGrantBudgets } from "../../modules/mcp/mcp.limits";
import { resetAssistantTurnRunsForTests } from "../../lib/assistantTurnRuns";
import { saveApiKeyFor } from "../../lib/providerCredentials/store";
import { resolveScanKey } from "../../lib/ocr/key";
import { checkWorkflowAccess } from "../../lib/access";
import {
    buildWorld,
    ORG,
    ORG2,
    PEOPLE,
    PLAYBOOK_READY,
    PROJECT_PUBLIC,
    REVIEW_PUBLIC,
} from "../helpers/mcpToolsWorld";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
const MODEL = "claude-sonnet-5-5";
const OWNER = PEOPLE.owner.id;

const PROJECT_PERSONAL = "aaaaaaaa-0000-4000-8000-0000000000f1";
const DOC_PERSONAL = "bbbbbbbb-0000-4000-8000-0000000000f1";
const VERSION_PERSONAL = "cccccccc-0000-4000-8000-0000000000f1";
const REVIEW_PERSONAL = "99999999-0000-4000-8000-0000000000f1";
const PLAYBOOK_PERSONAL = "eeeeeeee-0000-4000-8000-0000000000f1";
const PROJECT_B = "aaaaaaaa-0000-4000-8000-0000000000b2";
const DOC_B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const VERSION_B = "cccccccc-0000-4000-8000-0000000000b2";
const DOC_FIRM = "bbbbbbbb-0000-4000-8000-0000000000a1";
const VERSION_FIRM = "cccccccc-0000-4000-8000-0000000000a1";
const WF_ASSIST = "ffffffff-0000-4000-8000-0000000000f1";
const QA_MAIN = "eeeeeeee-1000-4000-8000-0000000000f1";
const WF_PERSONAL = "ffffffff-0000-4000-8000-0000000000f2";
const QA_PERSONAL = "eeeeeeee-1000-4000-8000-0000000000f2";

const PINNED_CHAT = "ffffffff-0000-4000-8000-0000000000c1";
const PINNED_PROJECT_CHAT = "ffffffff-0000-4000-8000-0000000000c2";
const PINNED_THREAD = "ffffffff-0000-4000-8000-0000000000c3";
const USER_REF = `user:${OWNER}:claude:v1`;
const FIRM_REF = `org:${ORG}:claude:v2`;

async function keyRow(owner: { kind: "user" | "org"; id: string }, provider: string, secret: string, version = 1): Promise<Row> {
    let captured: Row = {};
    const capture = { from: () => ({ upsert: async (payload: Row) => ((captured = payload), { error: null }) }) };
    await saveApiKeyFor(owner, provider as never, secret, capture as never);
    return { ...captured, version, credential_ref: `${provider}:v${version}` };
}

type Situation = "firm_key_only" | "own_key_allowed" | "own_key_no_firm_key" | "personal_keys_off" | "personal_workspace" | "no_key";
const SITUATIONS: { id: "1" | "2" | "2b" | "3" | "4"; situation: Situation; label: string; workspace: string; expected: string }[] = [
    { id: "1", situation: "firm_key_only", label: "firm workspace, only the firm has a key", workspace: ORG, expected: FIRM_REF },
    { id: "2", situation: "own_key_allowed", label: "firm workspace, own key, personal keys allowed, firm key too", workspace: ORG, expected: FIRM_REF },
    { id: "2b", situation: "own_key_no_firm_key", label: "firm workspace, own key, personal keys allowed, no firm key", workspace: ORG, expected: USER_REF },
    { id: "3", situation: "personal_keys_off", label: "firm workspace, personal keys off, firm key", workspace: ORG, expected: FIRM_REF },
    { id: "4", situation: "personal_workspace", label: "personal workspace, own key", workspace: "personal", expected: USER_REF },
];

async function setUp(situation: Situation) {
    const t = h.state!.tables;
    t.user_api_keys = [];
    t.org_api_keys = [];
    const own = async () => t.user_api_keys.push({ ...(await keyRow({ kind: "user", id: OWNER }, "claude", "sk-own", 1)), user_id: OWNER });
    const firm = async () => t.org_api_keys.push({ ...(await keyRow({ kind: "org", id: ORG }, "claude", "sk-firm", 2)), org_id: ORG });
    if (situation === "firm_key_only") await firm();
    if (situation === "own_key_allowed") (await own(), await firm());
    if (situation === "personal_keys_off") {
        (await own(), await firm());
        t.organizations.find((o) => o.id === ORG)!.allow_personal_ai_keys = false;
    }
    if (situation === "personal_workspace" || situation === "own_key_no_firm_key") await own();
}

/** A stored Markdown document with its text read, so a review needs no file bytes. */
function addNote(id: string, versionId: string, projectId: string, orgId: string | null) {
    const t = h.state!.tables;
    t.documents.push({ id, project_id: projectId, org_id: orgId, user_id: OWNER, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: versionId, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" });
    t.document_versions.push({ id: versionId, document_id: id, storage_path: `p/${versionId}`, pdf_storage_path: null, source: "upload", version_number: 1, filename: "nota.md", file_type: "md", size_bytes: 100, page_count: 1, textless_page_count: 0, content_sha256: "a".repeat(64), training_stage: null, deleted_at: null, text_revision: `rev-${versionId}`, created_at: "2026-11-03T10:00:00Z" });
    t.document_version_texts.push({ version_id: versionId, source_revision: `rev-${versionId}`, extractor_version: 1, status: "ready", text_content: "La renta mensual es de $10,000 MXN.", textless_page_count: 0 });
}

function seedPersonal() {
    const t = h.state!.tables;
    t.projects.push({ id: PROJECT_PERSONAL, user_id: OWNER, org_id: null, name: "Mío", cm_number: null, practice: null, visibility: "private", archived_at: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-10T10:00:00Z" });
    addNote(DOC_PERSONAL, VERSION_PERSONAL, PROJECT_PERSONAL, null);
    const review = t.tabular_reviews.find((r) => r.id === REVIEW_PUBLIC)!;
    t.tabular_reviews.push({ ...review, id: REVIEW_PERSONAL, project_id: PROJECT_PERSONAL, org_id: null, document_ids: [DOC_PERSONAL], title: "Mío" });
    t.tabular_review_rows.push({ id: "88888888-0000-4000-8000-0000000000f1", review_id: REVIEW_PERSONAL, label: "mio.docx", row_type: "document", document_id: DOC_PERSONAL, source_document_ids: [DOC_PERSONAL], sort_index: 0 });
    const playbook = t.playbooks.find((p) => p.id === PLAYBOOK_READY)!;
    t.playbooks.push({ ...playbook, id: PLAYBOOK_PERSONAL, org_id: null, visibility: "private", name: "Mis reglas" });
}

function seedOtherFirm() {
    const t = h.state!.tables;
    t.org_members.push({ org_id: ORG2, user_id: OWNER, role: "member" });
    t.projects.push({ id: PROJECT_B, user_id: OWNER, org_id: ORG2, name: "Firma B", cm_number: null, practice: null, visibility: "organization", archived_at: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-10T10:00:00Z" });
    addNote(DOC_B, VERSION_B, PROJECT_B, ORG2);
    addNote(DOC_FIRM, VERSION_FIRM, PROJECT_PUBLIC, ORG);
}

function seedWorkflows() {
    const t = h.state!.tables;
    const mine = { user_id: OWNER, type: "assistant", prompt_md: "Revisa.", columns_config: null, language: "es-MX", practice: "civil", jurisdictions: ["CDMX"], version: "1", contributors: null, archived_at: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z" };
    t.workflows = [{ ...mine, id: WF_PERSONAL, org_id: null, visibility: "private", title: "Personal" }, {
        id: WF_ASSIST, user_id: OWNER, org_id: ORG, visibility: "organization", type: "assistant", title: "Revisar arrendamiento", prompt_md: "Revisa.",
        columns_config: null, language: "es-MX", practice: "civil", jurisdictions: ["CDMX"], version: "1", contributors: null, archived_at: null,
        created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z",
    }];
    t.quick_actions = [{ id: QA_MAIN, user_id: OWNER, workflow_id: WF_ASSIST, name: "Revisar renta", prompt: "Revisa la renta.", document_upload: false, surface: "app", enabled: true, sort_order: 0, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:00:00Z" }, { id: QA_PERSONAL, user_id: OWNER, workflow_id: WF_PERSONAL, name: "Personal", prompt: "z", document_upload: false, surface: "app", enabled: true, sort_order: 1, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:00:00Z" }];
    const world = h.state!;
    const db = world.db as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> };
    const base = db.rpc.bind(db);
    db.rpc = async (fn, args) => {
        if (fn !== "get_workflows_overview") return base(fn, args);
        const rows: Record<string, unknown>[] = [];
        for (const row of world.tables.workflows) {
            if (args.p_type && row.type !== args.p_type) continue;
            if (args.p_workspace && args.p_workspace !== (row.org_id ?? "personal")) continue;
            const access = await checkWorkflowAccess(String(row.id), String(args.p_user_id), String(args.p_user_email ?? ""), world.db as Db);
            if (!access.ok) continue;
            rows.push({ ...row, access_scope: "organization", organization_name: "Firm A", is_owner: access.isCreator, access_role: access.projectRole });
        }
        const offset = Number(args.p_offset ?? 0);
        return { data: rows.slice(offset, offset + Number(args.p_limit ?? rows.length)), error: null };
    };
}

beforeEach(() => {
    h.state = buildWorld();
    h.routes = [];
    h.generated = [];
    h.caller = { id: OWNER, email: PEOPLE.owner.email };
    resetGrantBudgets();
    resetAssistantTurnRunsForTests();
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    vi.stubEnv("DOWNLOAD_SIGNING_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
    for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(name, "");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_READ_MAX", "100000");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "100000");
    vi.stubEnv("LITT_MCP_RUN_WAIT_MS", "200");
    vi.stubEnv("LITT_MCP_RUN_POLL_MS", "20");
    h.state.tables.tabular_reviews.find((r) => r.id === REVIEW_PUBLIC)!.model = MODEL;
    seedPersonal();
    seedOtherFirm();
    seedWorkflows();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
    if (!process.env.KEY_MATRIX) return;
    // With KEY_MATRIX=<file>, the measured matrix: one line per tool and situation.
    writeFileSync(process.env.KEY_MATRIX, `${h.matrix.join("\n")}\n`);
});

const tables = () => h.state!.tables;
const ALL_SCOPES = ["litt.read", "litt.run", "litt.write", "litt.chat"];

async function connect(workspaces: string[]) {
    const reg = await request(app).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const clientId = reg.body.client_id as string;
    const v = randomBytes(32).toString("base64url");
    const auth = await request(app)
        .get("/oauth/authorize")
        .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: "S256", resource: RESOURCE, scope: ALL_SCOPES.join(" "), state: "s" })
        .redirects(0);
    const requestId = new URL(auth.headers.location!).searchParams.get("request")!;
    const decision = await request(app).post(`/mcp-connect/authorizations/${requestId}/decision`).send({ decision: "approve", workspaces, scopes: ALL_SCOPES });
    expect(decision.status).toBe(200);
    const code = new URL(decision.body.redirect_url).searchParams.get("code")!;
    const token = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: v, redirect_uri: REDIRECT, resource: RESOURCE });
    expect(token.status).toBe(200);
    return token.body.access_token as string;
}

type Reply = { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function callTool(token: string, name: string, args: object = {}): Promise<{ ok: boolean; code: string | null; data: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").set("MCP-Protocol-Version", "2025-11-25").set("Authorization", `Bearer ${token}`).send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const body = (res.body && Object.keys(res.body).length ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1])) as Reply;
    if (body.error || !body.result?.content?.[0]) return { ok: false, code: "invalid_params", data: { detail: body.error?.message } };
    let data: Record<string, unknown>;
    try {
        data = JSON.parse(body.result.content[0].text);
    } catch {
        return { ok: false, code: "invalid_params", data: { detail: body.result.content[0].text } };
    }
    return body.result.isError ? { ok: false, code: String(data.code), data } : { ok: true, code: null, data };
}

/** What a tool did, in the matrix's words: the key it ran on, or why it refused. */
type Outcome = string;
const sourceOf = (ref: string | null) => (ref === USER_REF ? "own key" : ref === FIRM_REF ? "firm key" : ref ? `other (${ref})` : "none");
const lastRoute = (): Outcome => {
    const r = h.routes[h.routes.length - 1];
    return !r ? "no route resolved" : r.ok ? sourceOf(r.credentialRef) : `refused ${r.code}`;
};
const playbookOutcome = (reply: { ok: boolean; code: string | null; data?: Record<string, unknown> }): Outcome => {
    if (!reply.ok) return `refused ${reply.code}`;
    const run = tables().playbook_runs[tables().playbook_runs.length - 1];
    return sourceOf(String(run?.credential_ref ?? ""));
};
const tabularOutcome = (reply: { ok: boolean; code: string | null }): Outcome => {
    if (!reply.ok) return `refused ${reply.code}`;
    const bag = h.generated[h.generated.length - 1]?.apiKeys as { claude?: string } | undefined;
    return bag?.claude === "sk-firm" ? "firm key" : bag?.claude === "sk-own" ? "own key" : `other (${bag?.claude})`;
};

type Probe = { name: string; tool: string; run: (token: string, ws: string) => Promise<Outcome>; cls: string };
const personal = (ws: string) => ws === "personal";
const PROBES: Probe[] = [
    { name: "start_chat", tool: "start_chat", cls: "b", run: async (token, ws) => ((await callTool(token, "start_chat", { message: "hola", workspace: ws, model: MODEL })), lastRoute()) },
    { name: "start_chat", tool: "start_chat (model not named)", cls: "b", run: async (token, ws) => ((await callTool(token, "start_chat", { message: "hola", workspace: ws })), lastRoute()) },
    { name: "start_chat", tool: "start_chat (matter)", cls: "b", run: async (token, ws) => ((await callTool(token, "start_chat", { message: "hola", matter_id: personal(ws) ? PROJECT_PERSONAL : PROJECT_PUBLIC, model: MODEL })), lastRoute()) },
    { name: "start_project_chat", tool: "start_project_chat", cls: "b", run: async (token, ws) => ((await callTool(token, "start_project_chat", { message: "hola", matter_id: personal(ws) ? PROJECT_PERSONAL : PROJECT_PUBLIC, model: MODEL })), lastRoute()) },
    { name: "send_tabular_chat_message", tool: "send_tabular_chat_message (new thread)", cls: "b", run: async (token, ws) => ((await callTool(token, "send_tabular_chat_message", { review_id: personal(ws) ? REVIEW_PERSONAL : REVIEW_PUBLIC, message: "hola", model: MODEL })), lastRoute()) },
    { name: "run_workflow", tool: "run_workflow (assistant)", cls: "b", run: async (token, ws) => ((await callTool(token, "run_workflow", { workflow_id: personal(ws) ? WF_PERSONAL : WF_ASSIST, workspace: ws, model: MODEL })), lastRoute()) },
    { name: "run_quick_action", tool: "run_quick_action", cls: "b", run: async (token, ws) => ((await callTool(token, "run_quick_action", { quick_action_id: personal(ws) ? QA_PERSONAL : QA_MAIN, workspace: ws, model: MODEL })), lastRoute()) },
    { name: "run_playbook_review", tool: "run_playbook_review", cls: "b", run: async (token, ws) => playbookOutcome(await callTool(token, "run_playbook_review", { playbook_id: personal(ws) ? PLAYBOOK_PERSONAL : PLAYBOOK_READY, document_id: personal(ws) ? DOC_PERSONAL : DOC_FIRM, model: MODEL })), },
    { name: "run_tabular_review", tool: "run_tabular_review", cls: "b", run: async (token, ws) => tabularOutcome(await callTool(token, "run_tabular_review", { review_id: personal(ws) ? REVIEW_PERSONAL : REVIEW_PUBLIC })) },
];

describe("the probes cover the registered tools that run on a key", () => {
    it("has a probe for every default-key tool and names only default-key or key-bag tools", () => {
        const probed = new Set(PROBES.map((probe) => probe.name));
        expect(toolsOfClass("default-key").filter((name) => !probed.has(name)), "default-key tool without a probe").toEqual([]);
        const allowed = new Set([...toolsOfClass("default-key"), ...toolsOfClass("key-bag")]);
        expect([...probed].filter((name) => !allowed.has(name)), "probe of a tool in another class").toEqual([]);
    });
});

describe.each(PROBES)("$tool starts model work on the key the web's selector defaults to", (probe) => {
    it.each(SITUATIONS)("situation $id: $label", async (s) => {
        await setUp(s.situation);
        const token = await connect([s.workspace]);
        const outcome = await probe.run(token, s.workspace);
        h.matrix.push(`${probe.tool} | situation ${s.id} | ${outcome}`);
        const wanted = s.expected === USER_REF ? "own key" : "firm key";
        expect(outcome).toBe(wanted);
    });

    it("no usable key anywhere: still refuses, on nothing", async () => {
        await setUp("no_key");
        const token = await connect([ORG]);
        const outcome = await probe.run(token, ORG);
        h.matrix.push(`${probe.tool} | no key at all | ${outcome}`);
        expect(outcome).toMatch(/^refused|no route resolved/);
        expect(outcome).not.toMatch(/^(own|firm) key$/);
    });
});

describe("an explicit credential_ref still wins", () => {
    it.each([
        ["start_chat", { message: "hola", workspace: ORG, model: MODEL }],
        ["start_project_chat", { message: "hola", matter_id: PROJECT_PUBLIC, model: MODEL }],
        ["send_tabular_chat_message", { review_id: REVIEW_PUBLIC, message: "hola", model: MODEL }],
        ["run_workflow", { workflow_id: WF_ASSIST, workspace: ORG, model: MODEL }],
        ["run_quick_action", { quick_action_id: QA_MAIN, workspace: ORG, model: MODEL }],
    ])("%s: the app names its own key while the firm's is the default", async (tool, args) => {
        await setUp("own_key_allowed");
        const token = await connect([ORG]);
        await callTool(token, tool, { ...args, credential_ref: USER_REF });
        expect(h.routes.at(-1)).toMatchObject({ ok: true, credentialRef: USER_REF, requested: USER_REF });
    });

    it("an explicit reference the person cannot use is refused as it is today, never replaced by the default", async () => {
        await setUp("own_key_allowed");
        const token = await connect([ORG]);
        const reply = await callTool(token, "start_chat", { message: "hola", workspace: ORG, model: MODEL, credential_ref: `org:${ORG2}:claude:v9` });
        expect(reply.ok).toBe(false);
        expect(h.routes.at(-1)).toMatchObject({ ok: false, requested: `org:${ORG2}:claude:v9` });
    });
});

describe("the firm's key runs only that firm's content", () => {
    it("run_playbook_review: a firm's playbook on a document of another firm is refused even though the firm's key is the default", async () => {
        await setUp("firm_key_only");
        const token = await connect([ORG, ORG2]);
        const reply = await callTool(token, "run_playbook_review", { playbook_id: PLAYBOOK_READY, document_id: DOC_B, model: MODEL });
        h.matrix.push(`run_playbook_review (document of another firm) | firm key only | ${playbookOutcome(reply)}`);
        expect(reply.ok).toBe(false);
        expect(tables().playbook_runs).toHaveLength(0);
    });

    it("the conversation seam refuses the firm's key for a matter of another firm", async () => {
        await setUp("firm_key_only");
        const token = await connect([ORG, ORG2]);
        const reply = await callTool(token, "start_project_chat", { message: "hola", matter_id: PROJECT_B, model: MODEL, credential_ref: FIRM_REF });
        expect(reply.ok).toBe(false);
        expect(h.routes.at(-1)).toMatchObject({ ok: false, requested: FIRM_REF });
    });
});

describe("class (c): the saved key of a third-party service (scanned-page reading, case-file split)", () => {
    it.each([
        ["firm key only", "firm", ["org"], true, "sk-firm"],
        ["own key and firm key, personal keys allowed", "firm", ["user", "org"], true, "sk-firm"],
        ["firm key, personal keys off, own key saved", "firm", ["user", "org"], false, "sk-firm"],
        ["personal workspace, own key", "personal", ["user"], true, "sk-own"],
    ] as const)("%s", async (label, where, owners, allowPersonal, expected) => {
        const t = tables();
        t.user_api_keys = [];
        t.org_api_keys = [];
        if ((owners as readonly string[]).includes("user")) t.user_api_keys.push({ ...(await keyRow({ kind: "user", id: OWNER }, "landingai", "sk-own")), user_id: OWNER });
        if ((owners as readonly string[]).includes("org")) t.org_api_keys.push({ ...(await keyRow({ kind: "org", id: ORG }, "landingai", "sk-firm")), org_id: ORG });
        t.organizations.find((o) => o.id === ORG)!.allow_personal_scan_keys = allowPersonal;
        const key = await resolveScanKey(h.state!.db as Db, OWNER, where === "personal" ? null : ORG);
        h.matrix.push(`scan key (read_scanned_document, propose_case_file_split) | ${label} | ${key === "sk-firm" ? "firm key" : key === "sk-own" ? "own key" : "none"}`);
        expect(key).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// A document a run or a conversation names must be of the workspace it runs in.
// ---------------------------------------------------------------------------
describe("documents a conversation or run names are of the call's workspace", () => {
    const MISMATCH = "document_workspace_mismatch";
    const WORKSPACES = [ORG, ORG2, "personal"];

    const TOOLS: { tool: string; call: (documentId: string) => [string, object] }[] = [
        { tool: "start_project_chat", call: (id) => ["start_project_chat", { message: "hola", matter_id: PROJECT_PUBLIC, model: MODEL, document_ids: [id] }] },
        { tool: "run_workflow (assistant)", call: (id) => ["run_workflow", { workflow_id: WF_ASSIST, workspace: ORG, model: MODEL, document_ids: [id] }] },
        { tool: "run_quick_action", call: (id) => ["run_quick_action", { quick_action_id: QA_MAIN, workspace: ORG, model: MODEL, document_id: id }] },
    ];

    describe.each(TOOLS)("$tool on the firm's key", ({ call }) => {
        it("a document of another firm is refused and nothing is started", async () => {
            await setUp("firm_key_only");
            const token = await connect(WORKSPACES);
            const reply = await callTool(token, ...call(DOC_B));
            expect(reply.code).toBe(MISMATCH);
            expect(h.routes).toEqual([]);
            expect(tables().chats).toHaveLength(0);
        });

        it("a personal document is refused and nothing is started", async () => {
            await setUp("firm_key_only");
            const token = await connect(WORKSPACES);
            const reply = await callTool(token, ...call(DOC_PERSONAL));
            expect(reply.code).toBe(MISMATCH);
            expect(h.routes).toEqual([]);
            expect(tables().chats).toHaveLength(0);
        });

        it("a document of the same workspace runs on the firm's key", async () => {
            await setUp("firm_key_only");
            const token = await connect(WORKSPACES);
            await callTool(token, ...call(DOC_FIRM));
            expect(h.routes.at(-1)).toMatchObject({ ok: true, credentialRef: FIRM_REF });
        });
    });

    it("an existing matter conversation refuses a foreign document too", async () => {
        await setUp("own_key_allowed");
        tables().chats.push({ id: PINNED_PROJECT_CHAT, user_id: OWNER, project_id: PROJECT_PUBLIC, org_id: ORG, title: null, model: MODEL, model_provider: "claude", credential_ref: USER_REF, origin: "web", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T11:00:00Z" });
        const token = await connect(WORKSPACES);
        const reply = await callTool(token, "send_project_chat_message", { chat_id: PINNED_PROJECT_CHAT, message: "hola", document_ids: [DOC_B] });
        expect(reply.code).toBe(MISMATCH);
        expect(h.routes).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// run_playbook_review asks about the playbook's organization only when the
// document is that organization's; otherwise it behaves as before the change.
// ---------------------------------------------------------------------------
describe("run_playbook_review: the key follows the playbook only for the playbook's own workspace", () => {
    const WORKSPACES = [ORG, ORG2, "personal"];
    const run = async (playbook: string, document: string) => {
        const token = await connect(WORKSPACES);
        tables().playbook_runs.length = 0;
        const reply = await callTool(token, "run_playbook_review", { playbook_id: playbook, document_id: document, model: MODEL });
        return { outcome: playbookOutcome(reply), runs: tables().playbook_runs.length };
    };

    it("a firm's playbook on the same firm's document runs on the firm's key", async () => {
        await setUp("own_key_allowed");
        expect(await run(PLAYBOOK_READY, DOC_FIRM)).toEqual({ outcome: "firm key", runs: 1 });
    });

    it("a firm's playbook on a personal document runs on the person's own key, as before", async () => {
        await setUp("own_key_allowed");
        expect(await run(PLAYBOOK_READY, DOC_PERSONAL)).toEqual({ outcome: "own key", runs: 1 });
    });

    it("a firm's playbook on a personal document with no own key of the person is refused, as before", async () => {
        await setUp("firm_key_only");
        const result = await run(PLAYBOOK_READY, DOC_PERSONAL);
        expect(result.runs).toBe(0);
        expect(result.outcome).toMatch(/^refused/);
        h.matrix.push(`run_playbook_review (firm playbook, personal document, no own key) | ${result.outcome}`);
    });

    it("a firm's playbook on another firm's document runs on the person's own key, as before", async () => {
        await setUp("own_key_allowed");
        tables().org_api_keys.push({ ...(await keyRow({ kind: "org", id: ORG2 }, "claude", "sk-firmB", 3)), org_id: ORG2 });
        expect(await run(PLAYBOOK_READY, DOC_B)).toEqual({ outcome: "own key", runs: 1 });
    });

    it("a personal playbook on a personal document runs on the person's own key", async () => {
        await setUp("own_key_allowed");
        expect(await run(PLAYBOOK_PERSONAL, DOC_PERSONAL)).toEqual({ outcome: "own key", runs: 1 });
    });

    it("a personal playbook on the firm's document stays as before (the person's own key)", async () => {
        await setUp("own_key_allowed");
        expect(await run(PLAYBOOK_PERSONAL, DOC_FIRM)).toEqual({ outcome: "own key", runs: 1 });
    });
});

// ---------------------------------------------------------------------------
// A conversation that exists keeps the key it was pinned with.
// ---------------------------------------------------------------------------
describe("an existing conversation keeps its key and gets no default", () => {
    const WORKSPACES = [ORG, "personal"];
    const pinnedTo = [
        ["the person's own key", USER_REF],
        ["the firm's key", FIRM_REF],
    ] as const;

    const SENDERS: { tool: string; seed: (ref: string) => void; args: object }[] = [
        {
            tool: "send_chat_message",
            seed: (ref) => tables().chats.push({ id: PINNED_CHAT, user_id: OWNER, project_id: null, org_id: ORG, title: null, model: MODEL, model_provider: "claude", credential_ref: ref, origin: "web", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T11:00:00Z" }),
            args: { chat_id: PINNED_CHAT, message: "hola" },
        },
        {
            tool: "send_project_chat_message",
            seed: (ref) => tables().chats.push({ id: PINNED_PROJECT_CHAT, user_id: OWNER, project_id: PROJECT_PUBLIC, org_id: ORG, title: null, model: MODEL, model_provider: "claude", credential_ref: ref, origin: "web", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T11:00:00Z" }),
            args: { chat_id: PINNED_PROJECT_CHAT, message: "hola" },
        },
        {
            tool: "send_tabular_chat_message",
            seed: (ref) => tables().tabular_review_chats.push({ id: PINNED_THREAD, review_id: REVIEW_PUBLIC, user_id: OWNER, title: null, model: MODEL, model_provider: "claude", credential_ref: ref, reasoning_level: null, created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T11:00:00Z" }),
            args: { review_id: REVIEW_PUBLIC, chat_id: PINNED_THREAD, message: "hola", model: MODEL },
        },
    ];

    describe.each(SENDERS)("$tool", ({ tool, seed, args }) => {
        it.each(pinnedTo)("pinned to %s: the route stays that key", async (_label, ref) => {
            // The firm's key is the default for a new conversation here; the pinned one must not be replaced.
            await setUp("own_key_allowed");
            tables().org_api_keys = tables().org_api_keys ?? [];
            if (!tables().tabular_review_chats) tables().tabular_review_chats = [];
            seed(ref);
            const token = await connect(WORKSPACES);
            await callTool(token, tool, args);
            expect(h.routes.at(-1)).toMatchObject({ ok: true, credentialRef: ref });
            expect(h.routes.at(-1)?.requested ?? null).toBeNull();
        });
    });
});
