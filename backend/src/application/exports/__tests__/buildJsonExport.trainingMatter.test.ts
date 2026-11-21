import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// Work a pupil did inside a matter carries the matter's confidentiality: once
// the holder can no longer open the matter, the learning rows made from it are
// not exported, as the matter's chats, documents and requests are not.
const holder = "pupil";
const email = "pupil@example.test";
const project = (id: string): Row => ({
    id, user_id: "partner", org_id: "org", visibility: "organization", archived_at: null,
});
const note = (id: string, over: Row): Row => ({
    id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null,
    message_id: `m-${id}`, attempt: `ATTEMPT-${id}`, contrast: `CONTRAST-${id}`, contrast_status: "ready",
    created_at: "2026-01-01T00:00:00Z", ...over,
});
const review = (id: string, over: Row): Row => ({
    id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null,
    status: "ready", proposed: [`PROPOSED-${id}`], created_at: "2026-01-02T00:00:00Z", ...over,
});
const check = (id: string, over: Row): Row => ({
    id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null,
    message_id: `m-${id}`, status: "ready", conclusions: [`CONCLUSION-${id}`], created_at: "2026-01-03T00:00:00Z", ...over,
});

function tables(deniedFor: string | null = holder): Record<string, Row[]> {
    return {
        organizations: [{ id: "org", kind: "team" }],
        org_members: [
            { org_id: "org", user_id: holder, role: "member" },
            { org_id: "org", user_id: "partner", role: "owner" },
        ],
        projects: [project("p-denied"), project("p-open")],
        project_org_access_overrides: deniedFor
            ? [{ project_id: "p-denied", org_id: "org", user_id: deniedFor, role: "deny" }]
            : [],
        chats: [
            { id: "chat-denied", user_id: holder, org_id: "org", project_id: "p-denied" },
            { id: "chat-open", user_id: holder, org_id: "org", project_id: "p-open" },
            { id: "chat-none", user_id: holder, org_id: "org", project_id: null },
        ],
        word_chats: [{ id: "word-1", user_id: holder }],
        tabular_reviews: [
            { id: "tr-denied", user_id: holder, org_id: "org", project_id: "p-denied" },
            { id: "tr-open", user_id: holder, org_id: "org", project_id: "p-open" },
        ],
        tabular_review_chats: [
            { id: "tc-denied", review_id: "tr-denied", user_id: holder },
            { id: "tc-open", review_id: "tr-open", user_id: holder },
        ],
        training_turn_notes: [
            note("tn-denied", { chat_id: "chat-denied" }),
            note("tn-tab-denied", { tabular_chat_id: "tc-denied" }),
            note("tn-open", { chat_id: "chat-open" }),
            note("tn-none", { chat_id: "chat-none" }),
            note("tn-word", { word_chat_id: "word-1" }),
        ],
        training_work_reviews: [
            review("wr-denied", { chat_id: "chat-denied" }),
            review("wr-open", { chat_id: "chat-open" }),
        ],
        training_defenses: [
            { id: "df-denied", org_id: "org", trainee_user_id: holder, work_review_id: "wr-denied", questions: ["QUESTION-df-denied"], outcome: "approved", outcome_note: "NOTE-df-denied", created_at: "2026-01-04T00:00:00Z" },
            { id: "df-open", org_id: "org", trainee_user_id: holder, work_review_id: "wr-open", questions: ["QUESTION-df-open"], outcome: "approved", outcome_note: "NOTE-df-open", created_at: "2026-01-04T00:00:00Z" },
            { id: "df-free", org_id: "org", trainee_user_id: holder, work_review_id: null, questions: ["QUESTION-df-free"], outcome: "approved", outcome_note: "NOTE-df-free", created_at: "2026-01-04T00:00:00Z" },
        ],
        training_urgency_passes: [
            { id: "up-denied", org_id: "org", trainee_user_id: holder, project_id: "p-denied", reason_note: "PASS-up-denied", created_at: "2026-01-05T00:00:00Z" },
            { id: "up-open", org_id: "org", trainee_user_id: holder, project_id: "p-open", reason_note: "PASS-up-open", created_at: "2026-01-05T00:00:00Z" },
        ],
        training_backing_checks: [
            check("bk-denied", { chat_id: "chat-denied" }),
            check("bk-open", { chat_id: "chat-open" }),
            check("bk-none", { chat_id: "chat-none" }),
        ],
        training_review_audits: [
            { id: "au-denied", org_id: "org", trainee_user_id: holder, tabular_review_id: "tr-denied", lint: ["LINT-au-denied"], created_at: "2026-01-06T00:00:00Z" },
            { id: "au-open", org_id: "org", trainee_user_id: holder, tabular_review_id: "tr-open", lint: ["LINT-au-open"], created_at: "2026-01-06T00:00:00Z" },
        ],
        training_readings: [
            { id: "rd-denied", org_id: "org", trainee_user_id: holder, project_id: "p-denied", document_id: "doc-1", machine_findings: ["PASSAGE-rd-denied"], created_at: "2026-01-07T00:00:00Z" },
            { id: "rd-open", org_id: "org", trainee_user_id: holder, project_id: "p-open", document_id: "doc-2", machine_findings: ["PASSAGE-rd-open"], created_at: "2026-01-07T00:00:00Z" },
            { id: "rd-free", org_id: "org", trainee_user_id: holder, project_id: null, document_id: null, machine_findings: ["PASSAGE-rd-free"], created_at: "2026-01-07T00:00:00Z" },
        ],
        training_retakes: [
            { id: "rk-denied", org_id: "org", trainee_user_id: holder, source_note_ids: ["tn-denied", "tn-open"], question: "Q-rk-denied", created_at: "2026-01-08T00:00:00Z" },
            { id: "rk-open", org_id: "org", trainee_user_id: holder, source_note_ids: ["tn-open", "tn-none"], question: "Q-rk-open", created_at: "2026-01-08T00:00:00Z" },
        ],
        training_criteria_contrasts: [
            { id: "cc-denied", org_id: "org", trainee_user_id: holder, chat_id: "chat-denied", briefs: ["BRIEF-cc-denied"], created_at: "2026-01-09T00:00:00Z" },
            { id: "cc-open", org_id: "org", trainee_user_id: holder, chat_id: "chat-open", briefs: ["BRIEF-cc-open"], created_at: "2026-01-09T00:00:00Z" },
        ],
    };
}

const ids = (rows: Row[]) => rows.map((row) => row.id as string).sort();
const want = (...list: string[]) => [...list].sort();

describe("account export: training rows of a matter the holder can no longer open", () => {
    it("withholds training rows of a matter the holder can no longer open", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, holder, email, "org")) as any;
        const t = out.training;
        expect(ids(t.turn_notes)).toEqual(want("tn-open", "tn-none", "tn-word"));
        expect(ids(t.work_reviews)).toEqual(want("wr-open"));
        expect(ids(t.urgency_passes)).toEqual(want("up-open"));
        expect(ids(t.backing_checks)).toEqual(want("bk-open", "bk-none"));
        expect(ids(t.review_audits)).toEqual(want("au-open"));
        expect(ids(t.readings)).toEqual(want("rd-open", "rd-free"));
        expect(ids(t.criteria_contrasts)).toEqual(want("cc-open"));
        // A retake built from a withheld note is withheld with it.
        expect(ids(t.retakes)).toEqual(want("rk-open"));
        // A defense of a withheld work review loses the text derived from it.
        const defenses = Object.fromEntries(t.defenses.map((row: Row) => [row.id, row]));
        expect(defenses["df-denied"]).toMatchObject({ questions: null, outcome_note: null });
        expect(defenses["df-open"]).toMatchObject({ questions: ["QUESTION-df-open"], outcome_note: "NOTE-df-open" });
        expect(defenses["df-free"]).toMatchObject({ questions: ["QUESTION-df-free"], outcome_note: "NOTE-df-free" });
        // None of the text made from the matter is anywhere in the training section.
        expect(JSON.stringify(t)).not.toMatch(/(ATTEMPT|CONTRAST|PROPOSED|CONCLUSION|PASS|LINT|PASSAGE|BRIEF|QUESTION|NOTE|Q)-[a-z-]*denied/);
    });

    it("applies the same rule to the Personal export", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, holder, email, null)) as any;
        expect(ids(out.training.readings)).toEqual(want("rd-open", "rd-free"));
        expect(ids(out.training.urgency_passes)).toEqual(want("up-open"));
    });

    it("keeps everything for a holder who can still open the matter", async () => {
        const { db } = makeExportDb(tables(null));
        const out = (await buildUserAccountExport(db, holder, email, "org")) as any;
        const t = out.training;
        expect(ids(t.turn_notes)).toEqual(want("tn-denied", "tn-tab-denied", "tn-open", "tn-none", "tn-word"));
        expect(ids(t.work_reviews)).toEqual(want("wr-denied", "wr-open"));
        expect(ids(t.urgency_passes)).toEqual(want("up-denied", "up-open"));
        expect(ids(t.backing_checks)).toEqual(want("bk-denied", "bk-open", "bk-none"));
        expect(ids(t.review_audits)).toEqual(want("au-denied", "au-open"));
        expect(ids(t.readings)).toEqual(want("rd-denied", "rd-open", "rd-free"));
        expect(ids(t.criteria_contrasts)).toEqual(want("cc-denied", "cc-open"));
        expect(ids(t.retakes)).toEqual(want("rk-denied", "rk-open"));
        expect(t.defenses.find((row: Row) => row.id === "df-denied")).toMatchObject({ questions: ["QUESTION-df-denied"] });
    });

    it("keeps everything for the firm's owner", async () => {
        const data = tables();
        for (const rows of Object.values(data)) for (const row of rows) if (row.trainee_user_id === holder) row.trainee_user_id = "partner";
        for (const row of data.chats) row.user_id = "partner";
        const { db } = makeExportDb(data);
        const out = (await buildUserAccountExport(db, "partner", "partner@example.test", "org")) as any;
        expect(ids(out.training.readings)).toEqual(want("rd-denied", "rd-open", "rd-free"));
        expect(ids(out.training.urgency_passes)).toEqual(want("up-denied", "up-open"));
    });

    it("withholds the rows of a private matter the holder was removed from", async () => {
        const data = tables(null);
        data.workspaces = [{ id: "ws", organization_id: "org" }];
        data.matters = [{ id: "matter-1", project_id: "p-denied", workspace_id: "ws", visibility: "private" }];
        data.matter_memberships = [{ matter_id: "matter-1", user_id: holder, status: "revoked" }];
        const { db } = makeExportDb(data);
        const out = (await buildUserAccountExport(db, holder, email, "org")) as any;
        expect(ids(out.training.readings)).toEqual(want("rd-open", "rd-free"));
        expect(ids(out.training.work_reviews)).toEqual(want("wr-open"));

        data.matter_memberships = [{ matter_id: "matter-1", user_id: holder, status: "active" }];
        const back = (await buildUserAccountExport(db, holder, email, "org")) as any;
        expect(ids(back.training.readings)).toEqual(want("rd-denied", "rd-open", "rd-free"));
    });
});
