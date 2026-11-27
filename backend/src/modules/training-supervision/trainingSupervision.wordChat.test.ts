import { describe, expect, it } from "vitest";
import {
    MENTOR,
    MENTOR_ACTOR,
    OTHER_PERSONS_DOC,
    OPEN_DOCUMENT_ONLY,
    PUPIL,
    PUPIL_EMAIL,
    REVIEW,
    WORD_CHAT,
    WITHHELD_SOURCE,
    trainingWorld,
} from "../../__tests__/helpers/wordChatTrainingWorld";
import { createDefense, listDefenses } from "./trainingSupervision.defenses";
import { listPupilWorks, markWorkReviewed } from "./trainingSupervision.reviews";
import { getMySupervision } from "./trainingSupervision.service";
import { projectLens } from "./trainingSupervision.lens";
import { loadPromotionLayer3 } from "./trainingSupervision.promotionEvidence";

// A work made from a Word chat is shown only while the reader can open what
// the answers of that chat drew on.

async function pupilView(source: typeof WITHHELD_SOURCE) {
    const result = await getMySupervision(trainingWorld(source).db, { userId: PUPIL, userEmail: PUPIL_EMAIL, orgId: "00000000-0000-4000-8000-000000000010" } as never);
    if (!result.ok) throw new Error(result.kind);
    return JSON.stringify(result.data);
}

describe("supervision readers and a Word chat's sources", () => {
    it("the pupil's own list leaves out the review and blanks the defense of a work whose source is withheld", async () => {
        const text = await pupilView(WITHHELD_SOURCE);
        expect(text).not.toContain("REVIEW-FINDING");
        expect(text).not.toContain("DEFENSE-QUESTION");
        expect(text).not.toContain("DEFENSE-NOTE");
    });

    it("the pupil's own list keeps them when the answer read only the open document", async () => {
        const text = await pupilView(OPEN_DOCUMENT_ONLY);
        expect(text).toContain("REVIEW-FINDING");
        expect(text).toContain("DEFENSE-QUESTION");
        expect(text).toContain("DEFENSE-NOTE");
    });

    it("the mentor's defenses come back without questions or note when the source is withheld", async () => {
        const result = await listDefenses(trainingWorld(WITHHELD_SOURCE).db, MENTOR_ACTOR);
        if (!result.ok) throw new Error(result.kind);
        const text = JSON.stringify(result.data);
        expect(text).not.toContain("DEFENSE-QUESTION");
        expect(text).not.toContain("DEFENSE-NOTE");
        expect(result.data.defenses).toHaveLength(1);
    });

    it("the mentor's defenses keep them when the answer read only the open document", async () => {
        const result = await listDefenses(trainingWorld(OPEN_DOCUMENT_ONLY).db, MENTOR_ACTOR);
        if (!result.ok) throw new Error(result.kind);
        const text = JSON.stringify(result.data);
        expect(text).toContain("DEFENSE-QUESTION");
        expect(text).toContain("DEFENSE-NOTE");
    });

    it("the mentor's list of works hides the work whose source is withheld and shows the other", async () => {
        const hidden = await listPupilWorks(trainingWorld(WITHHELD_SOURCE).db, MENTOR_ACTOR as never);
        if (!hidden.ok) throw new Error(hidden.kind);
        expect(JSON.stringify(hidden.data)).not.toContain("REVIEW-FINDING");
        expect(JSON.stringify(hidden.data)).not.toContain("WORD-TITLE");
        const shown = await listPupilWorks(trainingWorld(OPEN_DOCUMENT_ONLY).db, MENTOR_ACTOR as never);
        if (!shown.ok) throw new Error(shown.kind);
        expect(JSON.stringify(shown.data)).toContain("WORD-TITLE");
    });

    it("a lookup of the chat that fails refuses instead of showing", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY);
        world.failNext("word_chat_messages", "select", { message: "unavailable" });
        const result = await listDefenses(world.db, MENTOR_ACTOR).catch((error: unknown) => error);
        const text = JSON.stringify(result instanceof Error ? {} : result);
        expect(text).not.toContain("DEFENSE-QUESTION");
        expect(text).not.toContain("DEFENSE-NOTE");
    });

    it("the promotion evidence counts the turns of a work whose source is withheld as not readable", async () => {
        const read = async (source: typeof WITHHELD_SOURCE) => {
            const { db } = trainingWorld(source);
            const result = await loadPromotionLayer3(db, MENTOR_ACTOR, projectLens(db, MENTOR_ACTOR));
            if (!result.ok) throw new Error(result.kind);
            return result.data;
        };
        const withheld = await read(WITHHELD_SOURCE);
        expect(withheld.turns).toHaveLength(0);
        expect(withheld.without_access.turns).toBe(3);
        const open = await read(OPEN_DOCUMENT_ONLY);
        expect(open.turns).toHaveLength(3);
        expect(open.without_access.turns).toBe(0);
    });

    it("a mentor acts on a review of a work whose source is withheld only as on a missing one", async () => {
        const target = { ...MENTOR_ACTOR, surface: "word", chatId: WORD_CHAT } as never;
        const withheld = await markWorkReviewed(trainingWorld(WITHHELD_SOURCE, { audit_events: [] }).db, target);
        expect(withheld).toMatchObject({ ok: false, kind: "not_found" });
        const open = await markWorkReviewed(trainingWorld(OPEN_DOCUMENT_ONLY, { audit_events: [] }).db, target);
        expect(open.ok).toBe(true);
    });

    it("a defense on a review of a work whose source is withheld cannot be opened, and can for the open document", async () => {
        const body = { work_review_id: REVIEW };
        const withheld = await createDefense(trainingWorld(WITHHELD_SOURCE).db, { ...MENTOR_ACTOR, body });
        expect(withheld).toMatchObject({ ok: false, kind: "not_found" });
        const open = await createDefense(trainingWorld(OPEN_DOCUMENT_ONLY).db, { ...MENTOR_ACTOR, body });
        expect(open.ok).toBe(true);
    });

    it("the pupil's own list leaves the review out when only the pupil cannot open the source", async () => {
        // the document is the mentor's, never shared with the pupil
        const documents = [{ id: OTHER_PERSONS_DOC, user_id: MENTOR, project_id: null, org_id: null }];
        const result = await getMySupervision(trainingWorld(WITHHELD_SOURCE, { documents }).db, { userId: PUPIL, userEmail: PUPIL_EMAIL, orgId: "00000000-0000-4000-8000-000000000010" } as never);
        if (!result.ok) throw new Error(result.kind);
        expect(JSON.stringify(result.data)).not.toContain("REVIEW-FINDING");
        const forMentor = await listPupilWorks(trainingWorld(WITHHELD_SOURCE, { documents }).db, MENTOR_ACTOR as never);
        if (!forMentor.ok) throw new Error(forMentor.kind);
        expect(JSON.stringify(forMentor.data)).toContain("WORD-TITLE");
    });
});
