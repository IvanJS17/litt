// A small firm, in memory, for the MCP tool suites: two organizations, people
// in every role, a public and a private matter with documents, and the SQL
// functions the services call (stood in for by handlers that apply the REAL
// access rules from lib/access to these tables). Synthetic data only.

import { randomUUID } from "node:crypto";
import { checkProjectAccess, ensureChatAccess, ensureDocAccess } from "../../lib/access";
import type { Db } from "../../lib/supabase";
import { memoryDb, type Row } from "./memoryDb";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const ORG2 = "22222222-2222-4222-8222-222222222222";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PEOPLE = {
    owner: { id: uid(1), email: "owner@firm.example" },
    editor: { id: uid(2), email: "editor@firm.example" },
    viewer: { id: uid(3), email: "viewer@firm.example" },
    admin: { id: uid(4), email: "admin@firm.example" },
    apprentice: { id: uid(5), email: "apprentice@firm.example" },
    outsider: { id: uid(6), email: "outsider@other.example" },
    // Member of ORG too, but connects an app that only covers ORG2.
    narrow: { id: uid(7), email: "narrow@firm.example" },
} as const;
export type PersonName = keyof typeof PEOPLE;

export const PROJECT_PUBLIC = "aaaaaaaa-0000-4000-8000-000000000001";
export const PROJECT_PRIVATE = "aaaaaaaa-0000-4000-8000-000000000002";
export const DOC_PUBLIC = "bbbbbbbb-0000-4000-8000-000000000001";
export const DOC_PRIVATE = "bbbbbbbb-0000-4000-8000-000000000002";
export const DOC_HELD = "bbbbbbbb-0000-4000-8000-000000000003";
export const VERSION_PUBLIC = "cccccccc-0000-4000-8000-000000000001";
export const VERSION_PRIVATE = "cccccccc-0000-4000-8000-000000000002";
export const VERSION_HELD = "cccccccc-0000-4000-8000-000000000003";
export const FOLDER = "dddddddd-0000-4000-8000-000000000001";
// Playbooks: one the whole firm may use, a draft, and one only its creator may open.
export const PLAYBOOK_READY = "eeeeeeee-0000-4000-8000-000000000001";
export const PLAYBOOK_DRAFT = "eeeeeeee-0000-4000-8000-000000000002";
export const PLAYBOOK_PRIVATE = "eeeeeeee-0000-4000-8000-000000000003";
export const RULE_RENT = "rule-renta";
export const RULE_TERM = "rule-plazo";
// Tabular reviews: one in each matter, with a filled and a waiting cell.
export const REVIEW_PUBLIC = "99999999-0000-4000-8000-000000000001";
export const REVIEW_PRIVATE = "99999999-0000-4000-8000-000000000002";
export const ROW_PUBLIC = "88888888-0000-4000-8000-000000000001";
export const ROW_PRIVATE = "88888888-0000-4000-8000-000000000002";

const playbookContent = (name: string) => ({
    name,
    description: "Reglas de arrendamiento",
    representedParty: "Arrendador",
    documentTypes: ["arrendamiento"],
    jurisdictions: ["CDMX"],
    rules: [
        { id: RULE_RENT, name: "Renta", concept: "La renta es mensual y fija.", scope: "clause", required: true, guidance: "", standard: { name: "Estándar", criteria: "Renta mensual fija en pesos" }, fallbacks: [], unacceptable: [], conditions: [], actions: [], sourceRefs: [] },
        { id: RULE_TERM, name: "Plazo", concept: "Plazo de un año.", scope: "clause", required: false, guidance: "", standard: null, fallbacks: [], unacceptable: [], conditions: [], actions: [], sourceRefs: [] },
    ],
    topics: [],
});

export const SECRET_TEXT = "Cláusula primera: el arrendatario pagará una renta mensual de $10,000 MXN.";

export function buildWorld() {
    const tables: Record<string, Row[]> = {
        mcp_oauth_clients: [],
        mcp_oauth_requests: [],
        mcp_grants: [],
        mcp_oauth_codes: [],
        mcp_oauth_tokens: [],
        mcp_oauth_audit: [],
        mcp_tool_calls: [],
        audit_events: [],
        user_profiles: [],
        training_stages: [],
        organizations: [
            { id: ORG, name: "Firm A", kind: "firm", deleted_at: null, authorization_epoch: 1, managed_accounts: false },
            { id: ORG2, name: "Firm B", kind: "firm", deleted_at: null, authorization_epoch: 1, managed_accounts: false },
        ],
        org_members: [
            { org_id: ORG, user_id: PEOPLE.owner.id, role: "owner" },
            { org_id: ORG, user_id: PEOPLE.editor.id, role: "member" },
            { org_id: ORG, user_id: PEOPLE.viewer.id, role: "member" },
            { org_id: ORG, user_id: PEOPLE.admin.id, role: "admin" },
            { org_id: ORG, user_id: PEOPLE.apprentice.id, role: "member" },
            { org_id: ORG, user_id: PEOPLE.narrow.id, role: "member" },
            { org_id: ORG2, user_id: PEOPLE.narrow.id, role: "member" },
            { org_id: ORG2, user_id: PEOPLE.outsider.id, role: "member" },
        ],
        projects: [
            { id: PROJECT_PUBLIC, user_id: PEOPLE.owner.id, org_id: ORG, name: "Arrendamiento Torres", cm_number: "CM-001", practice: "civil", visibility: "organization", archived_at: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-10T10:00:00Z" },
            { id: PROJECT_PRIVATE, user_id: PEOPLE.owner.id, org_id: ORG, name: "Litigio Reservado", cm_number: "CM-002", practice: "litigio", visibility: "private", archived_at: null, created_at: "2026-11-02T10:00:00Z", updated_at: "2026-11-11T10:00:00Z" },
        ],
        project_org_access_overrides: [
            { project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.editor.id, role: "editor" },
            { project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.viewer.id, role: "viewer" },
            { project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.apprentice.id, role: "viewer" },
            { project_id: PROJECT_PUBLIC, org_id: ORG, user_id: PEOPLE.viewer.id, role: "viewer" },
        ],
        // The private matter's team (the stand-in for the SQL guard reads this).
        private_matter_team: [PEOPLE.owner, PEOPLE.editor, PEOPLE.viewer, PEOPLE.apprentice].map((p) => ({
            project_id: PROJECT_PRIVATE,
            user_id: p.id,
        })),
        project_subfolders: [{ id: FOLDER, project_id: PROJECT_PUBLIC, parent_folder_id: null, name: "Anexos", user_id: PEOPLE.owner.id, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:00:00Z" }],
        documents: [
            { id: DOC_PUBLIC, project_id: PROJECT_PUBLIC, org_id: ORG, user_id: PEOPLE.owner.id, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: VERSION_PUBLIC, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" },
            { id: DOC_PRIVATE, project_id: PROJECT_PRIVATE, org_id: ORG, user_id: PEOPLE.owner.id, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: VERSION_PRIVATE, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" },
            { id: DOC_HELD, project_id: PROJECT_PUBLIC, org_id: ORG, user_id: PEOPLE.apprentice.id, status: "ready", folder_id: null, library_kind: "file", archived_at: null, current_version_id: VERSION_HELD, created_at: "2026-11-04T10:00:00Z", updated_at: "2026-11-06T10:00:00Z" },
        ],
        document_versions: [
            { id: VERSION_PUBLIC, document_id: DOC_PUBLIC, storage_path: "p/1", pdf_storage_path: null, source: "upload", version_number: 1, filename: "contrato.docx", file_type: "docx", size_bytes: 1000, page_count: 3, textless_page_count: 0, content_sha256: "a".repeat(64), training_stage: null, deleted_at: null, text_revision: "rev-1", created_at: "2026-11-03T10:00:00Z" },
            { id: VERSION_PRIVATE, document_id: DOC_PRIVATE, storage_path: "p/2", pdf_storage_path: null, source: "upload", version_number: 1, filename: "demanda.pdf", file_type: "pdf", size_bytes: 2000, page_count: 5, textless_page_count: 2, content_sha256: "b".repeat(64), training_stage: null, deleted_at: null, text_revision: "rev-2", created_at: "2026-11-03T10:00:00Z" },
            { id: VERSION_HELD, document_id: DOC_HELD, storage_path: "p/3", pdf_storage_path: null, source: "upload", version_number: 1, filename: "borrador.docx", file_type: "docx", size_bytes: 500, page_count: 1, textless_page_count: 0, content_sha256: "c".repeat(64), training_stage: "pasante", deleted_at: null, text_revision: "rev-3", created_at: "2026-11-04T10:00:00Z" },
        ],
        document_version_texts: [
            { version_id: VERSION_PUBLIC, source_revision: "rev-1", extractor_version: 1, status: "ready", text_content: SECRET_TEXT, textless_page_count: 0 },
            { version_id: VERSION_PRIVATE, source_revision: "rev-2", extractor_version: 1, status: "ready", text_content: "Demanda reservada. Hechos: el demandado incumplió.", textless_page_count: 2 },
            { version_id: VERSION_HELD, source_revision: "rev-3", extractor_version: 1, status: "ready", text_content: "Borrador del pasante: cláusula primera.", textless_page_count: 0 },
        ],
        training_version_approvals: [],
        playbooks: [
            { id: PLAYBOOK_READY, user_id: PEOPLE.owner.id, org_id: ORG, visibility: "organization", name: "Arrendamientos", description: "Reglas de arrendamiento", content_json: playbookContent("Arrendamientos"), source_filename: null, import_model: null, status: "ready", is_model: false, derived_from_playbook_id: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-10T10:00:00Z" },
            { id: PLAYBOOK_DRAFT, user_id: PEOPLE.owner.id, org_id: ORG, visibility: "organization", name: "Borrador de reglas", description: "", content_json: playbookContent("Borrador de reglas"), source_filename: null, import_model: null, status: "draft", is_model: false, derived_from_playbook_id: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" },
            { id: PLAYBOOK_PRIVATE, user_id: PEOPLE.owner.id, org_id: ORG, visibility: "private", name: "Reglas reservadas", description: "", content_json: playbookContent("Reglas reservadas"), source_filename: null, import_model: null, status: "ready", is_model: false, derived_from_playbook_id: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-08T10:00:00Z" },
        ],
        playbook_runs: [],
        playbook_org_access_overrides: [],
        playbook_shares: [],
        tabular_reviews: [
            { id: REVIEW_PUBLIC, user_id: PEOPLE.owner.id, project_id: PROJECT_PUBLIC, org_id: ORG, title: "Rentas", model: "claude-sonnet-4-5", columns_config: [{ index: 0, name: "Renta", prompt: "¿Cuál es la renta?" }, { index: 1, name: "Plazo", prompt: "¿Cuál es el plazo?" }], document_ids: [DOC_PUBLIC], document_grouping: "document", active_generation_id: null, generation_lease_expires_at: null, created_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-06T10:00:00Z" },
            { id: REVIEW_PRIVATE, user_id: PEOPLE.owner.id, project_id: PROJECT_PRIVATE, org_id: ORG, title: "Demanda", model: "claude-sonnet-4-5", columns_config: [{ index: 0, name: "Hechos", prompt: "Hechos" }], document_ids: [DOC_PRIVATE], document_grouping: "document", active_generation_id: null, generation_lease_expires_at: null, created_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-06T10:00:00Z" },
        ],
        tabular_review_rows: [
            { id: ROW_PUBLIC, review_id: REVIEW_PUBLIC, label: "contrato.docx", row_type: "document", document_id: DOC_PUBLIC, source_document_ids: [DOC_PUBLIC], sort_index: 0 },
            { id: ROW_PRIVATE, review_id: REVIEW_PRIVATE, label: "demanda.pdf", row_type: "document", document_id: DOC_PRIVATE, source_document_ids: [DOC_PRIVATE], sort_index: 0 },
        ],
        tabular_cells: [
            { id: "77777777-0000-4000-8000-000000000001", review_id: REVIEW_PUBLIC, row_id: ROW_PUBLIC, document_id: DOC_PUBLIC, column_index: 0, content: JSON.stringify({ summary: "$10,000 MXN mensuales", flag: "green", reasoning: "Cláusula primera" }), citations: [{ document_id: DOC_PUBLIC, quote: "renta mensual de $10,000 MXN" }], status: "done", generation_id: null },
            { id: "77777777-0000-4000-8000-000000000002", review_id: REVIEW_PUBLIC, row_id: ROW_PUBLIC, document_id: DOC_PUBLIC, column_index: 1, content: null, citations: null, status: "pending", generation_id: null },
        ],
        chats: [],
        chat_messages: [],
        chat_access_grants: [],
        citation_support_checks: [],
        project_access_grants: [],
        memory_files: [],
        matters: [],
        upload_sessions: [],
        upload_session_files: [],
    };

    const world = memoryDb(tables);
    const base = world.db as unknown as { from: (t: string) => unknown; rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> };
    const emails = new Map<string, string>(Object.values(PEOPLE).map((p) => [p.id, p.email]));

    const rpcs: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {
        private_matter_denied_project_ids: ({ p_user_id, p_project_ids }) =>
            (p_project_ids as string[]).filter(
                (id) =>
                    tables.private_matter_team.some((t) => t.project_id === id) &&
                    !tables.private_matter_team.some((t) => t.project_id === id && t.user_id === p_user_id),
            ),
        mcp_oauth_purge: () => null,
        // The chats the person could open (lib/access's own rule per row), newest first.
        get_chats_overview: async (args) => {
            const rows: Row[] = [];
            for (const chat of tables.chats) {
                const workspace = args.p_workspace as string | undefined;
                if (workspace && workspace !== (chat.org_id ?? "personal")) continue;
                const access = await ensureChatAccess(chat as never, String(args.p_user_id), String(args.p_user_email ?? ""), db);
                if (!access.ok) continue;
                const project = tables.projects.find((p) => p.id === chat.project_id);
                rows.push({
                    id: chat.id, project_id: chat.project_id ?? null, user_id: chat.user_id, title: chat.title ?? null,
                    model: chat.model ?? null, created_at: chat.created_at, updated_at: chat.updated_at,
                    project_name: project?.name ?? null, is_owner: chat.user_id === args.p_user_id, access_role: access.projectRole,
                });
            }
            rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
            const offset = Number(args.p_offset ?? 0);
            return rows.slice(offset, offset + (args.p_limit == null ? rows.length : Number(args.p_limit)));
        },
        org_item_is_ownerless: () => false,
        get_projects_overview: async (args) => {
            const user = String(args.p_user_id);
            const rows: Row[] = [];
            for (const project of tables.projects) {
                const access = await checkProjectAccess(String(project.id), user, String(args.p_user_email ?? ""), db);
                if (!access.ok) continue;
                const workspace = args.p_workspace as string | undefined;
                if (workspace && workspace !== (project.org_id ?? "personal")) continue;
                const term = typeof args.p_search_term === "string" ? args.p_search_term.toLowerCase() : null;
                if (term && !`${project.name} ${project.cm_number}`.toLowerCase().includes(term)) continue;
                rows.push({
                    id: project.id,
                    user_id: project.user_id,
                    org_id: project.org_id,
                    access_scope: project.visibility === "organization" ? "organization" : "private",
                    organization_name: "Firm A",
                    name: project.name,
                    cm_number: project.cm_number,
                    practice: project.practice,
                    created_at: project.created_at,
                    updated_at: project.updated_at,
                    is_owner: access.isCreator,
                    access_role: access.projectRole,
                    document_count: tables.documents.filter((d) => d.project_id === project.id).length,
                });
            }
            rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
            const offset = Number(args.p_offset ?? 0);
            return rows.slice(offset, offset + Number(args.p_limit ?? 20));
        },
        read_document_text: async ({ p_user_id, p_user_email, p_document_id, p_version_id }) => {
            const doc = tables.documents.find((d) => d.id === p_document_id);
            const version = tables.document_versions.find((v) => v.id === p_version_id && v.document_id === p_document_id && !v.deleted_at);
            if (!doc || !version) return null;
            const access = await ensureDocAccess(doc as never, String(p_user_id), String(p_user_email ?? ""), db);
            if (!access.ok) return null;
            const text = tables.document_version_texts.find((t) => t.version_id === version.id && t.source_revision === version.text_revision);
            return { revision: version.text_revision, status: text?.status ?? "pending", text: text?.text_content ?? null, textless_page_count: text?.textless_page_count ?? null };
        },
        find_document_text: async (args) => {
            const query = String(args.p_query).toLowerCase();
            const matches: Row[] = [];
            for (const doc of tables.documents) {
                if (args.p_scope === "project" && doc.project_id !== args.p_project_id) continue;
                if (args.p_scope === "document" && doc.id !== args.p_document_id) continue;
                if (args.p_scope === "library" && doc.project_id) continue;
                if (String(doc.org_id ?? "personal") !== args.p_workspace) continue;
                const access = await ensureDocAccess(doc as never, String(args.p_user_id), String(args.p_user_email ?? ""), db);
                if (!access.ok) continue;
                const version = tables.document_versions.find((v) => v.id === doc.current_version_id)!;
                const text = String(tables.document_version_texts.find((t) => t.version_id === version.id)?.text_content ?? "");
                const unit = text.toLowerCase().indexOf(query);
                if (unit < 0) continue;
                // The database counts Unicode characters, not UTF-16 units.
                const pos = Array.from(text.slice(0, unit)).length;
                matches.push({ document_id: doc.id, version_id: version.id, version_number: version.version_number, revision: version.text_revision, filename: version.filename, file_type: version.file_type, storage_path: version.storage_path, library_kind: "file", start_char: pos, end_char: pos + query.length, excerpt_start_char: Math.max(pos - 160, 0), excerpt: Array.from(text).slice(Math.max(pos - 160, 0), pos + query.length + 160).join("") });
            }
            const offset = Number(args.p_offset ?? 0);
            const limit = Number(args.p_limit ?? 10);
            return {
                matches: matches.slice(offset, offset + limit),
                next_offset: matches.length > offset + limit ? offset + limit : null,
                coverage: { total_versions: matches.length, indexed_versions: matches.length, pending_versions: 0, failed_versions: 0, versions_needing_ocr: 0 },
            };
        },
        create_upload_session: (args) => {
            const id = String(args.target_session_id);
            tables.upload_sessions.push({ id, user_id: args.target_user_id, user_email: null, purpose: args.target_purpose, destination: args.target_destination, expected_file_count: (args.target_files as unknown[]).length, status: "pending_upload", expires_at: args.target_expires_at, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            for (const file of args.target_files as Row[]) tables.upload_session_files.push({ ...file, session_id: id, status: "pending_upload", observed_size_bytes: null, etag: null, error_code: null, result: null });
            return null;
        },
        refresh_upload_session_status: ({ target_session_id }) => {
            const session = tables.upload_sessions.find((s) => s.id === target_session_id)!;
            const files = tables.upload_session_files.filter((f) => f.session_id === target_session_id);
            if (files.every((f) => f.status === "completed")) session.status = "completed";
            else if (files.some((f) => f.status === "processing" || f.status === "uploaded")) session.status = "processing";
            return null;
        },
        queue_upload_session_file_processing: ({ target_session_id, target_file_id }) => {
            const file = tables.upload_session_files.find((f) => f.session_id === target_session_id && f.id === target_file_id)!;
            file.status = "processing";
            return randomUUID();
        },
        extend_upload_session_expiry: () => null,
    };

    const db = {
        ...(base as object),
        rpc: async (fn: string, args: Record<string, unknown>) => {
            const handler = rpcs[fn];
            if (!handler) return base.rpc(fn, args);
            try {
                return { data: await handler(args), error: null };
            } catch (error) {
                return { data: null, error };
            }
        },
        auth: {
            admin: {
                getUserById: async (id: string) => ({
                    data: { user: emails.has(id) ? { id, email: emails.get(id), email_confirmed_at: "2026-01-01T00:00:00Z" } : null },
                    error: null,
                }),
            },
            mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
        },
    } as unknown as Db;

    return { db, tables, failNext: world.failNext };
}
