import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

const userId = "holder";
const other = "colleague";

function tables(): Record<string, Row[]> {
    return {
        organizations: [
            { id: "org-a", kind: "team" },
            { id: "org-b", kind: "team" },
        ],
        org_members: [
            { org_id: "org-a", user_id: userId, role: "member" },
            { org_id: "org-b", user_id: userId, role: "member" },
        ],
        training_mentors: [
            { org_id: "org-a", user_id: userId, designated_by: "boss" },
            { org_id: "org-a", user_id: other, designated_by: "boss" },
        ],
        training_pupils: [
            { org_id: "org-a", trainee_user_id: userId, mentor_user_id: other },
            { org_id: "org-b", trainee_user_id: userId, mentor_user_id: other },
            // Somebody else's pupil: not the holder's data.
            { org_id: "org-a", trainee_user_id: other, mentor_user_id: userId },
        ],
        training_stages: [
            { org_id: "org-a", trainee_user_id: userId, practice: "laboral", stage: "pasante" },
            { org_id: "org-b", trainee_user_id: userId, practice: null, stage: "junior" },
            { org_id: "org-a", trainee_user_id: other, practice: null, stage: "pasante" },
        ],
        training_turn_notes: [
            {
                id: "n1", org_id: "org-a", trainee_user_id: userId, chat_id: "c1", word_chat_id: null,
                tabular_chat_id: null, message_id: "m1", attempt: "mi planteamiento", contrast: "Coincide",
                contrast_status: "ready", created_at: "2026-01-01T00:00:00Z",
            },
            {
                id: "n2", org_id: "org-b", trainee_user_id: userId, chat_id: null, word_chat_id: "w1",
                tabular_chat_id: null, message_id: "m2", attempt: "otro", contrast: null,
                contrast_status: "failed", created_at: "2026-01-02T00:00:00Z",
            },
            // Somebody else's note: not the holder's data.
            {
                id: "n3", org_id: "org-a", trainee_user_id: other, chat_id: "c2", word_chat_id: null,
                tabular_chat_id: null, message_id: "m3", attempt: "ajeno", contrast: null,
                contrast_status: "pending", created_at: "2026-01-03T00:00:00Z",
            },
        ],
        training_work_reviews: [
            {
                id: "r1", org_id: "org-a", trainee_user_id: userId, chat_id: "c1", word_chat_id: null,
                tabular_chat_id: null, status: "ready", covered_through: "2026-01-01T00:00:00Z",
                proposed: [{ source: "attempt", text: "propuse" }], ai_corrected: [], doubts: [], unverified: [],
                signals: {}, model_provider: "openai", model: "gpt", credential_ref: "user:mentor:v1",
                generated_by: other, generated_at: "2026-01-02T00:00:00Z", reviewed_at: null, reviewed_by: null,
                created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
            },
            // Somebody else's review: not the holder's data.
            {
                id: "r2", org_id: "org-a", trainee_user_id: other, chat_id: "c2", status: "pending",
                created_at: "2026-01-03T00:00:00Z",
            },
        ],
        training_defenses: [
            {
                id: "d1", org_id: "org-a", trainee_user_id: userId, practice: "laboral", work_review_id: "r1",
                questions_status: "ready", questions: [{ kind: "base", text: "¿por qué?", listen_for: "x" }],
                model_provider: "openai", model: "gpt", credential_ref: "user:mentor:v1", generated_by: other,
                outcome: "approved", outcome_reason: "razonamiento_solido", outcome_note: "bien", held_at: "2026-01-04T00:00:00Z", recorded_by: other,
                created_at: "2026-01-03T00:00:00Z",
            },
            // Scheduled, not held yet: its questions stay out, as in the app.
            {
                id: "d2", org_id: "org-b", trainee_user_id: userId, practice: null, work_review_id: null,
                questions_status: "ready", questions: [{ kind: "cambio_de_hechos", text: "¿y si?", listen_for: "y" }],
                outcome: null, outcome_reason: null, outcome_note: null, held_at: null, created_at: "2026-01-05T00:00:00Z",
            },
            { id: "d3", org_id: "org-a", trainee_user_id: other, questions_status: "none", created_at: "2026-01-06T00:00:00Z" },
        ],
        training_urgency_passes: [
            {
                id: "p1", org_id: "org-b", trainee_user_id: userId, project_id: "proj-1", granted_by: other,
                starts_at: "2026-01-06T00:00:00Z", expires_at: "2026-01-06T08:00:00Z", reason_code: "plazo",
                reason_note: "vence hoy", revoked_at: null, revoked_by: null, created_at: "2026-01-06T00:00:00Z",
            },
            { id: "p2", org_id: "org-a", trainee_user_id: other, project_id: "proj-2", created_at: "2026-01-07T00:00:00Z" },
        ],
        training_readings: [
            {
                id: "g1", org_id: "org-b", trainee_user_id: userId, project_id: "proj-1", document_id: "doc-1",
                version_id: "ver-1", swapped: false, status: "compared", findings: "Falta la fecha del pagaré.",
                submitted_at: "2026-01-08T00:00:00Z",
                machine_findings: [{ text: "No hay fecha", excerpt: "sin fecha de vencimiento" }],
                comparison: { person_items: ["Falta la fecha del pagaré."], both: [{ person: 0, machine: 0 }], only_person: [], only_machine: [], discarded: 0 },
                model_provider: "openai", model: "gpt", credential_ref: "user:holder:v1",
                created_at: "2026-01-08T00:00:00Z", updated_at: "2026-01-08T01:00:00Z",
            },
            // Somebody else's reading: not the holder's data.
            { id: "g2", org_id: "org-a", trainee_user_id: other, status: "assigned", created_at: "2026-01-09T00:00:00Z" },
        ],
    };
}

describe("account export: the holder's training", () => {
    it("Personal's export carries it for every organization, only the holder's own", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.mentor_designations.map((r: Row) => r.org_id)).toEqual(["org-a"]);
        expect(out.training.as_pupil.map((r: Row) => [r.org_id, r.mentor_user_id])).toEqual([
            ["org-a", other],
            ["org-b", other],
        ]);
        expect(out.training.stages.map((r: Row) => [r.org_id, r.practice, r.stage])).toEqual([
            ["org-a", "laboral", "pasante"],
            ["org-b", null, "junior"],
        ]);
        expect(out.training.turn_notes).toEqual([
            expect.objectContaining({
                id: "n1", org_id: "org-a", chat_id: "c1", message_id: "m1",
                attempt: "mi planteamiento", contrast: "Coincide", contrast_status: "ready",
                created_at: "2026-01-01T00:00:00Z",
            }),
            expect.objectContaining({
                id: "n2", org_id: "org-b", word_chat_id: "w1", message_id: "m2",
                attempt: "otro", contrast: null, contrast_status: "failed",
            }),
        ]);
    });

    it("carries the supervision kept about the holder, without other people's ids or keys", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.work_reviews).toEqual([
            expect.objectContaining({
                id: "r1", org_id: "org-a", chat_id: "c1", status: "ready",
                proposed: [{ source: "attempt", text: "propuse" }], model_provider: "openai", model: "gpt",
            }),
        ]);
        expect(out.training.defenses.map((r: Row) => [r.id, r.outcome, r.questions])).toEqual([
            ["d1", "approved", [{ kind: "base", text: "¿por qué?", listen_for: "x" }]],
            ["d2", null, null],
        ]);
        // The whole outcome the holder sees in the app: result, reason and note.
        expect(out.training.defenses.map((r: Row) => [r.outcome, r.outcome_reason, r.outcome_note])).toEqual([
            ["approved", "razonamiento_solido", "bien"],
            [null, null, null],
        ]);
        expect(out.training.urgency_passes).toEqual([
            expect.objectContaining({ id: "p1", project_id: "proj-1", reason_code: "plazo", reason_note: "vence hoy" }),
        ]);
        const kept = [...out.training.work_reviews, ...out.training.defenses, ...out.training.urgency_passes];
        for (const row of kept) {
            for (const key of ["trainee_user_id", "credential_ref", "generated_by", "reviewed_by", "recorded_by", "granted_by", "revoked_by"])
                expect(row, key).not.toHaveProperty(key);
        }
    });

    it("an organization's export carries only that organization's", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", "org-b")) as any;
        expect(out.training.mentor_designations).toEqual([]);
        expect(out.training.as_pupil.map((r: Row) => r.org_id)).toEqual(["org-b"]);
        expect(out.training.stages.map((r: Row) => r.org_id)).toEqual(["org-b"]);
        expect(out.training.turn_notes.map((r: Row) => r.id)).toEqual(["n2"]);
        expect(out.training.work_reviews).toEqual([]);
        expect(out.training.defenses.map((r: Row) => r.id)).toEqual(["d2"]);
        expect(out.training.urgency_passes.map((r: Row) => r.id)).toEqual(["p1"]);
    });

    it("carries the holder's full readings, with no title, key or other person", async () => {
        const { db } = makeExportDb(tables());
        const out = (await buildUserAccountExport(db, userId, "h@example.test", null)) as any;
        expect(out.training.readings).toEqual([
            expect.objectContaining({
                id: "g1", org_id: "org-b", status: "compared", findings: "Falta la fecha del pagaré.",
                machine_findings: [{ text: "No hay fecha", excerpt: "sin fecha de vencimiento" }],
            }),
        ]);
        for (const key of ["trainee_user_id", "credential_ref", "filename", "title"])
            expect(out.training.readings[0], key).not.toHaveProperty(key);
        const scoped = (await buildUserAccountExport(db, userId, "h@example.test", "org-a")) as any;
        expect(scoped.training.readings).toEqual([]);
    });
});
