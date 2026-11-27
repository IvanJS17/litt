// A training world for the readers of a pupil's Word work: one Word chat whose
// only answer drew on a document, either one nobody in the world may open or
// only the open document. Synthetic data.

import { memoryDb, type Row } from "./memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ORG = id(10);
export const PUPIL = id(1);
export const MENTOR = id(2);
export const WORD_CHAT = id(20);
export const OTHER_PERSONS_DOC = id(31);
export const REVIEW = id(40);
export const NOTE_IDS = [id(50), id(51), id(52)];
export const RETAKE = id(60);
export const DEFENSE = id(61);
export const PUPIL_EMAIL = "pupil@example.test";
export const MENTOR_EMAIL = "mentor@example.test";

/** The answer read a document of a third person: neither the pupil nor the mentor may open it. */
export const WITHHELD_SOURCE: Row[] = [{ type: "doc_read", filename: "x.docx", document_id: OTHER_PERSONS_DOC }];
/** The answer read only the open document of the add-in. */
export const OPEN_DOCUMENT_ONLY: Row[] = [
    { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null },
];

export const MENTOR_ACTOR = { actorId: MENTOR, actorEmail: MENTOR_EMAIL, orgId: ORG, traineeId: PUPIL };

export function trainingWorld(source: Row[], extra: Record<string, Row[]> = {}) {
    const old = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
    return memoryDb(
        {
            training_pupils: [{ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
            user_profiles: [{ user_id: MENTOR, email: MENTOR_EMAIL }],
            documents: [{ id: OTHER_PERSONS_DOC, user_id: id(3), project_id: null, org_id: null }],
            word_chats: [{ id: WORD_CHAT, user_id: PUPIL, title: "WORD-TITLE" }],
            word_chat_messages: [
                { id: id(41), chat_id: WORD_CHAT, role: "user", files: null, citations: null, content: "typed", created_at: "2026-11-10T10:00:01Z" },
                {
                    id: id(42), chat_id: WORD_CHAT, role: "assistant", files: null, citations: null,
                    content: [...source, { type: "content", text: "ANSWER-TEXT" }], created_at: "2026-11-10T10:00:02Z",
                },
            ],
            training_work_reviews: [{
                id: REVIEW, org_id: ORG, trainee_user_id: PUPIL, chat_id: null, word_chat_id: WORD_CHAT, tabular_chat_id: null,
                status: "ready", covered_through: "2026-11-11T10:00:00Z", updated_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z",
                proposed: [{ text: "REVIEW-FINDING" }], ai_corrected: null, doubts: null, unverified: null, signals: {},
            }],
            training_defenses: [{
                id: DEFENSE, org_id: ORG, trainee_user_id: PUPIL, practice: null, work_review_id: REVIEW,
                questions: [{ kind: "base", text: "DEFENSE-QUESTION", listen_for: "x" }], questions_status: "ready",
                outcome: "approved", outcome_reason: "razonamiento_solido", outcome_note: "DEFENSE-NOTE",
                held_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z",
            }],
            training_urgency_passes: [],
            training_criteria_contrasts: [],
            training_backing_checks: [],
            // Three weak notes on one topic, old enough for a retake to be due.
            training_turn_notes: NOTE_IDS.map((noteId, index) => ({
                id: noteId, org_id: ORG, trainee_user_id: PUPIL, word_chat_id: WORD_CHAT, chat_id: null, tabular_chat_id: null,
                message_id: id(41), attempt: `ATTEMPT-TEXT-${index}`, contrast: "CONTRAST-TEXT", contrast_status: "ready", confidence: 3,
                verdict: "no_coincide", verdict_source: "contrast", foundation: null, topics: ["Topic Label"], answer_unverified: false,
                mode: null, step: null, created_at: old(index),
            })),
            training_retakes: [{
                id: RETAKE, org_id: ORG, trainee_user_id: PUPIL, topic_key: "topic label", topic_label: "Topic Label", status: "answered",
                question: "RETAKE-QUESTION", contrast: "RETAKE-CONTRAST", answer: "mine", verdict: "no_coincide",
                source_note_ids: NOTE_IDS, created_at: "2026-11-11T10:00:00Z", updated_at: "2026-11-11T10:00:00Z", answered_at: "2026-11-11T10:00:00Z",
            }],
            ...extra,
        },
        { training_can_read_learning: () => true },
    );
}
