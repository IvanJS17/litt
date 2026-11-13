import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// Beta statistics over HTTP: administrators only, audited on every view, only
// people who accepted the current legal version are listed, deleted accounts
// have no profile, and nothing but counts leaves the server.
const h = vi.hoisted(() => ({
    caller: { id: "admin", email: "boss@firm.example" },
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (t: string, o: string, e: unknown) => void },
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
                next();
            }),
    };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { LEGAL_VERSION } from "../../modules/user/user.profile.storage";

const AUTH = ["Authorization", "Bearer test"] as const;
const RECENT = new Date(Date.now() - 2 * 86400000).toISOString();
const OLDER = new Date(Date.now() - 20 * 86400000).toISOString();
const ANCIENT = new Date(Date.now() - 90 * 86400000).toISOString();
const get = () => request(app).get("/platform/stats").set(...AUTH);
const profile = (user_id: string, extra: Row = {}): Row => ({
    user_id,
    email: `${user_id}@firm.example`,
    display_name: `Name ${user_id}`,
    practice_setting: "private_practice",
    professional_title: "Partner",
    jurisdiction: "CDMX",
    practice_areas: ["Civil"],
    terms_accepted_version: LEGAL_VERSION,
    account_deletion_requested_at: null,
    ...extra,
});

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        user_profiles: [
            profile("ana"),
            profile("beto", { terms_accepted_version: "2026-11-13", jurisdiction: "Jalisco", practice_areas: ["Penal"] }),
            profile("gone", { account_deletion_requested_at: RECENT, display_name: "Secret Name", email: "gone@firm.example" }),
        ],
        organizations: [
            { id: "o1", name: "Firma Uno", kind: "team" },
            { id: "o2", name: "Solo Beto", kind: "team" },
            { id: "p1", name: "Personal", kind: "personal" },
        ],
        org_members: [
            { id: "m1", org_id: "o1", user_id: "ana" },
            { id: "m2", org_id: "o2", user_id: "beto" },
            { id: "m3", org_id: "p1", user_id: "ana" },
        ],
        chats: [
            { id: "c1", user_id: "ana", created_at: RECENT, title: "SECRET CHAT TITLE" },
            { id: "c2", user_id: "ana", created_at: OLDER },
            { id: "c3", user_id: "beto", created_at: RECENT },
            { id: "c4", user_id: "ana", created_at: ANCIENT },
        ],
        documents: [
            { id: "d1", user_id: "ana", library_kind: "file", filename: "secret-contract.pdf" },
            { id: "d2", user_id: "ana", library_kind: "workflow_asset" },
            { id: "d3", user_id: "gone", library_kind: "file" },
        ],
        document_versions: [
            { id: "v1", document_id: "d1", source: "upload", created_at: RECENT },
            { id: "v2", document_id: "d2", source: "upload", created_at: RECENT },
            { id: "v3", document_id: "d1", source: "compared", created_at: RECENT },
            { id: "v4", document_id: "d3", source: "split", created_at: RECENT },
            { id: "v5", document_id: "d1", source: "assistant_edit", created_at: RECENT },
        ],
        document_version_ocr: [
            { version_id: "v1", status: "ready", requested_by: "ana", created_at: RECENT, pages: [{ text: "SECRET" }] },
            { version_id: "v9", status: "failed", requested_by: "ana", created_at: RECENT },
        ],
        tabular_reviews: [{ id: "t1", user_id: "beto", created_at: OLDER }],
        training_gym_attempts: [{ id: "g1", trainee_user_id: "ana", created_at: RECENT }],
        audit_events: [],
    };
    h.state = memoryDb(tables);
    h.caller = { id: "admin", email: "boss@firm.example" };
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "boss@firm.example");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /platform/stats", () => {
    it("is for platform administrators only, and leaves no audit row for others", async () => {
        h.caller = { id: "ana", email: "ana@firm.example" };
        const res = await get();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("platform_admin_required");
        expect(h.state!.tables.audit_events).toEqual([]);
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        h.caller = { id: "admin", email: "boss@firm.example" };
        expect((await get()).status).toBe(403);
    });

    it("records every view in the audit, with the viewer and no payload", async () => {
        expect((await get()).status).toBe(200);
        expect((await get()).status).toBe(200);
        const rows = h.state!.tables.audit_events;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            action: "platform.stats_viewed",
            user_id: "admin",
            user_email: "boss@firm.example",
            surface: "platform",
        });
        expect(rows[0].detail).toBeNull();
    });

    it("refuses to show anything when the audit row cannot be written", async () => {
        h.state!.failNext("audit_events", "insert", { message: "down" });
        const res = await get();
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("ana@firm.example");
    });

    it("counts everyone in the totals, but lists only those who accepted this version", async () => {
        const { body } = await get();
        expect(body.totals).toEqual({ users: 2, deleted_users: 1, organizations: 2, awaiting_acceptance: 1 });
        expect(body.breakdowns.jurisdiction).toEqual(
            expect.arrayContaining([{ key: "CDMX", count: 1 }, { key: "Jalisco", count: 1 }]),
        );
        expect(body.breakdowns.practice_area).toHaveLength(2);
        expect(body.usage.last_30_days).toMatchObject({ chats: 3, documents: 1, compared: 1, scans: 1, tabular: 1, training: 1, split: 1 });
        expect(body.usage.last_7_days).toMatchObject({ chats: 2, tabular: 0 });

        const emails = body.people.map((p: { email: string | null }) => p.email);
        expect(emails).toEqual(["ana@firm.example", null]);
        expect(body.people[0]).toMatchObject({
            name: "Name ana",
            organizations: ["Firma Uno"],
            scope: "private_practice",
            title: "Partner",
            jurisdiction: "CDMX",
            practice_areas: ["Civil"],
            last_activity: RECENT,
            usage: { chats: 2, documents: 1, compared: 1, scans: 1, training: 1 },
        });
        // beto has not accepted: his firm and his row are absent from the lists.
        expect(body.organizations).toEqual([
            { name: "Firma Uno", members: 1, usage: expect.objectContaining({ chats: 2 }) },
        ]);
        expect(JSON.stringify(body)).not.toContain("beto");
        expect(JSON.stringify(body)).not.toContain("Solo Beto");
    });

    it("shows a deleted account as a deleted user with no profile", async () => {
        const deleted = (await get()).body.people.find((p: { deleted: boolean }) => p.deleted);
        expect(deleted).toMatchObject({
            name: null, email: null, organizations: [], scope: null, title: null,
            jurisdiction: null, practice_areas: [], usage: expect.objectContaining({ split: 1 }),
        });
    });

    it("carries no content, names of documents, or keys", async () => {
        const text = JSON.stringify((await get()).body);
        for (const secret of ["SECRET", "secret-contract", "api_key", "filename", "prompt"])
            expect(text).not.toContain(secret);
    });

    it("has no export route", async () => {
        for (const path of ["/platform/stats.csv", "/platform/stats/export", "/platform/stats/csv"])
            expect((await request(app).get(path).set(...AUTH)).status).toBe(404);
    });
});
