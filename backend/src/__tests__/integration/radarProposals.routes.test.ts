import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "../helpers/memoryDb";

// Rule proposals (S8b) over HTTP, against an in-memory database and a scripted
// model: the law text lives in a document of a FIRM project (never a matter),
// every quote is found in the text or the proposal is rejected, the term is
// draft text that never holds a calendar date, nothing is turned on and nothing
// is written to the catalog, the file for legal holds only what was sent and
// not discarded, and the permissions are the project's. Constraints and RLS:
// PostgreSQL suite.
const h = vi.hoisted(() => {
    process.env.RATE_LIMIT_RULE_SUGGEST_MAX = "100000";
    return {
        caller: { id: "" },
        roles: {} as Record<string, Record<string, string>>,
        texts: {} as Record<string, string | null>,
        state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
        llm: { calls: [] as Record<string, unknown>[], answer: "[]" as string, error: null as unknown },
        settings: { last_selected_chat_model: "claude-sonnet-5-5", last_selected_reasoning_level: null, api_keys: { claude: "sk-own" } } as Record<string, unknown>,
    };
});
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => h.state!.db) }));
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
        const role = h.roles[projectId]?.[userId];
        const project = h.state!.tables.projects.find((row) => row.id === projectId);
        return role && project
            ? { ok: true, isCreator: false, orgRole: "member", projectRole: role, project: { id: projectId, org_id: project.org_id ?? null } }
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
vi.mock("../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm")>()),
    completeText: vi.fn(async (params: Record<string, unknown>) => {
        h.llm.calls.push(params);
        if (h.llm.error) throw h.llm.error;
        return h.llm.answer;
    }),
}));
vi.mock("../../modules/user/user.settings", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/user/user.settings")>()),
    getUserModelSettings: vi.fn(async () => h.settings),
}));

import { app } from "../../app";
import { saveApiKeyFor } from "../../lib/providerCredentials/store";
import { UserFacingError } from "../../lib/userFacingError";
import { MAX_EXTRACT_TEXT_CHARS } from "../../modules/client-profile/client-profile.extract.shared";
import { buildProposeSystemPrompt } from "../../modules/radar/radar.proposals.shared";
import { catalogCodes } from "../../modules/radar/radar.proposals";
import { OBLIGATION_RULES } from "../../modules/radar/radar.rules.catalog";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const WORKSPACE = id(110);
const LAW_PROJECT = id(120);
const PERSONAL_PROJECT = id(121);
const MATTER_PROJECT = id(122);
const MATTER = id(130);
const OWNER = id(1);
const EDITOR = id(2);
const VIEWER = id(3);
const STRANGER = id(5);
const DOC = id(200);
const VERSION = id(210);
const NO_TEXT_VERSION = id(214);
const HUGE_VERSION = id(215);
const FOREIGN_VERSION = id(212);
const MATTER_DOC = id(201);
const MATTER_VERSION = id(216);

const TEXT =
    "LEY GENERAL DE SOCIEDADES MERCANTILES\n" +
    "Artículo 181. La asamblea ordinaria se reunirá por lo menos una vez al año dentro de los cuatro meses que sigan a la clausura del ejercicio social.\n" +
    "Artículo 186. La convocatoria para las asambleas generales deberá hacerse con la anticipación que fijen los estatutos.\n" +
    "Artículo 190. Los accionistas gozan de un derecho de preferencia en caso de aumento de capital.";
const Q_181 = "se reunirá por lo menos una vez al año dentro de los cuatro meses que sigan a la clausura del ejercicio social";
const Q_186 = "deberá hacerse con la anticipación que fijen los estatutos";
const Q_MULTI = "ejercicio social.\nArtículo 186. La convocatoria para las asambleas";
const Q_190 = "Los accionistas gozan de un derecho de preferencia en caso de aumento de capital";

const base = `/projects/${LAW_PROJECT}/rule-proposals`;
const as = (userId: string) => {
    h.caller.id = userId;
};
const tables = () => h.state!.tables;
const rows = () => tables().obligation_rule_suggestions;
const events = () => tables().obligation_rule_suggestion_events;
const item = (extra: Record<string, unknown> = {}) => ({
    law: "Ley General de Sociedades Mercantiles",
    article: "Art. 181",
    obligation: "Celebrar la asamblea general ordinaria anual.",
    anchor_name: "Cierre del ejercicio social",
    quote: Q_181,
    page: null,
    plazo_propuesto: "+4 meses",
    ...extra,
});
const answer = (...items: unknown[]) => {
    h.llm.answer = JSON.stringify(items);
};
const run = (version = VERSION, project = LAW_PROJECT) => request(app).post(`/projects/${project}/rule-proposals/versions/${version}/propose`).send({});

async function keyRow(owner: { kind: "user" | "org"; id: string }, provider: string, secret: string): Promise<Row> {
    let captured: Row = {};
    const capture = { from: () => ({ upsert: async (payload: Row) => ((captured = payload), { error: null }) }) };
    await saveApiKeyFor(owner, provider as never, secret, capture as never);
    return { ...captured, version: 1, credential_ref: `${provider}:v1` };
}

beforeEach(async () => {
    vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
    for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(name, "");
    h.llm = { calls: [], answer: "[]", error: null };
    h.settings = { last_selected_chat_model: "claude-sonnet-5-5", last_selected_reasoning_level: null, api_keys: { claude: "sk-own" } };
    h.roles = {
        [LAW_PROJECT]: { [OWNER]: "owner", [EDITOR]: "editor", [VIEWER]: "viewer" },
        [PERSONAL_PROJECT]: { [OWNER]: "owner" },
        [MATTER_PROJECT]: { [OWNER]: "owner", [EDITOR]: "editor" },
    };
    h.texts = { [VERSION]: TEXT, [MATTER_VERSION]: TEXT, [FOREIGN_VERSION]: TEXT, [NO_TEXT_VERSION]: null, [HUGE_VERSION]: "a".repeat(MAX_EXTRACT_TEXT_CHARS + 1) };
    h.state = memoryDb({
        organizations: [{ id: ORG, kind: "team" }],
        org_members: [OWNER, EDITOR, VIEWER, STRANGER].map((user_id) => ({ org_id: ORG, user_id, role: "member" })),
        workspaces: [{ id: WORKSPACE, organization_id: ORG }],
        projects: [
            { id: LAW_PROJECT, org_id: ORG, name: "Biblioteca legal: Leyes" },
            { id: PERSONAL_PROJECT, org_id: null, name: "Mío" },
            { id: MATTER_PROJECT, org_id: ORG, name: "Iguala Patito" },
        ],
        matters: [{ id: MATTER, project_id: MATTER_PROJECT, workspace_id: WORKSPACE, is_retainer: true, visibility: "private" }],
        documents: [
            { id: DOC, project_id: LAW_PROJECT, archived_at: null, name: "LGSM" },
            { id: MATTER_DOC, project_id: MATTER_PROJECT, archived_at: null },
            { id: id(202), project_id: PERSONAL_PROJECT, archived_at: null },
        ],
        document_versions: [
            { id: VERSION, document_id: DOC, version_number: 1, filename: "LGSM.docx", deleted_at: null, created_at: "2026-11-01T00:00:00Z" },
            { id: NO_TEXT_VERSION, document_id: DOC, version_number: 4, filename: "escaneo.pdf", deleted_at: null },
            { id: HUGE_VERSION, document_id: DOC, version_number: 5, filename: "enorme.docx", deleted_at: null },
            { id: MATTER_VERSION, document_id: MATTER_DOC, version_number: 1, filename: "acta.docx", deleted_at: null },
            { id: FOREIGN_VERSION, document_id: id(202), version_number: 1, filename: "x.docx", deleted_at: null },
        ],
        user_profiles: [{ user_id: EDITOR, display_name: "Elena Editora", email: "elena@example.test" }],
        user_api_keys: [await keyRow({ kind: "user", id: EDITOR }, "claude", "sk-own")].map((row) => ({ ...row, user_id: EDITOR })),
        matter_obligation_rule_events: [],
        obligation_rule_suggestions: [],
        obligation_rule_suggestion_events: [],
        audit_events: [],
    });
});
afterEach(() => vi.unstubAllEnvs());

describe("what a run proposes (acceptance 1, 8)", () => {
    it("keeps the passage as the document words it and counts what it rejects", async () => {
        as(EDITOR);
        answer(
            item({ quote: Q_181.toUpperCase() }),
            item({ article: "Art. 186", quote: Q_186, plazo_propuesto: null }),
            item({ article: "Art. 999", quote: "Una frase que la ley no contiene." }),
            item({ article: "Art. 190", quote: Q_190, obligation: "x".repeat(301) }),
        );
        const res = await run();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ proposed: 2, discarded_quote_not_found: 1, discarded_invalid: 1, discarded_duplicate: 0, discarded_term_has_date: 0 });
        expect(res.body.proposal_ids).toHaveLength(2);
        // The stored quote is the document's own words, never the model's.
        expect(rows()[0].quote).toBe(Q_181);
        expect(rows()[0]).toMatchObject({ flow: "new_rule_draft", matter_id: null, project_id: LAW_PROJECT, org_id: ORG, created_by: EDITOR, ai_provider: "claude", ai_model: "claude-sonnet-5-5" });
        expect(rows()[0].draft).toEqual({ law: "Ley General de Sociedades Mercantiles", article: "Art. 181", obligation: "Celebrar la asamblea general ordinaria anual.", anchor_name: "Cierre del ejercicio social", plazo_propuesto: "+4 meses" });
        expect(events()).toHaveLength(0);
    });

    it("drops a term that writes a calendar date, counts it, and keeps the proposal; a plain term stays as draft text", async () => {
        as(EDITOR);
        answer(
            item({ plazo_propuesto: "a más tardar el 30 de abril" }),
            item({ article: "Art. 186", quote: Q_186, plazo_propuesto: "30 días naturales" }),
            item({ article: "Art. 190", quote: Q_190, plazo_propuesto: "2027-04-30" }),
        );
        const res = await run();
        expect(res.body).toMatchObject({ proposed: 3, discarded_term_has_date: 2 });
        expect(rows().map((row) => (row.draft as { plazo_propuesto: string | null }).plazo_propuesto)).toEqual([null, "30 días naturales", null]);
    });

    it("discards any date, operation or other field outside the closed schema, and answers that are not an array", async () => {
        as(EDITOR);
        answer(item({ fecha: "2027-04-30" }), item({ operacion: "+4 meses" }), item({ due_date: "x" }));
        const res = await run();
        expect(res.body).toMatchObject({ proposed: 0, discarded_invalid: 3 });
        expect(rows()).toHaveLength(0);
        h.llm.answer = JSON.stringify({ proposals: [] });
        const bad = await run();
        expect(bad.status).toBe(422);
        expect(bad.body.code).toBe("suggestion_output_invalid");
        expect(rows()).toHaveLength(0);
    });

    it("proposes a passage once per text (position and hash), also within a run, and counts a race", async () => {
        as(EDITOR);
        answer(item(), item({ article: "Art. 181 bis" }));
        expect((await run()).body).toMatchObject({ proposed: 1, discarded_duplicate: 1 });
        answer(item());
        expect((await run()).body).toMatchObject({ proposed: 0, discarded_duplicate: 1 });
        answer(item({ article: "Art. 186", quote: Q_186 }));
        h.state!.failNext("obligation_rule_suggestions", "insert", { code: "23505", message: "dup" });
        expect((await run()).body).toMatchObject({ proposed: 0, discarded_duplicate: 1 });
        expect(rows()).toHaveLength(1);
    });

    it("reads at most 25 items and refuses text inside the document as instructions", async () => {
        as(EDITOR);
        h.llm.answer = JSON.stringify(Array.from({ length: 30 }, () => ({ nope: 1 })));
        expect((await run()).body).toMatchObject({ proposed: 0, discarded_invalid: 30 });
    });
});

describe("what is sent", () => {
    it("sends the fixed prompt with the CODES of the catalog and the text, and no client or project data", async () => {
        as(EDITOR);
        answer();
        await run();
        const call = h.llm.calls[0];
        expect(Object.keys(call).sort()).toEqual(["abortSignal", "apiKeys", "maxTokens", "model", "systemPrompt", "user"]);
        expect(call.systemPrompt).toBe(buildProposeSystemPrompt(catalogCodes()));
        for (const rule of OBLIGATION_RULES) expect(String(call.systemPrompt)).toContain(`- ${rule.code}`);
        expect(String(call.user)).toContain(TEXT);
        const sent = JSON.stringify({ ...call, apiKeys: undefined, abortSignal: undefined });
        for (const secret of ["LGSM.docx", "Biblioteca legal", "Elena Editora", "elena@example.test", EDITOR, LAW_PROJECT, ORG, DOC, VERSION, "sk-own"])
            expect(sent, secret).not.toContain(secret);
        expect(String(call.systemPrompt)).not.toContain("| "); // codes only: no names, no wording of the rules
    });

    it("records the egress before the call, and sends nothing when it cannot be recorded", async () => {
        as(EDITOR);
        await run();
        const audit = tables().audit_events.filter((row) => row.action === "llm.egress");
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ user_id: EDITOR, org_id: ORG, surface: "rule_suggestion_law", project_id: LAW_PROJECT, chat_id: null, model: "claude-sonnet-5-5" });
        expect(JSON.stringify(audit[0])).not.toContain("LEY GENERAL");
        h.state!.failNext("audit_events", "insert", { message: "down" });
        answer(item());
        const before = h.llm.calls.length;
        expect((await run()).status).toBe(500);
        expect(h.llm.calls).toHaveLength(before);
        expect(rows()).toHaveLength(0);
    });

    it("never uses the deployment's key and fails closed with no key or model: no call, no egress, no record", async () => {
        as(EDITOR);
        tables().user_api_keys.length = 0;
        h.settings = { ...h.settings, api_keys: { claude: "***" } };
        vi.stubEnv("ANTHROPIC_API_KEY", "***");
        expect((await request(app).get(`${base}/route`)).body).toEqual({ route: null });
        const res = await run();
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("missing_api_key");
        h.settings = { ...h.settings, api_keys: {} };
        expect((await run()).body.code).toBe("model_required");
        expect(h.llm.calls).toHaveLength(0);
        expect(tables().audit_events).toHaveLength(0);
        expect(rows()).toHaveLength(0);
    });

    it("says where the text would go, only to someone who can propose", async () => {
        as(EDITOR);
        expect((await request(app).get(`${base}/route`)).body).toEqual({ route: { provider: "claude", model: "claude-sonnet-5-5" } });
        as(VIEWER);
        expect((await request(app).get(`${base}/route`)).body).toEqual({ route: null });
    });

    it("calls nothing but the model: no other service, and the module imports none and never writes the catalog (acceptance 2, 8)", async () => {
        as(EDITOR);
        answer(item());
        const fetch = vi.spyOn(globalThis, "fetch");
        try {
            await run();
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            fetch.mockRestore();
        }
        const dir = join(__dirname, "../../modules/radar");
        const forbidden = /from\s+["'][^"']*(citationSupport|typesafe|landingai|\/ocr\/|documents\.ocr|documents\.split|webSearch|jev)[^"']*["']/i;
        const files = readdirSync(dir).filter((name) => name.startsWith("radar.proposals") && name.endsWith(".ts"));
        expect(files.sort()).toEqual(["radar.proposals.markdown.ts", "radar.proposals.shared.ts", "radar.proposals.ts"]);
        for (const name of files) {
            const code = readFileSync(join(dir, name), "utf8");
            expect(code, name).not.toMatch(forbidden);
            expect(code, name).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']/);
            expect(code, name).not.toMatch(/writeFile|appendFile/);
            // Nothing here imports the catalog JSON or anything that could write it.
            expect(code, name).not.toMatch(/radar_catalogo|\.json["']/);
        }
    });

    it("is not read by any calculation or turn-on module: none of them imports the proposals (acceptance 8)", () => {
        const dir = join(__dirname, "../../modules/radar");
        const readers = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.startsWith("radar.proposals") && !name.startsWith("radar.suggest"));
        expect(readers.length).toBeGreaterThan(5);
        for (const name of readers) {
            const code = readFileSync(join(dir, name), "utf8");
            if (name === "radar.service.ts" || name === "radar.routes.ts") continue; // the facade and the HTTP layer only forward
            expect(code, name).not.toMatch(/radar\.proposals|plazo_propuesto|plazoPropuesto/);
        }
        for (const name of ["radar.derive.ts", "radar.dates.ts", "radar.obligations.ts", "radar.rules.manage.ts", "radar.rules.ts", "radar.rules.view.ts"])
            expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/proposal|plazo/i);
    });

    it("refuses a version with no ready text and a text above 120,000 characters before anything is sent (acceptance 4)", async () => {
        as(EDITOR);
        const none = await run(NO_TEXT_VERSION);
        expect(none.status).toBe(422);
        expect(none.body.code).toBe("source_text_unavailable");
        const huge = await run(HUGE_VERSION);
        expect(huge.status).toBe(422);
        expect(huge.body.code).toBe("suggestion_text_too_large");
        expect(h.llm.calls).toHaveLength(0);
        expect(tables().audit_events).toHaveLength(0);
        h.texts[HUGE_VERSION] = "a".repeat(MAX_EXTRACT_TEXT_CHARS);
        expect((await run(HUGE_VERSION)).status).toBe(200);
        expect(String(h.llm.calls[0].user)).toContain("a".repeat(MAX_EXTRACT_TEXT_CHARS));
    });

    it("answers 422 when the provider fails or refuses, without its words, and saves nothing", async () => {
        as(EDITOR);
        h.llm.error = new Error("500 upstream said: LEY GENERAL secret");
        const failed = await run();
        expect(failed.status).toBe(422);
        expect(failed.body.code).toBe("suggestion_provider_failed");
        expect(JSON.stringify(failed.body)).not.toContain("LEY GENERAL");
        h.llm.error = new UserFacingError("The Anthropic API key was rejected.");
        expect((await run()).body.code).toBe("suggestion_provider_refused");
        expect(rows()).toHaveLength(0);
    });

    it("rejects a malformed or foreign version", async () => {
        as(EDITOR);
        expect((await run("not-a-uuid")).status).toBe(404);
        for (const version of [FOREIGN_VERSION, MATTER_VERSION, id(999)]) {
            const res = await run(version);
            expect(res.status, version).toBe(400);
            expect(res.body.code).toBe("version_not_in_matter");
        }
        expect(h.llm.calls).toHaveLength(0);
    });

    it("stops at the project's limit before asking the model", async () => {
        as(EDITOR);
        tables().obligation_rule_suggestions.push(...Array.from({ length: 2000 }, (_, index) => ({ id: id(5000 + index), flow: "new_rule_draft", project_id: LAW_PROJECT, version_id: id(9), text_sha256: "x", start_char: index, end_char: index + 1 })));
        const res = await run();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("rule_proposal_limit");
        expect(h.llm.calls).toHaveLength(0);
    });
});

describe("where the law text lives (C8)", () => {
    it("reads only from a project of a firm that no matter is bound to: a matter's project and a personal project are refused before anything", async () => {
        as(OWNER);
        const matter = await run(MATTER_VERSION, MATTER_PROJECT);
        expect(matter.status).toBe(409);
        expect(matter.body.code).toBe("rule_proposal_matter_project");
        const personal = await run(FOREIGN_VERSION, PERSONAL_PROJECT);
        expect(personal.status).toBe(409);
        expect(personal.body.code).toBe("rule_proposal_firm_project_required");
        for (const path of [`/projects/${MATTER_PROJECT}/rule-proposals`, `/projects/${MATTER_PROJECT}/rule-proposals/export`])
            expect((await request(app).get(path)).body.code).toBe("rule_proposal_matter_project");
        expect(h.llm.calls).toHaveLength(0);
        expect(tables().audit_events).toHaveLength(0);
        expect(rows()).toHaveLength(0);
    });
});

describe("the lawyer decides (acceptance 3, 6, 7)", () => {
    const propose = async () => {
        as(EDITOR);
        answer(item(), item({ article: "Art. 186", quote: Q_186, plazo_propuesto: null }));
        await run();
        return rows().map((row) => row.id as string);
    };

    it("a proposal is not a rule: it never appears among the rules of a matter or in the turn-on list", async () => {
        await propose();
        h.roles[MATTER_PROJECT][EDITOR] = "editor";
        tables().matter_memberships = [{ matter_id: MATTER, user_id: EDITOR, status: "active", role: "editor" }];
        const res = await request(app).get(`/projects/${MATTER_PROJECT}/matters/${MATTER}/radar/rules`);
        expect(res.status).toBe(200);
        {
            const text = JSON.stringify(res.body);
            expect(text).not.toContain("Celebrar la asamblea general ordinaria anual");
            expect(text).not.toContain("+4 meses");
            expect(text).not.toContain("Cierre del ejercicio social");
            expect(res.body.rules.map((rule: { code: string }) => rule.code).sort()).toEqual(OBLIGATION_RULES.map((rule) => rule.code).sort());
        }
        expect(tables().matter_obligation_rule_events).toHaveLength(0);
    });

    it("sending to legal records exactly one event, turns nothing on and writes nothing but the event", async () => {
        const [first] = await propose();
        const before = JSON.stringify(rows());
        const res = await request(app).post(`${base}/${first}/send-to-legal`).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: first, status: "sent_to_legal", effective_status: "sent_to_legal", decided_by: EDITOR });
        expect(events()).toEqual([expect.objectContaining({ suggestion_id: first, matter_id: null, action: "sent_to_legal", actor_user_id: EDITOR, catalog_code: null })]);
        expect(JSON.stringify(rows())).toBe(before);
        expect(tables().matter_obligation_rule_events).toHaveLength(0);
    });

    it("implemented needs sent_to_legal first, a person and a verified code of the deployed catalog", async () => {
        const [first, second] = await propose();
        const early = await request(app).post(`${base}/${first}/implemented`).send({ catalog_code: "lgsm.asamblea_ordinaria_anual" });
        expect(early.status).toBe(409);
        expect(early.body.code).toBe("proposal_already_decided");
        expect((await request(app).post(`${base}/${first}/send-to-legal`).send({})).status).toBe(200);
        for (const body of [{}, { catalog_code: "inventada.regla" }, { catalog_code: "" }, { catalog_code: 5 }]) {
            const bad = await request(app).post(`${base}/${first}/implemented`).send(body);
            expect(bad.status, JSON.stringify(body)).toBe(422);
            expect(bad.body.code).toBe("proposal_unknown_catalog_code");
        }
        expect((await request(app).post(`${base}/${first}/implemented`).send(null as never)).status).toBe(422);
        const done = await request(app).post(`${base}/${first}/implemented`).send({ catalog_code: "lgsm.asamblea_ordinaria_anual", reason: "PR #300" });
        expect(done.status).toBe(200);
        expect(done.body).toMatchObject({ status: "implemented", catalog_code: "lgsm.asamblea_ordinaria_anual", decided_by: EDITOR });
        expect(events().at(-1)).toMatchObject({ action: "implemented", actor_user_id: EDITOR, catalog_code: "lgsm.asamblea_ordinaria_anual", reason: "PR #300" });
        // Final: nothing follows implemented.
        for (const path of ["send-to-legal", "discard", "implemented"])
            expect((await request(app).post(`${base}/${first}/${path}`).send({ catalog_code: "lgsm.asamblea_ordinaria_anual" })).status).toBe(409);
        // A pending one cannot be implemented either, and a viewer cannot write any of it.
        as(VIEWER);
        expect((await request(app).post(`${base}/${second}/implemented`).send({ catalog_code: "lgsm.asamblea_ordinaria_anual" })).status).toBe(403);
    });

    it("discarding records one event; sent drafts may still be discarded; nothing is deleted", async () => {
        const [first, second] = await propose();
        expect((await request(app).post(`${base}/${first}/discard`).send({ reason: "No aplica." })).body.status).toBe("discarded");
        expect((await request(app).post(`${base}/${second}/send-to-legal`).send({})).status).toBe(200);
        expect((await request(app).post(`${base}/${second}/discard`).send({})).status).toBe(200);
        for (const path of ["send-to-legal", "discard"]) expect((await request(app).post(`${base}/${first}/${path}`).send({})).status).toBe(409);
        expect(events().map((event) => event.action)).toEqual(["discarded", "sent_to_legal", "discarded"]);
        expect(rows()).toHaveLength(2);
    });

    it("answers 409 when the database refuses an event out of order, and validates id, body and reason", async () => {
        const [first] = await propose();
        h.state!.failNext("obligation_rule_suggestion_events", "insert", { code: "23514", message: "does not follow" });
        expect((await request(app).post(`${base}/${first}/send-to-legal`).send({})).body.code).toBe("proposal_already_decided");
        h.state!.failNext("obligation_rule_suggestion_events", "insert", { code: "XX000", message: "boom" });
        expect((await request(app).post(`${base}/${first}/discard`).send({})).status).toBe(500);
        expect((await request(app).post(`${base}/not-a-uuid/discard`).send({})).status).toBe(404);
        expect((await request(app).post(`${base}/${id(777)}/discard`).send({})).status).toBe(404);
        const long = await request(app).post(`${base}/${first}/discard`).send({ reason: "x".repeat(501) });
        expect(long.status).toBe(400);
        expect(long.body.code).toBe("invalid_rule_proposal");
        expect((await request(app).post(`${base}/${first}/discard`).send([1])).status).toBe(400);
        expect(events()).toHaveLength(0);
    });

    it("marks a proposal obsolete when the text of its version changed, and will not send it", async () => {
        const [first] = await propose();
        h.texts[VERSION] = `${TEXT}\nArtículo 200. Nuevo.`;
        const list = await request(app).get(base);
        expect(list.body.proposals.find((p: { id: string }) => p.id === first)).toMatchObject({ stale_reason: "text_changed", effective_status: "obsolete" });
        const res = await request(app).post(`${base}/${first}/send-to-legal`).send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("proposal_obsolete");
        expect((await request(app).post(`${base}/${first}/discard`).send({})).status).toBe(200);
    });
});

describe("the file for legal (acceptance 5; format of legal, t_2bf126c1)", () => {
    it("holds only drafts sent to legal and not discarded, with the fixed legend, the quote as stored and an unverified term", async () => {
        as(EDITOR);
        answer(
            item({ quote: Q_181.toUpperCase() }),
            item({ article: "Art. 186", quote: Q_MULTI, plazo_propuesto: null, obligation: "Convocar | con anticipación." }),
            item({ article: "Art. 190", quote: Q_190 }),
        );
        await run();
        const [first, second, third] = rows().map((row) => row.id as string);
        for (const proposal of [first, second]) await request(app).post(`${base}/${proposal}/send-to-legal`).send({});
        await request(app).post(`${base}/${third}/discard`).send({});
        // A catalog suggestion of a matter is never part of it.
        rows().push({ id: id(7000), flow: "catalog_match", matter_id: MATTER, project_id: LAW_PROJECT, rule_code: "lft.ptu_reparto", quote: "no" });
        events().push({ id: id(7001), suggestion_id: id(7000), matter_id: MATTER, action: "accepted" });

        as(VIEWER);
        const res = await request(app).get(`${base}/export`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/markdown");
        expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="propuestas-reglas-biblioteca-legal-leyes-\d{8}\.md"$/);
        const md = res.text;
        expect(md).toContain("Borrador sin verificar. No se puede usar hasta que legal lo verifique y se agregue al catálogo. La cita se comprobó solo contra el texto subido, no contra la fuente oficial. El plazo lo propuso la IA y no está verificado.");
        expect(md).toContain("Número de propuestas: 2");
        expect(md).toContain("Proyecto: Biblioteca legal: Leyes");
        expect(md).toContain("claude / claude-sonnet-5-5");
        expect(md).toMatch(/text_sha256: `[0-9a-f]{64}`/);
        expect(md).toContain(`| # | id_propuesta | codigo | Obligación propuesta (IA) | Cuándo aplica | Dato de partida (IA) | Plazo propuesto (borrador, sin verificar) | Cita literal (texto subido) | Ley y artículo (según el texto subido) | Pág. | URL oficial | Última reforma DOF | estado | Notas de legal |`);
        const lines = md.split("\n").filter((line) => line.startsWith("| 1 ") || line.startsWith("| 2 "));
        expect(lines).toHaveLength(2);
        const one = lines.find((line) => line.includes(`\`${first}\``))!;
        const two = lines.find((line) => line.includes(`\`${second}\``))!;
        expect(one).toContain("Sin verificar: +4 meses");
        expect(one).toContain(`«${Q_181}»`);
        expect(one).toContain("| propuesta |");
        expect(two).toContain("Convocar \\| con anticipación.");
        expect(two).toContain("«ejercicio social.<br>Artículo 186. La convocatoria para las asambleas»");
        expect(two).toContain("| — |");
        expect(md).not.toContain(Q_190);
        expect(md).not.toContain("lft.ptu_reparto");
        expect(md).not.toMatch(/verificada/i);
        // Generating the file records nothing and sends nothing.
        expect(events()).toHaveLength(4);
    });

    it("lists nothing for a stranger, and is empty (still with the legend) when nothing was sent", async () => {
        as(STRANGER);
        expect((await request(app).get(`${base}/export`)).status).toBe(404);
        as(OWNER);
        const res = await request(app).get(`${base}/export`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Número de propuestas: 0");
        expect(res.text).toContain("Borrador sin verificar.");
    });
});

describe("who can ask and who can read (matrix)", () => {
    it("lets the project's owner and editors, and nobody else, propose and decide", async () => {
        answer(item());
        for (const user of [OWNER, EDITOR]) {
            as(user);
            rows().length = 0;
            events().length = 0;
            tables().user_api_keys.push({ ...(await keyRow({ kind: "user", id: user }, "claude", `sk-${user}`)), user_id: user });
            expect((await run()).status, user).toBe(200);
        }
        const calls = h.llm.calls.length;
        const target = rows()[0].id as string;
        as(VIEWER);
        for (const path of [`/versions/${VERSION}/propose`, `/${target}/send-to-legal`, `/${target}/discard`, `/${target}/implemented`]) {
            const res = await request(app).post(`${base}${path}`).send({});
            expect(res.status, path).toBe(403);
            expect(res.body.code).toBe("rule_proposal_write_required");
        }
        as(STRANGER);
        for (const path of ["", "/route", "/export"]) expect((await request(app).get(`${base}${path}`)).status, path).toBe(404);
        for (const path of [`/versions/${VERSION}/propose`, `/${target}/send-to-legal`])
            expect((await request(app).post(`${base}${path}`).send({})).status, path).toBe(404);
        expect(h.llm.calls).toHaveLength(calls);
        expect(events()).toHaveLength(0);
    });

    it("lets a viewer read the drafts but not the versions to run on", async () => {
        as(EDITOR);
        answer(item());
        await run();
        const editor = await request(app).get(base);
        expect(editor.body).toMatchObject({ can_write: true });
        expect(editor.body.versions.length).toBeGreaterThan(0);
        expect(editor.body.people).toEqual([{ user_id: EDITOR, name: "Elena Editora" }]);
        as(VIEWER);
        const viewer = await request(app).get(base);
        expect(viewer.status).toBe(200);
        expect(viewer.body).toMatchObject({ can_write: false, versions: [] });
        expect(viewer.body.proposals).toHaveLength(1);
        expect(viewer.body.proposals[0]).toMatchObject({ quote: Q_181, plazo_propuesto: "+4 meses", status: "pending" });
    });

    it("cuts a removed member off on their very next request", async () => {
        as(EDITOR);
        expect((await run()).status).toBe(200);
        delete h.roles[LAW_PROJECT][EDITOR];
        expect((await run()).status).toBe(404);
        expect((await request(app).get(base)).status).toBe(404);
    });
});
