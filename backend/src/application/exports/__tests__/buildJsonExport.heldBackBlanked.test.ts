import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/access", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../../lib/access")>();
    return {
        ...real,
        checkProjectAccess: vi.fn(async (projectId: string, ...rest: unknown[]) =>
            projectId === "project-closed"
                ? { ok: false }
                : projectId === "project-open"
                  ? { ok: true, projectRole: "viewer", orgRole: "member", isCreator: false }
                  : (real.checkProjectAccess as any)(projectId, ...rest),
        ),
    };
});

import { buildUserAccountExport, buildUserChatsExport, buildUserTabularReviewsExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A row kept with content blanked because the source it was drawn from is gone
// is counted in the notice, once. A row with nothing to blank is not. A review
// the holder cannot open is counted once, and covers its chats.
const holder = "associate";
const email = "associate@example.test";
const at = "2026-01-02T00:00:00Z";

const base = (): Record<string, Row[]> => ({
    organizations: [{ id: "org", kind: "team" }],
    org_members: [
        { org_id: "org", user_id: holder, role: "member" },
        { org_id: "org", user_id: "partner", role: "owner" },
    ],
    projects: [{ id: "p-walled", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null }],
    project_org_access_overrides: [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }],
});
const trainee = (id: string, over: Row = {}): Row => ({ id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null, created_at: at, ...over });
const account = async (tables: Record<string, Row[]>, orgId: string | null = "org") =>
    (await buildUserAccountExport(makeExportDb(tables).db, holder, email, orgId)) as any;
const openChat = (): Record<string, Row[]> => ({
    chats: [{ id: "c", user_id: holder, org_id: "org", project_id: null, title: "T", created_at: at }],
    chat_messages: [
        { id: "c-u", chat_id: "c", role: "user", content: "TYPED", files: null, created_at: "2026-01-01T00:00:01Z" },
        { id: "c-a", chat_id: "c", role: "assistant", content: [{ type: "content", text: "ANSWER" }], citations: null, created_at: "2026-01-01T00:00:02Z" },
    ],
});
const openNote = (): Row => trainee("tn", { chat_id: "c", message_id: "c-u", attempt: "A", contrast: "C", contrast_status: "ready" });
const openReview = (): Row => trainee("wr", { chat_id: "c", status: "ready", proposed: ["P"] });

describe("account export: a kept row whose content was blanked because its source is gone", () => {
    it("counts a reading whose document was deleted", async () => {
        const out = await account({
            ...base(),
            training_readings: [trainee("rd", { project_id: null, document_id: null, status: "compared", machine_findings: ["PASSAGE-GONE"], comparison: { both: ["CMP-GONE"] }, findings: "KEPT" })],
        });
        expect(out.held_back.counts).toEqual({ training_records: 1 });
        expect(out.training.readings).toHaveLength(1);
        expect(out.training.readings[0]).toMatchObject({ machine_findings: null, comparison: null, findings: "KEPT" });
    });

    it("does not count a reading whose document was deleted when it has nothing drawn from it", async () => {
        const out = await account({
            ...base(),
            training_readings: [trainee("rd", { project_id: null, document_id: null, status: "pending", machine_findings: null, comparison: null })],
        });
        expect(out).not.toHaveProperty("held_back");
    });

    it("counts a retake whose notes are gone", async () => {
        const out = await account({
            ...base(),
            training_retakes: [trainee("rk", { source_note_ids: ["gone-note"], question: "RQ-GONE", answer: "KEPT", contrast: null })],
        });
        expect(out.held_back.counts).toEqual({ training_records: 1 });
        expect(out.training.retakes[0]).toMatchObject({ question: null, contrast: null, answer: "KEPT" });
    });

    it("counts a retake that records no notes, whose question and contrast are blanked too", async () => {
        const out = await account({
            ...base(),
            training_retakes: [trainee("rk-none", { source_note_ids: [], question: "Q", answer: "A", contrast: "C" })],
        });
        expect(out.held_back.counts).toEqual({ training_records: 1 });
        expect(out.training.retakes[0]).toMatchObject({ question: null, contrast: null, answer: "A" });
    });

    it("does not count a retake with nothing to blank, or one whose notes are readable", async () => {
        const out = await account({
            ...base(),
            ...openChat(),
            training_turn_notes: [openNote()],
            training_retakes: [
                trainee("rk-empty", { source_note_ids: ["gone-note"], question: null, answer: "A", contrast: null }),
                trainee("rk-open", { source_note_ids: ["tn"], question: "Q", answer: "A", contrast: "C" }),
            ],
        });
        expect(out).not.toHaveProperty("held_back");
        expect(out.training.retakes.find((r: Row) => r.id === "rk-open")).toMatchObject({ question: "Q", contrast: "C" });
    });

    it("counts a defense whose work review was deleted", async () => {
        const out = await account({
            ...base(),
            training_defenses: [trainee("df", { work_review_id: null, questions: ["Q-GONE"], outcome: "approved", outcome_note: "N-GONE" })],
        });
        expect(out.held_back.counts).toEqual({ training_records: 1 });
        expect(out.training.defenses[0]).toMatchObject({ questions: null, outcome_note: null, outcome: "approved" });
    });

    it("does not count a scheduled defense with no result, or one whose work review is readable", async () => {
        const out = await account({
            ...base(),
            ...openChat(),
            training_work_reviews: [openReview()],
            training_defenses: [
                trainee("df-scheduled", { work_review_id: null, questions: null, outcome: null, outcome_note: null }),
                trainee("df-open", { work_review_id: "wr", questions: ["Q"], outcome: "approved", outcome_note: "N" }),
            ],
        });
        expect(out).not.toHaveProperty("held_back");
        expect(out.training.defenses.find((r: Row) => r.id === "df-open")).toMatchObject({ questions: ["Q"], outcome_note: "N" });
    });

    it("counts a row once however many of its fields are blanked", async () => {
        const out = await account({
            ...base(),
            training_readings: [trainee("rd", { project_id: null, document_id: null, status: "compared", machine_findings: ["X"], comparison: { both: ["Y"] } })],
            training_retakes: [trainee("rk", { source_note_ids: ["gone-note"], question: "Q", answer: "A", contrast: "C" })],
            training_defenses: [trainee("df", { work_review_id: null, questions: ["Q"], outcome: "approved", outcome_note: "N" })],
        });
        expect(out.held_back.counts).toEqual({ training_records: 3 });
    });

    it("does not count such a row of an organization the holder has left", async () => {
        const out = await account(
            {
                organizations: [{ id: "gone", kind: "team" }],
                org_members: [{ org_id: "gone", user_id: "partner", role: "owner" }],
                training_readings: [trainee("rd", { org_id: "gone", project_id: null, document_id: null, status: "compared", machine_findings: ["X"], comparison: null })],
                training_retakes: [trainee("rk", { org_id: "gone", source_note_ids: ["gone-note"], question: "Q", answer: "A", contrast: "C" })],
                training_defenses: [trainee("df", { org_id: "gone", work_review_id: null, questions: ["Q"], outcome: "approved", outcome_note: "N" })],
            },
            null,
        );
        expect(out).not.toHaveProperty("held_back");
    });
});

describe("a review the holder cannot open is counted once, with its chats and cells", () => {
    const refused = (): Record<string, Row[]> => ({
        ...base(),
        tabular_reviews: [{ id: "r", user_id: holder, org_id: "org", project_id: "p-walled" }],
        tabular_review_chats: [
            { id: "tc1", review_id: "r", user_id: holder, title: "T1", created_at: at },
            { id: "tc2", review_id: "r", user_id: holder, title: "T2", created_at: at },
        ],
    });

    it("the account download counts the review only", async () => {
        expect((await account(refused())).held_back.counts).toEqual({ table_reviews: 1 });
    });

    it("the reviews-only download counts the review only", async () => {
        const out = (await buildUserTabularReviewsExport(makeExportDb(refused()).db, holder, email, "org")) as any;
        expect(out.held_back.counts).toEqual({ table_reviews: 1 });
    });

    it("the chats-only download, which carries no reviews, counts the chats", async () => {
        const out = (await buildUserChatsExport(makeExportDb(refused()).db, holder, email, "org")) as any;
        expect(out.held_back.counts).toEqual({ table_review_chats: 2 });
    });

    it("the account download counts a refused shared review once, not its chats", async () => {
        const tables = {
            ...base(),
            tabular_reviews: [{ id: "r-shared", user_id: "partner", org_id: "org", project_id: "p-walled", archived_at: null }],
            tabular_review_access_grants: [{ id: "g", email, tabular_review_id: "r-shared" }],
            tabular_review_chats: [{ id: "tc", review_id: "r-shared", user_id: holder, title: "T", created_at: at }],
        };
        expect((await account(tables)).held_back.counts).toEqual({ shared_table_reviews: 1 });
    });

    it("a chat of a review that is not carried by the download is still counted", async () => {
        const tables = {
            ...base(),
            tabular_reviews: [{ id: "r-other", user_id: "partner", org_id: "org", project_id: "p-walled", archived_at: null }],
            tabular_review_chats: [{ id: "tc", review_id: "r-other", user_id: holder, title: "T", created_at: at }],
        };
        expect((await account(tables)).held_back.counts).toEqual({ table_review_chats: 1 });
    });
});

describe("account export: another organization's drafts are not counted", () => {
    it("a draft suggestion and its event of another organization whose project is closed", async () => {
        const out = await account(
            {
                organizations: [{ id: "org-current", kind: "team" }, { id: "org-other", kind: "team" }],
                org_members: [{ org_id: "org-current", user_id: holder, role: "member" }],
                obligation_rule_suggestions: [{ id: "s1", created_by: holder, org_id: "org-other", project_id: "project-closed", matter_id: null, created_at: at }],
                obligation_rule_suggestion_events: [{ id: "se1", suggestion_id: "s1", actor_user_id: holder, matter_id: null, created_at: at }],
            },
            "org-current",
        );
        expect(out.obligation_rule_suggestions).toEqual([]);
        expect(out).not.toHaveProperty("held_back");
    });
});
