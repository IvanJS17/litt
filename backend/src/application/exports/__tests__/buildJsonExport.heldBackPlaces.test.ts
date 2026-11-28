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

// Every place that leaves something out because the holder cannot open it
// today adds to the notice, under its own kind and with the right number, and
// the notice carries nothing else.
const holder = "associate";
const email = "associate@example.test";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";
const at = "2026-01-02T00:00:00Z";

function base(): Record<string, Row[]> {
    return {
        organizations: [{ id: "org", kind: "team" }],
        org_members: [
            { org_id: "org", user_id: holder, role: "member" },
            { org_id: "org", user_id: "partner", role: "owner" },
        ],
        projects: [{ id: "p-walled", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null }],
        project_org_access_overrides: [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }],
        documents: [{ id: DOC_WALLED, user_id: "partner", project_id: "p-walled", org_id: "org", archived_at: null }],
    };
}
const answerFromWalled = (chat: string): Row[] => [
    { id: `${chat}-u`, chat_id: chat, role: "user", content: "TYPED", files: null, created_at: "2026-01-01T00:00:01Z" },
    { id: `${chat}-a`, chat_id: chat, role: "assistant", content: [{ type: "content", text: "ANSWER-HELD-BACK" }], citations: [{ document_id: DOC_WALLED }], created_at: "2026-01-01T00:00:02Z" },
];
const trainee = (id: string, over: Row = {}): Row => ({ id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null, created_at: at, ...over });
const chatOf = (id: string): Row => ({ id, user_id: holder, org_id: "org", project_id: null, title: "T", created_at: at });
const account = async (tables: Record<string, Row[]>, orgId: string | null = "org") =>
    (await buildUserAccountExport(makeExportDb(tables).db, holder, email, orgId)) as any;

describe("account export: each place that leaves something out is counted under its own kind", () => {
    it("a table review of a project the holder cannot open", async () => {
        const out = await account({ ...base(), tabular_reviews: [{ id: "r", user_id: holder, org_id: "org", project_id: "p-walled", title: "R-HELD-BACK" }] });
        expect(out.held_back.counts).toEqual({ table_reviews: 1 });
        expect(JSON.stringify(out)).not.toContain("R-HELD-BACK");
    });

    it("a conversation of a project the holder cannot open, left out whole", async () => {
        const out = await account({ ...base(), chats: [{ ...chatOf("c"), project_id: "p-walled", title: "C-HELD-BACK" }], chat_messages: answerFromWalled("c") });
        expect(out.held_back.counts).toEqual({ conversations: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    it("the chats of a review the holder cannot open", async () => {
        const tables = {
            ...base(),
            tabular_reviews: [{ id: "r", user_id: holder, org_id: "org", project_id: "p-walled" }],
            tabular_review_chats: [{ id: "tc", review_id: "r", user_id: holder, title: "TC-HELD-BACK", created_at: at }],
        };
        expect((await account(tables)).held_back.counts).toEqual({ table_reviews: 1 });
        expect((await buildUserChatsExport(makeExportDb(tables).db, holder, email, "org") as any).held_back.counts).toEqual({ table_review_chats: 1 });
    });

    it("a project and a workflow of an organization the holder is no longer in", async () => {
        const tables = {
            organizations: [{ id: "org", kind: "team" }],
            org_members: [{ org_id: "org", user_id: "partner", role: "owner" }],
            projects: [{ id: "p-mine", user_id: holder, org_id: "org", visibility: "private", archived_at: null, name: "P-HELD-BACK" }],
            workflows: [{ id: "w-mine", user_id: holder, org_id: "org", archived_at: null, title: "W-HELD-BACK" }],
        };
        const out = await account(tables);
        expect(out.held_back.counts).toEqual({ projects: 1, workflows: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    it("a project and a table review shared with the holder through a grant that does not open", async () => {
        const out = await account({
            ...base(),
            projects: [...base().projects, { id: "p-shared", user_id: "partner", org_id: "org", visibility: "private", archived_at: null, name: "SHARED-HELD-BACK" }],
            project_access_grants: [{ id: "g1", email, project_id: "p-shared" }],
            tabular_reviews: [{ id: "r-shared", user_id: "partner", org_id: "org", project_id: "p-walled", archived_at: null, title: "SREV-HELD-BACK" }],
            tabular_review_access_grants: [{ id: "g2", email, tabular_review_id: "r-shared" }],
        });
        expect(out.held_back.counts).toEqual({ shared_projects: 1, shared_table_reviews: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    describe("training records", () => {
        const withAnswerFromWalled = (): Record<string, Row[]> => ({
            ...base(),
            chats: [chatOf("c")],
            chat_messages: answerFromWalled("c"),
            training_turn_notes: [trainee("tn", { chat_id: "c", message_id: "c-u", attempt: "A", contrast: "CONTRAST-HELD-BACK", contrast_status: "ready" })],
        });

        it("a record made from an answer the holder can no longer read", async () => {
            const out = await account(withAnswerFromWalled());
            expect(out.held_back.counts).toEqual({ conversations: 1, training_records: 1 });
            expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
        });

        it("a reading of a document the holder can no longer open", async () => {
            const out = await account({
                ...base(),
                training_readings: [trainee("rd", { project_id: null, document_id: DOC_WALLED, status: "compared", machine_findings: ["PASSAGE-HELD-BACK"], comparison: null })],
            });
            expect(out.held_back.counts).toEqual({ training_records: 1 });
            expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
        });

        it("a defense of a work review that was held back, with that review", async () => {
            const tables = withAnswerFromWalled();
            tables.training_turn_notes = [];
            tables.training_work_reviews = [trainee("wr", { chat_id: "c", status: "ready", proposed: ["PROPOSED-HELD-BACK"] })];
            tables.training_defenses = [trainee("df", { work_review_id: "wr", questions: ["Q-HELD-BACK"], outcome: "approved", outcome_note: "N-HELD-BACK" })];
            const out = await account(tables);
            expect(out.held_back.counts).toEqual({ conversations: 1, training_records: 2 });
            expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
        });

        it("a retake built from a note that was held back, with that note", async () => {
            const tables = withAnswerFromWalled();
            tables.training_retakes = [trainee("rk", { source_note_ids: ["tn"], question: "RQ-HELD-BACK", answer: "A", contrast: "RC-HELD-BACK" })];
            const out = await account(tables);
            expect(out.held_back.counts).toEqual({ conversations: 1, training_records: 2 });
            expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
        });

        it("a record of an organization the holder has left is the firm's and is not counted (Personal export)", async () => {
            const out = await account(
                {
                    organizations: [{ id: "gone", kind: "team" }],
                    org_members: [{ org_id: "gone", user_id: "partner", role: "owner" }],
                    projects: [{ id: "p-firm", user_id: "partner", org_id: "gone", visibility: "organization", archived_at: null }],
                    training_urgency_passes: [trainee("pass", { org_id: "gone", project_id: "p-firm", reason_note: "FIRM-PASS" })],
                },
                null,
            );
            expect(out).not.toHaveProperty("held_back");
            expect(JSON.stringify(out)).not.toContain("FIRM-PASS");
        });
    });
});

describe("account export: matter work the holder can no longer open today", () => {
    const matterWorld = (): Record<string, Row[]> => ({
        organizations: [{ id: "org-current", kind: "team" }, { id: "org-other", kind: "team" }],
        org_members: [{ org_id: "org-current", user_id: holder, role: "member" }],
        workspaces: [{ id: "ws", organization_id: "org-current" }, { id: "ws-other", organization_id: "org-other" }],
        matters: [
            { id: "m-closed", project_id: "project-closed", workspace_id: "ws" },
            { id: "m-removed", project_id: "project-open", workspace_id: "ws" },
            { id: "m-foreign", project_id: "project-open", workspace_id: "ws-other" },
        ],
        matter_memberships: [
            { matter_id: "m-closed", user_id: holder, status: "active" },
            { matter_id: "m-removed", user_id: holder, status: "revoked" },
            { matter_id: "m-foreign", user_id: holder, status: "active" },
        ],
    });
    const requestsIn = (matter: string, id: string): Row => ({ id, matter_id: matter, created_by: holder, title: `REQ-${id}`, created_at: at });

    it("counts a request of a matter the holder is on and whose project is closed, and shows none of it", async () => {
        const out = await account({ ...matterWorld(), matter_requests: [requestsIn("m-closed", "r1")] }, "org-current");
        expect(out.matter_requests).toEqual([]);
        expect(out.held_back.counts).toEqual({ matter_requests: 1 });
        expect(JSON.stringify(out)).not.toContain("REQ-r1");
    });

    it("counts nothing for a matter of another organization or one the holder was removed from", async () => {
        const out = await account({ ...matterWorld(), matter_requests: [requestsIn("m-removed", "r2"), requestsIn("m-foreign", "r3")] }, "org-current");
        expect(out.matter_requests).toEqual([]);
        expect(out).not.toHaveProperty("held_back");
    });

    it("counts each kind of matter record under its own name", async () => {
        const m = { matter_id: "m-closed", created_at: at };
        const out = await account(
            {
                ...matterWorld(),
                matter_requests: [requestsIn("m-closed", "r1")],
                matter_request_events: [{ id: "e1", request_id: "r1", actor_user_id: holder, ...m }],
                matter_profile_facts: [{ id: "f1", created_by: holder, ...m }],
                matter_profile_fact_events: [{ id: "f2", actor_user_id: holder, ...m }],
                matter_radar_item_events: [{ id: "e3", actor_user_id: holder, ...m }],
                matter_obligation_rule_events: [{ id: "e4", actor_user_id: holder, ...m }],
                matter_obligation_item_events: [{ id: "e5", actor_user_id: holder, ...m }],
                matter_report_sent_events: [{ id: "e6", actor_user_id: holder, ...m }],
                obligation_rule_suggestions: [
                    { id: "s1", created_by: holder, org_id: "org-current", project_id: null, ...m },
                    { id: "s2", created_by: holder, org_id: "org-current", project_id: "project-closed", matter_id: null, created_at: at },
                ],
                obligation_rule_suggestion_events: [
                    { id: "se1", suggestion_id: "s1", actor_user_id: holder, ...m },
                    { id: "se2", suggestion_id: "s2", actor_user_id: holder, matter_id: null, created_at: at },
                ],
                obligation_rule_questions: [{ id: "q1", created_by: holder, org_id: "org-current", ...m }],
                obligation_rule_question_answers: [{ id: "a1", question_id: "q1", actor_user_id: holder, ...m }],
            },
            "org-current",
        );
        expect(out.held_back.counts).toEqual({
            matter_requests: 1,
            matter_request_events: 1,
            matter_profile_facts: 1,
            matter_profile_fact_events: 1,
            matter_radar_events: 1,
            matter_obligation_rule_events: 1,
            matter_obligation_item_events: 1,
            matter_report_sent_events: 1,
            rule_suggestions: 2,
            rule_suggestion_events: 2,
            rule_questions: 1,
            rule_answers: 1,
        });
    });
});

describe("the other downloads count the same places", () => {
    it("the table-reviews-only download counts a review of a closed project", async () => {
        const tables = { ...base(), tabular_reviews: [{ id: "r", user_id: holder, org_id: "org", project_id: "p-walled" }] };
        const out = (await buildUserTabularReviewsExport(makeExportDb(tables).db, holder, email, "org")) as any;
        expect(out.held_back.counts).toEqual({ table_reviews: 1 });
    });
});
