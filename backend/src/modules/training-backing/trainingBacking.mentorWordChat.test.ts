import { describe, expect, it } from "vitest";
import {
    MENTOR_ACTOR,
    MENTOR,
    MENTOR_EMAIL,
    NOTE_IDS,
    OPEN_DOCUMENT_ONLY,
    ORG,
    PUPIL,
    WITHHELD_SOURCE,
    WORD_CHAT,
    trainingWorld,
} from "../../__tests__/helpers/wordChatTrainingWorld";
import { overrideNoteVerdict } from "../training-criterion/trainingCriterion.verdict";
import { getPupilBacking } from "./trainingBacking.service";

// The mentor reads a pupil's Word work only while they can open what its answers drew on.
const check = {
    id: "00000000-0000-4000-8000-000000000090", org_id: ORG, trainee_user_id: PUPIL, chat_id: null, word_chat_id: WORD_CHAT, tabular_chat_id: null,
    message_id: "00000000-0000-4000-8000-000000000042", status: "ready", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z",
    conclusions: [{ id: "c1", text: "CONCLUSION-TEXT", citation_ref: null, status: "unbacked", unverified_references: [], person_verified: false, person_note: null }],
};

describe("the mentor's readers of a Word work", () => {
    it("the backing checks of a work whose source is withheld are only counted", async () => {
        const result = await getPupilBacking(trainingWorld(WITHHELD_SOURCE, { training_backing_checks: [check] }).db, MENTOR_ACTOR);
        if (!result.ok) throw new Error(result.kind);
        expect(JSON.stringify(result.data)).not.toContain("CONCLUSION-TEXT");
        expect(JSON.stringify(result.data)).not.toContain("WORD-TITLE");
    });

    it("the backing checks of a work that read only the open document are shown", async () => {
        const result = await getPupilBacking(trainingWorld(OPEN_DOCUMENT_ONLY, { training_backing_checks: [check] }).db, MENTOR_ACTOR);
        if (!result.ok) throw new Error(result.kind);
        expect(JSON.stringify(result.data)).toContain("CONCLUSION-TEXT");
    });

    const verdict = (source: typeof WITHHELD_SOURCE) =>
        overrideNoteVerdict(trainingWorld(source, { audit_events: [] }).db, {
            actorId: MENTOR, actorEmail: MENTOR_EMAIL, orgId: ORG, traineeId: PUPIL, noteId: NOTE_IDS[0], body: { verdict: "coincide" },
        });

    it("the mentor cannot correct the verdict of a note of a work whose source is withheld", async () => {
        expect(await verdict(WITHHELD_SOURCE)).toMatchObject({ ok: false, kind: "not_found" });
    });

    it("the mentor corrects the verdict of a note of a work that read only the open document", async () => {
        expect((await verdict(OPEN_DOCUMENT_ONLY)).ok).toBe(true);
    });
});
