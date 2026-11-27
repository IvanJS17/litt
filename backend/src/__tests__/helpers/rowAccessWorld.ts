import type { Db } from "../../lib/supabase";
import { tableDb } from "./tableDb";

/**
 * A small organization whose documents sit in projects, over the in-memory
 * database, so the REAL access code answers "can this person open this
 * document now". The organization's authorization epoch never changes here:
 * everything a test takes away is taken away without it.
 *
 * `user-1` is a plain member of the organization. Document `doc-N` sits in
 * its own project `proj-N`, visible to the whole organization, unless a test
 * takes the access away.
 */
export const ROW_ACCESS_ORG = "00000000-0000-4000-8000-000000000001";
export const ROW_ACCESS_USER = "user-1";
export const ROW_ACCESS_EMAIL = "user-1@example.test";

export type ReadLoss = "override" | "private" | "moved" | "deleted" | "unshared";

export function rowAccessWorld({
    documents,
    personal = false,
}: {
    /** How many documents (`doc-1` …) exist. */
    documents: number;
    /** A personal review over a personal project shared with the person by address. */
    personal?: boolean;
}) {
    const org = personal ? null : ROW_ACCESS_ORG;
    const tables: Record<string, Record<string, unknown>[]> = {
        organizations: [{ id: ROW_ACCESS_ORG, authorization_epoch: 7 }],
        org_members: [{ org_id: ROW_ACCESS_ORG, user_id: ROW_ACCESS_USER, role: "member" }],
        // Each document has a project of its own, so taking one away leaves the others open.
        projects: [
            ...Array.from({ length: documents }, (_, index) => ({
                id: `proj-${index + 1}`, org_id: org, user_id: "owner-1", visibility: personal ? "private" : "organization", archived_at: null,
            })),
            { id: "proj-closed", org_id: org, user_id: "owner-1", visibility: "private", archived_at: null },
        ],
        project_org_access_overrides: [],
        project_access_grants: personal
            ? Array.from({ length: documents }, (_, index) => ({ project_id: `proj-${index + 1}`, email: ROW_ACCESS_EMAIL, role: "editor" }))
            : [],
        documents: Array.from({ length: documents }, (_, index) => ({
            id: `doc-${index + 1}`,
            user_id: "owner-1",
            project_id: `proj-${index + 1}`,
            org_id: org,
        })),
        tabular_reviews: [{ id: "rev-1", org_id: org }],
        tabular_cells: [],
    };
    const failSelects: string[] = [];
    const { db: base, calls } = tableDb(tables, { failSelects });
    const rpc = async (name: string, args: Record<string, unknown>) => {
        if (name === "private_matter_denied_project_ids") return { data: [], error: null };
        if (name === "org_item_is_ownerless") return { data: false, error: null };
        const answered = await (base as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> }).rpc(name, args);
        const failed = (answered as { error?: unknown }).error;
        // Lease bookkeeping and the like: answered "true", as the lease tests do.
        return failed ? { data: true, error: null } : answered;
    };
    const auth = { admin: { getUserById: async () => ({ data: { user: { email: ROW_ACCESS_EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }) } };
    const db = { from: (base as unknown as { from: Db["from"] }).from, rpc, auth } as unknown as Db;

    const lose = (how: ReadLoss, docNumber: number) => {
        const id = `doc-${docNumber}`;
        const project = `proj-${docNumber}`;
        if (how === "override")
            tables.project_org_access_overrides.push({ project_id: project, org_id: ROW_ACCESS_ORG, user_id: ROW_ACCESS_USER, role: "deny" });
        if (how === "private") (tables.projects.find((row) => row.id === project) as Record<string, unknown>).visibility = "private";
        if (how === "moved") (tables.documents.find((doc) => doc.id === id) as Record<string, unknown>).project_id = "proj-closed";
        if (how === "deleted") tables.documents = tables.documents.filter((doc) => doc.id !== id);
        if (how === "unshared") tables.project_access_grants = tables.project_access_grants.filter((grant) => grant.project_id !== project);
    };
    return { tables, db, calls, failSelects, lose, org };
}

/** Reads of `documents` the access code made: the question "may this person open these documents". */
export const documentQuestions = (calls: { table: string; op: string }[]) =>
    calls.filter((call) => call.table === "documents" && call.op === "select").length;
