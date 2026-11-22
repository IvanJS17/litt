import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A training record is made from what a person worked on, and it follows the
// sources of that work: a record made from a chat answer the holder can no
// longer read leaves with the answer, one made from a document goes through
// the document's access, and one whose source was deleted keeps its result but
// not the text derived from what is gone.
const holder = "pupil";
const email = "pupil@example.test";
const DOC_OPEN = "00000000-0000-4000-8000-0000000000a1";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";

const row = (id: string, over: Row = {}): Row => ({
    id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: null, tabular_chat_id: null,
    created_at: "2026-01-02T00:00:00Z", ...over,
});
const note = (id: string, chat: string, message: string): Row =>
    row(id, { chat_id: chat, message_id: message, attempt: `ATTEMPT-${id}`, contrast: `CONTRAST-${id}`, contrast_status: "ready" });
const check = (id: string, chat: string, message: string): Row =>
    row(id, { chat_id: chat, message_id: message, status: "ready", conclusions: [`CONCLUSION-${id}`] });

function world(walled = true): Record<string, Row[]> {
    const message = (id: string, chat: string, role: string, at: number, over: Row = {}): Row =>
        ({ id, chat_id: chat, role, content: role === "user" ? `TYPED-${id}` : [{ type: "content", text: `ANSWER-${id}` }], files: null, citations: null, created_at: `2026-01-01T00:00:${String(10 + at)}Z`, ...over });
    const fromWalled = { citations: [{ document_id: DOC_WALLED }] };
    return {
        organizations: [{ id: "org", kind: "team" }],
        org_members: [{ org_id: "org", user_id: holder, role: "member" }, { org_id: "org", user_id: "partner", role: "owner" }],
        projects: [
            { id: "p-open", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
            { id: "p-walled", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
        ],
        project_org_access_overrides: walled ? [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }] : [],
        documents: [
            { id: DOC_OPEN, user_id: "partner", project_id: "p-open", org_id: "org", archived_at: null },
            { id: DOC_WALLED, user_id: "partner", project_id: "p-walled", org_id: "org", archived_at: null },
        ],
        chats: [
            // No matter at all: only the documents behind the answers can hold the work back.
            { id: "alone", user_id: holder, org_id: "org", project_id: null, title: "T", created_at: "2026-01-01T00:00:00Z" },
            { id: "open", user_id: holder, org_id: "org", project_id: "p-open", title: "T", created_at: "2026-01-01T00:00:01Z" },
            { id: "quiet", user_id: holder, org_id: "org", project_id: null, title: "T", created_at: "2026-01-01T00:00:02Z" },
            // Archived: not exported, but its training rows are.
            { id: "old", user_id: holder, org_id: "org", project_id: null, title: "T", archived_at: "2026-01-05T00:00:00Z", created_at: "2026-01-01T00:00:03Z" },
        ],
        chat_messages: [
            message("u1", "alone", "user", 1), message("a1", "alone", "assistant", 2),
            message("u2", "alone", "user", 3), message("a2", "alone", "assistant", 4, fromWalled),
            message("o1", "open", "user", 1), message("o2", "open", "assistant", 2, fromWalled),
            message("q1", "quiet", "user", 1), message("q2", "quiet", "assistant", 2),
            message("x1", "old", "user", 1), message("x2", "old", "assistant", 2, fromWalled),
        ],
        tabular_reviews: [{ id: "tr", user_id: holder, org_id: "org", project_id: "p-open" }],
        tabular_review_chats: [{ id: "tc", review_id: "tr", user_id: holder, created_at: "2026-01-01T00:00:00Z" }],
        tabular_review_chat_messages: [
            { id: "t1", chat_id: "tc", role: "user", content: "x", source_document_ids: [DOC_WALLED], created_at: "2026-01-01T00:00:11Z" },
            { id: "t2", chat_id: "tc", role: "assistant", content: "x", source_document_ids: [DOC_WALLED], created_at: "2026-01-01T00:00:12Z" },
        ],
        word_chats: [{ id: "word", user_id: holder }],
        training_turn_notes: [
            note("tn-1", "alone", "u1"),
            note("tn-2", "alone", "u2"),
            note("tn-open", "open", "o1"),
            note("tn-quiet", "quiet", "q1"),
            note("tn-old", "old", "x1"),
            row("tn-tab", { tabular_chat_id: "tc", message_id: "t1", attempt: "A", contrast: "CONTRAST-tn-tab", contrast_status: "ready" }),
            row("tn-word", { word_chat_id: "word", message_id: "w1", attempt: "A", contrast: "CONTRAST-tn-word", contrast_status: "ready" }),
        ],
        training_work_reviews: [
            row("wr-alone", { chat_id: "alone", status: "ready", proposed: ["PROPOSED-wr-alone"] }),
            row("wr-quiet", { chat_id: "quiet", status: "ready", proposed: ["PROPOSED-wr-quiet"] }),
        ],
        training_backing_checks: [
            check("bk-1", "alone", "a1"), check("bk-2", "alone", "a2"), check("bk-open", "open", "o2"), check("bk-quiet", "quiet", "q2"),
        ],
        training_criteria_contrasts: [
            row("cc-1", { chat_id: "alone", message_id: "a1", briefs: ["BRIEF-cc-1"] }),
            row("cc-2", { chat_id: "alone", message_id: "a2", briefs: ["BRIEF-cc-2"] }),
        ],
    };
}
const ids = (rows: Row[]) => rows.map((r) => r.id as string).sort();
const run = async (tables: Record<string, Row[]>, orgId: string | null = "org") =>
    (await buildUserAccountExport(makeExportDb(tables).db, holder, email, orgId)) as any;

describe("account export: training records follow the sources of the answer they came from", () => {
    it("leaves out what was derived from an answer the holder can no longer read", async () => {
        const t = (await run(world())).training;
        // Turn 1's answer is readable; turn 2's answer was drawn from a walled document.
        expect(ids(t.turn_notes)).toEqual(["tn-1", "tn-quiet", "tn-word"]);
        expect(ids(t.backing_checks)).toEqual(["bk-1", "bk-quiet"]);
        expect(ids(t.criteria_contrasts)).toEqual(["cc-1"]);
        // A review records only the chat: it stays only if every answer of the chat is readable.
        expect(ids(t.work_reviews)).toEqual(["wr-quiet"]);
        expect(JSON.stringify(t)).not.toMatch(/(CONTRAST|CONCLUSION|BRIEF|PROPOSED)-(tn-2|tn-open|tn-old|tn-tab|bk-2|bk-open|cc-2|wr-alone)/);
    });

    it("judges the same way in the Personal export", async () => {
        const t = (await run(world(), null)).training;
        expect(ids(t.turn_notes)).toEqual(["tn-1", "tn-quiet", "tn-word"]);
    });

    it("keeps every record for a holder who can open every source", async () => {
        const t = (await run(world(false))).training;
        expect(ids(t.turn_notes)).toEqual(["tn-1", "tn-2", "tn-old", "tn-open", "tn-quiet", "tn-tab", "tn-word"]);
        expect(ids(t.backing_checks)).toEqual(["bk-1", "bk-2", "bk-open", "bk-quiet"]);
        expect(ids(t.criteria_contrasts)).toEqual(["cc-1", "cc-2"]);
        expect(ids(t.work_reviews)).toEqual(["wr-alone", "wr-quiet"]);
    });
});

describe("account export: training records made from a document or with a source that is gone", () => {
    const reading = (id: string, over: Row): Row => row(id, { project_id: "p-open", status: "compared", findings: `FINDINGS-${id}`, machine_findings: [`PASSAGE-${id}`], comparison: { both: [`COMPARED-${id}`] }, ...over });
    const defense = (id: string, over: Row): Row => ({ id, org_id: "org", trainee_user_id: holder, practice: null, work_review_id: null, questions: [`QUESTION-${id}`], outcome: "approved", outcome_reason: "razonamiento_solido", outcome_note: `NOTE-${id}`, held_at: "2026-01-04T00:00:00Z", created_at: "2026-01-04T00:00:00Z", ...over });
    const retake = (id: string, over: Row): Row => ({ id, org_id: "org", trainee_user_id: holder, topic_key: "t", topic_label: "Topic", status: "answered", question: `RQ-${id}`, answer: `RA-${id}`, contrast: `RC-${id}`, verdict: "coincide", source_note_ids: [], created_at: "2026-01-08T00:00:00Z", ...over });

    function withRecords(): Record<string, Row[]> {
        const t = world();
        t.training_readings = [
            reading("rd-open", { document_id: DOC_OPEN }),
            reading("rd-walled", { document_id: DOC_WALLED, project_id: null }),
            reading("rd-nomatter", { document_id: DOC_OPEN, project_id: null }),
            reading("rd-deleted", { document_id: null }),
            reading("rd-deleted-matter", { document_id: null, project_id: null }),
        ];
        t.training_work_reviews = [row("wr-quiet", { chat_id: "quiet", status: "ready", proposed: ["P"] })];
        t.training_defenses = [
            defense("df-review", { work_review_id: "wr-quiet" }),
            defense("df-deleted", { work_review_id: null, practice: "civil" }),
        ];
        t.training_retakes = [
            retake("rk-kept", { source_note_ids: ["tn-1", "tn-quiet"] }),
            retake("rk-gone", { source_note_ids: ["tn-1", "tn-deleted"] }),
            retake("rk-none", { source_note_ids: [] }),
        ];
        return t;
    }
    const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.id as string, r]));

    it("sends a reading of a document through that document's access, and withholds the passages of one whose document is gone", async () => {
        const readings = byId((await run(withRecords())).training.readings);
        expect(Object.keys(readings).sort()).toEqual(["rd-deleted", "rd-deleted-matter", "rd-nomatter", "rd-open"].sort());
        expect(readings["rd-open"]).toMatchObject({ machine_findings: ["PASSAGE-rd-open"], comparison: { both: ["COMPARED-rd-open"] } });
        expect(readings["rd-nomatter"].machine_findings).toEqual(["PASSAGE-rd-nomatter"]);
        for (const id of ["rd-deleted", "rd-deleted-matter"])
            expect(readings[id]).toMatchObject({ machine_findings: null, comparison: null, findings: `FINDINGS-${id}`, status: "compared" });
    });

    it("withholds the questions and note of a defense that records no work review, and keeps its result", async () => {
        const defenses = byId((await run(withRecords())).training.defenses);
        expect(defenses["df-review"]).toMatchObject({ questions: ["QUESTION-df-review"], outcome_note: "NOTE-df-review" });
        expect(defenses["df-deleted"]).toMatchObject({ questions: null, outcome_note: null, outcome: "approved", outcome_reason: "razonamiento_solido", practice: "civil" });
    });

    it("withholds the question and contrast of a retake whose notes are gone, and keeps its answer and result", async () => {
        const retakes = byId((await run(withRecords())).training.retakes);
        expect(retakes["rk-kept"]).toMatchObject({ question: "RQ-rk-kept", contrast: "RC-rk-kept" });
        for (const id of ["rk-gone", "rk-none"])
            expect(retakes[id]).toMatchObject({ question: null, contrast: null, answer: `RA-${id}`, verdict: "coincide" });
    });
});
