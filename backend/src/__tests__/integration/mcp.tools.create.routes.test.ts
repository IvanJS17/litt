import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";

// The two tools that ADD content, create_matter and create_note_document, end to end:
// OAuth → tools/list → tools/call over JSON-RPC, against an in-memory firm
// whose access rules are lib/access's own. The REST routes run on the same
// data, so the parity matrix compares what each principal gets from a tool
// with what the web route answers.
const h = vi.hoisted(() => ({
    caller: { id: "", email: "" },
    state: null as null | { db: unknown; tables: Record<string, Record<string, unknown>[]>; failNext: (t: string, o: string, e: unknown) => void },
    stored: new Map<string, { size: number; contentType: string }>(),
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
vi.mock("../../lib/storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/storage")>()),
    storageEnabled: true,
    getSignedUploadUrl: vi.fn(async (path: string) => `https://storage.test.example/put?path=${encodeURIComponent(path)}`),
    headFile: vi.fn(async (path: string) => (h.stored.has(path) ? { ...h.stored.get(path)!, etag: "etag" } : null)),
    copyFile: vi.fn(async (from: string, to: string) => void h.stored.set(to, h.stored.get(from)!)),
    uploadFile: vi.fn(async (path: string, bytes: ArrayBuffer, contentType: string) => void h.stored.set(path, { size: bytes.byteLength, contentType })),
    deleteFile: vi.fn(async (path: string) => void h.stored.delete(path)),
    deleteFileBestEffort: vi.fn(async () => undefined),
    deleteFilesBestEffort: vi.fn(async () => undefined),
}));
import { app } from "../../app";
import { resetGrantBudgets } from "../../modules/mcp/mcp.limits";
import { registerLegalVersion } from "../../lib/managedAccounts";
import {
    buildWorld,
    ORG,
    ORG2,
    PEOPLE,
    DOC_PUBLIC,
    PROJECT_PRIVATE,
    PROJECT_PUBLIC,
    type PersonName,
} from "../helpers/mcpToolsWorld";

const ISSUER = "https://mcp.test.example";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.example/api/mcp/auth_callback";
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

beforeEach(() => {
    h.state = buildWorld();
    h.stored.clear();
    resetGrantBudgets();
    registerLegalVersion("test-terms");
    vi.stubEnv("LITT_MCP_SERVER", "enabled");
    vi.stubEnv("LITT_MCP_PUBLIC_URL", ISSUER);
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_READ_MAX", "100000");
    vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "100000");
    vi.stubEnv("RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX", "100000");
    vi.stubEnv("RATE_LIMIT_UPLOAD_SESSION_POLL_MAX", "100000");
});
afterEach(() => vi.unstubAllEnvs());

const tables = () => h.state!.tables;
const as = (name: PersonName) => {
    h.caller = { id: PEOPLE[name].id, email: PEOPLE[name].email };
};

const ALL_SCOPES = ["litt.read", "litt.run", "litt.write", "litt.chat"];

/** DCR → authorize → consent (as the current caller) → token. */
async function connect(opts: { workspaces?: string[]; scopes?: string[] } = {}) {
    const reg = await request(app)
        .post("/oauth/register")
        .send({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const clientId = reg.body.client_id as string;
    const v = randomBytes(32).toString("base64url");
    const auth = await request(app)
        .get("/oauth/authorize")
        .query({
            response_type: "code",
            client_id: clientId,
            redirect_uri: REDIRECT,
            code_challenge: challengeOf(v),
            code_challenge_method: "S256",
            resource: RESOURCE,
            scope: ALL_SCOPES.join(" "),
            state: "s",
        })
        .redirects(0);
    if (!auth.headers.location) throw new Error(`authorize ${auth.status} ${auth.text}`);
    const requestId = new URL(auth.headers.location).searchParams.get("request")!;
    const decision = await request(app)
        .post(`/mcp-connect/authorizations/${requestId}/decision`)
        .send({ decision: "approve", workspaces: opts.workspaces ?? [ORG], scopes: opts.scopes ?? ["litt.read", "litt.write"] });
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

type Reply = { result?: { content: { text: string }[]; isError?: boolean; tools?: { name: string; annotations: Record<string, boolean> }[] }; error?: { message: string } };
const bodyOf = (res: { body: unknown; text: string }): Reply =>
    (res.body && Object.keys(res.body as object).length ? res.body : JSON.parse(String(res.text).match(/data: (.*)/)![1])) as Reply;

type ToolAnswer = {
    ok: boolean;
    code: string | null;
    // The tools' JSON answers, read field by field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>;
    raw: string;
};

/** The tool's answer: parsed JSON, plus whether it was an error. */
async function callTool(token: string, name: string, args: object = {}): Promise<ToolAnswer> {
    const res = await rpc(token, "tools/call", { name, arguments: args });
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    // Arguments the schema refuses never reach the tool: the SDK answers.
    if (body.error || !body.result?.content?.[0]) return { ok: false, code: "invalid_params", data: { detail: body.error?.message }, raw: res.text };
    let data: ToolAnswer["data"];
    try {
        data = JSON.parse(body.result.content[0].text);
    } catch {
        // The SDK's own refusal of arguments that break the schema is plain text.
        return { ok: false, code: "invalid_params", data: { detail: body.result.content[0].text }, raw: res.text };
    }
    return body.result.isError
        ? { ok: false, code: data.code as string, data, raw: res.text }
        : { ok: true, code: null, data, raw: res.text };
}

const audits = () => tables().audit_events;
const calls = () => tables().mcp_tool_calls;

const writeCalls = (tool: string) => calls().filter((c) => c.tool === tool);

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe("tools/list", () => {
    it("offers both tools only with litt.write, as additive (not destructive) writes", async () => {
        as("owner");
        const names = async (token: string) => (bodyOf(await rpc(token, "tools/list")).result!.tools ?? []).map((t) => t.name);
        const read = await names(await connect({ scopes: ["litt.read"] }));
        expect(read).not.toContain("create_matter");
        expect(read).not.toContain("create_note_document");
        const tools = bodyOf(await rpc(await connect({ scopes: ["litt.read", "litt.write"] }), "tools/list")).result!.tools!;
        const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
        for (const name of ["create_matter", "create_note_document"])
            expect(hints[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
        for (const tool of tools) expect(tool.name.length).toBeLessThanOrEqual(64);
    });

    it("refuses both calls without the write scope, before running them", async () => {
        as("owner");
        const token = await connect({ scopes: ["litt.read"] });
        for (const [name, args] of [
            ["create_matter", { name: "Nuevo" }],
            ["create_note_document", { matter_id: PROJECT_PUBLIC, title: "Nota", markdown: "hola" }],
        ] as const) {
            const res = await rpc(token, "tools/call", { name, arguments: args });
            expect(res.status, name).toBe(403);
        }
        expect(tables().projects).toHaveLength(2);
        expect(tables().documents).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// create_matter
// ---------------------------------------------------------------------------

describe("create_matter", () => {
    it("creates a private matter in the firm, as the web's POST /projects does, and returns its address", async () => {
        as("editor");
        const token = await connect();
        const made = await callTool(token, "create_matter", { name: "  Compraventa Lomas  ", matter_number: "CM-777", practice: "Litigation" });
        expect(made.ok).toBe(true);
        expect(made.data).toMatchObject({ name: "Compraventa Lomas", matter_number: "CM-777", practice: "Litigation", workspace: ORG, visibility: "private" });
        expect(made.data.url).toBe(`http://localhost:3000/projects/${made.data.id}`);
        expect(tables().projects.find((p) => p.id === made.data.id)).toMatchObject({ user_id: PEOPLE.editor.id, org_id: ORG, name: "Compraventa Lomas" });
        // The same call on the web leaves the same row.
        const web = await request(app).post("/projects").send({ name: "Compraventa Lomas", cm_number: "CM-777", practice: "Litigation", org_id: ORG });
        expect(web.status).toBe(201);
        expect(tables().projects.find((p) => p.id === web.body.id)).toMatchObject({ user_id: PEOPLE.editor.id, org_id: ORG, name: "Compraventa Lomas", cm_number: "CM-777" });
        // It only adds: the existing matters are untouched.
        expect(tables().projects.filter((p) => p.id === PROJECT_PUBLIC || p.id === PROJECT_PRIVATE)).toHaveLength(2);
        // The creator can open it with the web's own read tool.
        expect((await callTool(token, "get_matter", { matter_id: made.data.id })).ok).toBe(true);
    });

    it("opens the matter to the firm only when asked, and only in a firm", async () => {
        as("owner");
        const token = await connect({ workspaces: [ORG, "personal"] });
        const open = await callTool(token, "create_matter", { name: "Abierto", workspace: ORG, visibility: "organization" });
        expect(open.ok).toBe(true);
        expect(open.data.visibility).toBe("organization");
        expect(tables().projects.find((p) => p.id === open.data.id)!.visibility).toBe("organization");
        const personal = await callTool(token, "create_matter", { name: "Mío", workspace: "personal", visibility: "organization" });
        expect(personal.ok).toBe(false);
        expect(personal.data.detail).toMatch(/Only an organization's item/);
        const mine = await callTool(token, "create_matter", { name: "Mío", workspace: "personal" });
        expect(mine.ok).toBe(true);
        expect(tables().projects.find((p) => p.id === mine.data.id)).toMatchObject({ org_id: null, user_id: PEOPLE.owner.id });
        expect(mine.data.workspace).toBe("personal");
    });

    it("refuses what the web refuses: blank name, bad visibility, oversized fields", async () => {
        as("owner");
        const token = await connect();
        const before = tables().projects.length;
        for (const args of [{ name: "   " }, {}, { name: "x", visibility: "public" }, { name: "x".repeat(301) }, { name: "x", matter_number: "9".repeat(101) }, { name: "x", practice: "p".repeat(101) }])
            expect((await callTool(token, "create_matter", args)).ok, JSON.stringify(args).slice(0, 40)).toBe(false);
        expect(tables().projects).toHaveLength(before);
    });

    it("refuses a workspace the connection does not cover, or one the person left", async () => {
        as("narrow");
        const token = await connect({ workspaces: [ORG2] });
        const before = tables().projects.length;
        const other = await callTool(token, "create_matter", { name: "Fuera", workspace: ORG });
        expect(other.code).toBe("workspace_not_found");
        expect((await callTool(token, "create_matter", { name: "Fuera", workspace: "personal" })).code).toBe("workspace_not_found");
        // Left the firm after connecting: gone on the very next call.
        tables().org_members = tables().org_members.filter((m) => !(m.org_id === ORG2 && m.user_id === PEOPLE.narrow.id));
        const left = await rpc(token, "tools/call", { name: "create_matter", arguments: { name: "Ya no" } });
        expect(left.status).toBe(403);
        expect(tables().projects).toHaveLength(before);
        expect(writeCalls("create_matter")[0]).toMatchObject({ outcome: "denied", error_code: "workspace_not_found" });
    });

    it("takes Personal away from a managed account: the web's rule, and the tool's", async () => {
        as("owner");
        const token = await connect({ workspaces: [ORG, "personal"] });
        tables().user_profiles.push({ user_id: PEOPLE.owner.id, created_by_org_id: ORG, terms_accepted_version: "test-terms" });
        tables().organizations.find((o) => o.id === ORG)!.managed_accounts = true;
        const before = tables().projects.length;
        const personal = await callTool(token, "create_matter", { name: "Personal", workspace: "personal" });
        expect(personal.code).toBe("workspace_not_found");
        expect(tables().projects).toHaveLength(before);
        // The firm's workspace stays open.
        expect((await callTool(token, "create_matter", { name: "De la firma" })).ok).toBe(true);
    });

    it("writes the strict audit rows (ids only) and fails closed without them", async () => {
        as("owner");
        const token = await connect();
        const made = await callTool(token, "create_matter", { name: "Secreto Confidencial", matter_number: "CM-SECRETO" });
        expect(audits()).toEqual([
            expect.objectContaining({ action: "mcp.create_matter", surface: "mcp", org_id: ORG }),
            expect.objectContaining({ action: "mcp.create_matter.created", surface: "mcp", org_id: ORG, project_id: made.data.id }),
        ]);
        expect(writeCalls("create_matter")).toEqual([expect.objectContaining({ outcome: "ok", workspace: ORG, mode: "B" })]);
        expect(JSON.stringify([calls(), audits()])).not.toMatch(/Secreto|SECRETO/);
        const before = tables().projects.length;
        h.state!.failNext("audit_events", "insert", { message: "down" });
        expect((await callTool(token, "create_matter", { name: "Sin rastro" })).code).toBe("audit_unavailable");
        expect(tables().projects).toHaveLength(before);
    });

    it("answers a database failure as a sanitized internal_error", async () => {
        as("owner");
        const token = await connect();
        // The service creates the row through one rpc: make that fail with a message that must not leak.
        const world = h.state!.db as { rpc: (fn: string, args: object) => Promise<unknown> };
        const original = world.rpc;
        world.rpc = async (fn, args) => (fn === "create_project_with_memory" ? { data: null, error: { message: "relation secret_table does not exist" } } : original(fn, args));
        try {
            const failed = await callTool(token, "create_matter", { name: "Falla" });
            expect(failed.code).toBe("internal_error");
            expect(failed.raw).not.toMatch(/secret_table/);
        } finally {
            world.rpc = original;
        }
    });

    it("answers a failed visibility write with the created matter's id, so a retry does not duplicate it", async () => {
        as("owner");
        const token = await connect();
        const before = tables().projects.length;
        h.state!.failNext("projects", "update", { message: "relation secret_table does not exist" });
        const partial = await callTool(token, "create_matter", { name: "A medias", workspace: ORG, visibility: "organization" });
        expect(partial.ok).toBe(false);
        expect(partial.code).toBe("partial_failure");
        expect(tables().projects).toHaveLength(before + 1);
        const row = tables().projects.at(-1)!;
        expect(row).toMatchObject({ name: "A medias", visibility: "private" });
        expect(partial.data.detail).toContain(String(row.id));
        expect(partial.data.detail).toContain(`http://localhost:3000/projects/${row.id}`);
        expect(partial.data.detail).toMatch(/stays private/);
        expect(partial.raw).not.toMatch(/secret_table/);
    });

    it("spends the write lane of the connection, not the read lane", async () => {
        as("owner");
        const token = await connect();
        vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "2");
        resetGrantBudgets();
        expect((await callTool(token, "create_matter", { name: "Uno" })).ok).toBe(true);
        expect((await callTool(token, "create_matter", { name: "Dos" })).ok).toBe(true);
        const third = await rpc(token, "tools/call", { name: "create_matter", arguments: { name: "Tres" } });
        expect(third.status).toBe(429);
        expect(third.headers["retry-after"]).toBeDefined();
        expect(calls().at(-1)).toMatchObject({ tool: "create_matter", outcome: "rate_limited" });
        // Reads have their own budget.
        expect((await callTool(token, "whoami")).ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// create_note_document
// ---------------------------------------------------------------------------

describe("create_note_document", () => {
    const note = (token: string, extra: object = {}) =>
        callTool(token, "create_note_document", { matter_id: PROJECT_PUBLIC, title: "Minuta de junta", markdown: "# Minuta\n\nAcuerdos: **uno**.", ...extra });

    it("creates a NEW Markdown document in the matter, as an upload would, and returns its ids", async () => {
        as("editor");
        const token = await connect();
        const made = await note(token);
        expect(made.ok).toBe(true);
        expect(made.data).toMatchObject({ filename: "Minuta de junta.md", matter_id: PROJECT_PUBLIC, url: `http://localhost:3000/projects/${PROJECT_PUBLIC}` });
        expect(tables().documents).toHaveLength(4);
        expect(tables().documents.find((d) => d.id === made.data.document_id)).toMatchObject({
            project_id: PROJECT_PUBLIC, org_id: ORG, user_id: PEOPLE.editor.id, folder_id: null, status: "ready", current_version_id: made.data.version_id,
        });
        const version = tables().document_versions.find((v) => v.id === made.data.version_id)!;
        expect(version).toMatchObject({ document_id: made.data.document_id, source: "mcp_client", file_type: "md", filename: "Minuta de junta.md", version_number: 1 });
        const stored = h.stored.get(String(version.storage_path))!;
        expect(stored).toMatchObject({ contentType: expect.stringContaining("markdown"), size: Buffer.byteLength("# Minuta\n\nAcuerdos: **uno**.") });
        // Nothing that existed changed.
        expect(tables().document_versions.filter((v) => v.document_id === DOC_PUBLIC)).toHaveLength(1);
        // The web's own listing shows it.
        const listed = await callTool(token, "list_matter_documents", { matter_id: PROJECT_PUBLIC });
        expect(JSON.stringify(listed.data)).toContain(String(made.data.document_id));
    });

    it("seals a pasante's note as the version of its author, as an upload would", async () => {
        tables().training_stages.push({ org_id: ORG, trainee_user_id: PEOPLE.apprentice.id, practice: null, stage: "pasante" });
        as("apprentice");
        const token = await connect();
        const made = await note(token);
        expect(made.ok).toBe(true);
        const version = tables().document_versions.find((v) => v.id === made.data.version_id)!;
        expect(version).toMatchObject({ source: "mcp_client", training_stage: "pasante", training_author_user_id: PEOPLE.apprentice.id });
        // Someone who is not a pasante gets no seal.
        as("editor");
        const plain = await note(await connect());
        expect(tables().document_versions.find((v) => v.id === plain.data.version_id)).not.toHaveProperty("training_stage");
    });

    it("never overwrites: the same title again is another document", async () => {
        as("owner");
        const token = await connect();
        const first = await note(token);
        const second = await note(token);
        expect(second.data.document_id).not.toBe(first.data.document_id);
        expect(second.data.filename).toBe("Minuta de junta (2).md");
        expect(tables().documents).toHaveLength(5);
    });

    it("gives the same verdicts as adding a file to the matter on the web", async () => {
        const grid: Record<string, Record<PersonName, boolean>> = {
            [PROJECT_PUBLIC]: { owner: true, editor: true, viewer: false, admin: true, apprentice: true, outsider: false, narrow: false },
            [PROJECT_PRIVATE]: { owner: true, editor: true, viewer: false, admin: false, apprentice: false, outsider: false, narrow: false },
        };
        for (const [matter, people] of Object.entries(grid)) {
            for (const [person, expected] of Object.entries(people) as [PersonName, boolean][]) {
                as(person);
                const rest = await request(app).post("/upload-sessions").send({
                    purpose: "document_create",
                    destination: { scope: "project", project_id: matter },
                    files: [{ client_id: "c", filename: "n.md", size_bytes: 10 }],
                });
                // An outsider is not in the firm; `narrow` is, but connected an app that only covers the other firm.
                const token = person === "outsider" || person === "narrow" ? await connect({ workspaces: [ORG2] }) : await connect();
                const before = tables().documents.length;
                const tool = await note(token, { matter_id: matter });
                expect(tool.ok, `${person} ${matter}`).toBe(expected);
                if (person !== "outsider" && person !== "narrow") expect(rest.status < 400, `REST ${person} ${matter}`).toBe(expected);
                expect(tables().documents).toHaveLength(before + (expected ? 1 : 0));
                if (!expected) {
                    // Someone who can open the matter but only read it is refused by name (the web's 403); everybody else cannot even see the matter.
                    expect(tool.code, `${person} ${matter}`).toBe(person === "viewer" || (person === "apprentice" && matter === PROJECT_PRIVATE) ? "forbidden" : "not_found");
                }
            }
        }
    });

    it("does not exist outside the workspaces of the connection", async () => {
        as("narrow");
        const token = await connect({ workspaces: [ORG2] });
        const before = tables().documents.length;
        expect((await note(token)).code).toBe("not_found");
        expect(tables().documents).toHaveLength(before);
    });

    it("validates the title and the markdown, and documents the size cap", async () => {
        as("owner");
        const token = await connect();
        const before = tables().documents.length;
        for (const extra of [{ title: "   " }, { markdown: "" }, { matter_id: "no-es-un-id" }, { title: "t".repeat(121) }, { markdown: "x".repeat(100_001) }])
            expect((await note(token, extra)).ok, JSON.stringify(extra).slice(0, 30)).toBe(false);
        // Only blanks: refused by the service, not stored as an empty file.
        expect((await note(token, { markdown: "   \n " })).ok).toBe(false);
        expect(tables().documents).toHaveLength(before);
        expect((await note(token, { markdown: "x".repeat(100_000) })).ok).toBe(true);
        const listed = bodyOf(await rpc(token, "tools/list")).result!.tools as unknown as { name: string; description: string }[];
        expect(listed.find((t) => t.name === "create_note_document")!.description).toContain("100000");
    });

    it("builds a safe file name from any title", async () => {
        as("owner");
        const token = await connect();
        expect((await note(token, { title: "../../etc/passwd" })).data.filename).toBe("etcpasswd.md");
        expect((await note(token, { title: "***" })).data.filename).toBe("Nota.md");
        expect((await note(token, { title: "Cláusula 3 – Año 2026" })).data.filename).toBe("Cláusula 3 Año 2026.md");
    });

    it("audits strictly with the matter, never the text, and fails closed without the row", async () => {
        as("owner");
        const token = await connect();
        const made = await note(token, { title: "Estrategia Secreta", markdown: "texto confidencial" });
        expect(audits()).toEqual([expect.objectContaining({ action: "mcp.create_note_document", surface: "mcp", org_id: ORG, project_id: PROJECT_PUBLIC })]);
        expect(writeCalls("create_note_document")).toEqual([expect.objectContaining({ outcome: "ok", workspace: ORG })]);
        expect(JSON.stringify([calls(), audits()])).not.toMatch(/Secreta|confidencial/);
        expect(made.ok).toBe(true);
        const before = tables().documents.length;
        h.state!.failNext("audit_events", "insert", { message: "down" });
        expect((await note(token)).code).toBe("audit_unavailable");
        expect(tables().documents).toHaveLength(before);
    });

    it("removes the stored file and the half-made document when the version cannot be written", async () => {
        as("owner");
        const token = await connect();
        const world = h.state!.db as { rpc: (fn: string, args: object) => Promise<unknown> };
        const original = world.rpc;
        world.rpc = async (fn, args) => (fn === "create_document_version" ? { data: null, error: { message: "boom secret_table" } } : original(fn, args));
        const before = { docs: tables().documents.length, files: h.stored.size };
        try {
            const failed = await note(token);
            expect(failed.code).toBe("internal_error");
            expect(failed.raw).not.toMatch(/secret_table/);
        } finally {
            world.rpc = original;
        }
        expect(h.stored.size).toBe(before.files);
        expect(tables().documents.filter((d) => d.status === "ready")).toHaveLength(before.docs);
    });

    it("says so when storage is not configured, and spends the write lane", async () => {
        as("owner");
        const token = await connect();
        const storage = await import("../../lib/storage.js");
        Object.defineProperty(storage, "storageEnabled", { value: false, configurable: true });
        try {
            expect((await note(token)).code).toBe("storage_unavailable");
        } finally {
            Object.defineProperty(storage, "storageEnabled", { value: true, configurable: true });
        }
        vi.stubEnv("RATE_LIMIT_MCP_GRANT_WRITE_MAX", "1");
        resetGrantBudgets();
        expect((await note(token)).ok).toBe(true);
        const second = await rpc(token, "tools/call", { name: "create_note_document", arguments: { matter_id: PROJECT_PUBLIC, title: "b", markdown: "b" } });
        expect(second.status).toBe(429);
        expect(calls().at(-1)).toMatchObject({ tool: "create_note_document", outcome: "rate_limited" });
    });
});

// ---------------------------------------------------------------------------
// Server identity (Claude's «app icon»)
// ---------------------------------------------------------------------------

describe("initialize: server identity", () => {
    it("declares the title, the website and one inline PNG icon of 128x128 under 10 KB", async () => {
        as("owner");
        const token = await connect();
        const res = await rpc(token, "initialize", {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
        });
        expect(res.status).toBe(200);
        const info = (bodyOf(res).result as unknown as { serverInfo: { name: string; title: string; websiteUrl: string; icons: { src: string; mimeType: string; sizes: string[] }[] } }).serverInfo;
        expect(info).toMatchObject({ name: "litt", title: "LiTT", websiteUrl: ISSUER });
        expect(info.icons).toHaveLength(1);
        const [icon] = info.icons;
        expect(icon).toMatchObject({ mimeType: "image/png", sizes: ["128x128"] });
        expect(icon.src.startsWith("data:image/png;base64,")).toBe(true);
        const png = Buffer.from(icon.src.slice("data:image/png;base64,".length), "base64");
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(png.subarray(12, 16).toString()).toBe("IHDR");
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([128, 128]);
        expect(png.length).toBeLessThanOrEqual(10 * 1024);
        expect(JSON.stringify(info).length).toBeLessThan(16_000);
    });
});
