import { describe, expect, it, vi } from "vitest";

// The questions of a defense over a practice area are written from the notes of
// the pupil's works, Word works included. They are shown, to the mentor and to
// the pupil, only while every work they were written from is one the reader may
// see now (lib/trainingWork judgeWorks); a defense whose works were not recorded
// is of unknown basis and keeps its questions and note back.
const { sent } = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("./trainingSupervision.reviews", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./trainingSupervision.reviews")>()),
    mentorGeneration: vi.fn(async () => ({ available: false, code: "training_review_key_required" })),
    mentorRoute: vi.fn(async () => ({ ok: true, data: { route: { model: "model-x" }, apiKeys: {} } })),
}));
vi.mock("../user/user.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../user/user.service")>()),
    recordChatEgress: vi.fn(async () => undefined),
}));
vi.mock("../../lib/trainingSupervisionAi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/trainingSupervisionAi")>()),
    completeSupervision: vi.fn(async (args: { user: string }) => {
        sent.push(args.user);
        return "generated";
    }),
    parseDefenseQuestions: vi.fn(() => [{ kind: "base", text: "AREA-QUESTION", listen_for: "x" }]),
}));
import {
    MENTOR_ACTOR,
    OPEN_DOCUMENT_ONLY,
    ORG,
    PUPIL,
    PUPIL_EMAIL,
    WITHHELD_SOURCE,
    WORD_CHAT,
    trainingWorld,
} from "../../__tests__/helpers/wordChatTrainingWorld";
import type { Row } from "../../__tests__/helpers/memoryDb";
import { generateDefenseQuestions, listDefenses, recordDefenseOutcome } from "./trainingSupervision.defenses";
import { getMySupervision } from "./trainingSupervision.service";

const AREA = "00000000-0000-4000-8000-0000000000a1";
const GONE_CHAT = "00000000-0000-4000-8000-0000000000c9";
const areaDefense = (over: Row = {}): Row => ({
    id: AREA, org_id: ORG, trainee_user_id: PUPIL, practice: null, work_review_id: null,
    questions: null, questions_status: "none", outcome: null, outcome_reason: null, outcome_note: null,
    held_at: null, created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over,
});
/** A defense whose questions were already written (and, for the pupil, whose outcome is recorded). */
const written = (over: Row = {}): Row =>
    areaDefense({
        questions: [{ kind: "base", text: "AREA-QUESTION", listen_for: "x" }], questions_status: "ready",
        outcome: "approved", outcome_reason: "razonamiento_solido", outcome_note: "AREA-NOTE", held_at: "2026-11-12T11:00:00Z",
        source_project_ids: [], ...over,
    });
const outcomeBody = { outcome: "approved", reason: "razonamiento_solido", note: "AREA-NOTE" };
const PUPIL_ACTOR = { userId: PUPIL, userEmail: PUPIL_EMAIL, orgId: ORG } as never;

/** The Word answer's source becomes a document of a third person. */
function withhold(world: ReturnType<typeof trainingWorld>) {
    const assistant = world.tables.word_chat_messages.find((message) => message.role === "assistant")!;
    assistant.content = [...WITHHELD_SOURCE, { type: "content", text: "ANSWER-TEXT" }];
}

async function generated(source: typeof WITHHELD_SOURCE) {
    sent.length = 0;
    const world = trainingWorld(source, { training_defenses: [areaDefense()] });
    const result = await generateDefenseQuestions(world.db, { ...MENTOR_ACTOR, defenseId: AREA } as never);
    if (!result.ok) throw new Error(result.kind);
    return world;
}

const mentorSees = async (world: ReturnType<typeof trainingWorld>) => {
    const result = await listDefenses(world.db, MENTOR_ACTOR);
    if (!result.ok) throw new Error(result.kind);
    return JSON.stringify(result.data);
};
const pupilSees = async (world: ReturnType<typeof trainingWorld>) => {
    const result = await getMySupervision(world.db, PUPIL_ACTOR);
    if (!result.ok) throw new Error(result.kind);
    return JSON.stringify(result.data);
};
const recordedFor = async (world: ReturnType<typeof trainingWorld>) => {
    const result = await recordDefenseOutcome(world.db, { ...MENTOR_ACTOR, defenseId: AREA, body: outcomeBody } as never);
    if (!result.ok) throw new Error(result.kind);
    return JSON.stringify(result.data);
};

describe("a defense over a practice area remembers the Word chats it was written from", () => {
    it("stores the Word chats used with the matters, and an empty list when none was used", async () => {
        const world = await generated(OPEN_DOCUMENT_ONLY);
        expect(world.tables.training_defenses[0]).toMatchObject({ source_project_ids: [], source_word_chat_ids: [WORD_CHAT] });

        sent.length = 0;
        const CHAT = "00000000-0000-4000-8000-0000000000d2";
        const bare = trainingWorld(OPEN_DOCUMENT_ONLY, {
            training_defenses: [areaDefense()],
            chats: [{ id: CHAT, project_id: null, title: "T" }],
            training_turn_notes: [{
                id: "00000000-0000-4000-8000-0000000000d1", org_id: ORG, trainee_user_id: PUPIL, chat_id: CHAT, word_chat_id: null,
                tabular_chat_id: null, message_id: "00000000-0000-4000-8000-0000000000d3", attempt: "x", contrast: null,
                contrast_status: "none", created_at: "2026-11-09T10:00:00Z",
            }],
        });
        const result = await generateDefenseQuestions(bare.db, { ...MENTOR_ACTOR, defenseId: AREA } as never);
        expect(result.ok).toBe(true);
        expect(bare.tables.training_defenses[0]).toMatchObject({ source_project_ids: [], source_word_chat_ids: [] });
    });

    it("withholds the questions and the note from the mentor once the Word answer's source is withheld", async () => {
        const world = await generated(OPEN_DOCUMENT_ONLY);
        expect(await mentorSees(world)).toContain("AREA-QUESTION");
        withhold(world);
        expect(await mentorSees(world)).not.toContain("AREA-QUESTION");
        const outcome = await recordedFor(world);
        expect(outcome).not.toContain("AREA-QUESTION");
        expect(outcome).not.toContain("AREA-NOTE");
        expect(JSON.parse(outcome)).toMatchObject({ outcome: "approved" });
    });

    it("withholds them from the pupil's own view too, and shows them while the source stays open", async () => {
        const open = await generated(OPEN_DOCUMENT_ONLY);
        await recordedFor(open);
        expect(await pupilSees(open)).toContain("AREA-QUESTION");
        expect(await pupilSees(open)).toContain("AREA-NOTE");
        const world = await generated(OPEN_DOCUMENT_ONLY);
        await recordedFor(world);
        withhold(world);
        const text = await pupilSees(world);
        expect(text).not.toContain("AREA-QUESTION");
        expect(text).not.toContain("AREA-NOTE");
    });

    it("shows the control: the source is still the open document", async () => {
        const world = await generated(OPEN_DOCUMENT_ONLY);
        const outcome = await recordedFor(world);
        expect(outcome).toContain("AREA-QUESTION");
        expect(outcome).toContain("AREA-NOTE");
    });

    it("withholds a defense made before the Word chats were recorded, for the mentor and the pupil", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [written({ source_word_chat_ids: null })] });
        for (const text of [await mentorSees(world), await pupilSees(world)]) {
            expect(text).not.toContain("AREA-QUESTION");
            expect(text).not.toContain("AREA-NOTE");
            expect(text).toContain(AREA);
        }
        expect(world.tables.training_defenses[0].questions).not.toBeNull();
    });

    it("leaves a defense made only from works in matters as it was: an empty list of Word chats is none used", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [written({ source_word_chat_ids: [] })] });
        for (const text of [await mentorSees(world), await pupilSees(world)]) {
            expect(text).toContain("AREA-QUESTION");
            expect(text).toContain("AREA-NOTE");
        }
    });

    it("withholds a defense when a recorded Word chat is gone, and when any one of several is withheld", async () => {
        const gone = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [written({ source_word_chat_ids: [GONE_CHAT] })] });
        expect(await mentorSees(gone)).not.toContain("AREA-QUESTION");
        const mixed = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [written({ source_word_chat_ids: [WORD_CHAT, GONE_CHAT] })] });
        expect(await mentorSees(mixed)).not.toContain("AREA-QUESTION");
    });

    it("refuses rather than shows when the lookup of the Word chat fails", async () => {
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [written({ source_word_chat_ids: [WORD_CHAT] })] });
        world.failNext("word_chat_messages", "select", { message: "unavailable" });
        const result = await listDefenses(world.db, MENTOR_ACTOR).catch((error: unknown) => error);
        expect(JSON.stringify(result instanceof Error ? {} : result)).not.toContain("AREA-QUESTION");
    });

    it("judges the Word chats of all the defenses of a list in one pass", async () => {
        const rows = [1, 2, 3].map((n) => written({ id: `00000000-0000-4000-8000-0000000000b${n}`, source_word_chat_ids: [WORD_CHAT] }));
        const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: rows });
        let chatLookups = 0;
        const from = world.db.from.bind(world.db);
        (world.db as unknown as { from: (table: string) => unknown }).from = (table: string) => {
            if (table === "word_chats") chatLookups += 1;
            return from(table);
        };
        const text = await mentorSees(world);
        expect(text.split("AREA-QUESTION")).toHaveLength(4);
        expect(chatLookups).toBe(1);
    });

    describe("recording an outcome marks the sources only of a defense that has none to record", () => {
        const withQuestions = (over: Row = {}): Row => written({ outcome: null, outcome_reason: null, outcome_note: null, held_at: null, ...over });
        const rowOf = (world: ReturnType<typeof trainingWorld>) => world.tables.training_defenses[0];
        /** Runs `before` as the marking write is about to be made (the third access to the defenses table). */
        function beforeMarking(world: ReturnType<typeof trainingWorld>, before: () => void) {
            let accesses = 0;
            const from = world.db.from.bind(world.db);
            (world.db as unknown as { from: (table: string) => unknown }).from = (table: string) => {
                if (table === "training_defenses" && ++accesses === 3) before();
                return from(table);
            };
        }

        for (const projects of [null, ["00000000-0000-4000-8000-0000000000e1"]]) {
            it(`keeps a defense with questions and no recorded Word chats unrecorded (matters: ${projects === null ? "unrecorded" : "recorded"}), its questions and note withheld`, async () => {
                const world = trainingWorld(OPEN_DOCUMENT_ONLY, {
                    training_defenses: [withQuestions({ source_project_ids: projects, source_word_chat_ids: null })],
                });
                const reply = await recordedFor(world);
                expect(rowOf(world).source_word_chat_ids).toBeNull();
                expect(rowOf(world).source_project_ids).toEqual(projects);
                expect(rowOf(world).outcome).toBe("approved");
                for (const text of [reply, await mentorSees(world), await pupilSees(world)]) {
                    expect(text).not.toContain("AREA-QUESTION");
                    expect(text).not.toContain("AREA-NOTE");
                }
                expect(JSON.parse(reply)).toMatchObject({ outcome: "approved" });
            });
        }

        it("leaves both recorded lists of a defense with questions as they were", async () => {
            const world = trainingWorld(OPEN_DOCUMENT_ONLY, {
                training_defenses: [withQuestions({ source_project_ids: [], source_word_chat_ids: [WORD_CHAT] })],
            });
            const reply = await recordedFor(world);
            expect(rowOf(world)).toMatchObject({ source_project_ids: [], source_word_chat_ids: [WORD_CHAT] });
            expect(reply).toContain("AREA-QUESTION");
            expect(reply).toContain("AREA-NOTE");
        });

        it("records both lists as empty for a defense with no questions, and shows the mentor's note", async () => {
            const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [areaDefense()] });
            const reply = await recordedFor(world);
            expect(rowOf(world)).toMatchObject({ source_project_ids: [], source_word_chat_ids: [] });
            expect(reply).toContain("AREA-NOTE");
            expect(await mentorSees(world)).toContain("AREA-NOTE");
        });

        it("keeps the sources of questions written between the outcome and the marking", async () => {
            const world = trainingWorld(OPEN_DOCUMENT_ONLY, { training_defenses: [areaDefense()] });
            beforeMarking(world, () => {
                Object.assign(rowOf(world), {
                    questions: [{ kind: "base", text: "AREA-QUESTION", listen_for: "x" }], questions_status: "ready",
                    source_project_ids: null, source_word_chat_ids: [WORD_CHAT],
                });
            });
            await recordedFor(world);
            expect(rowOf(world)).toMatchObject({ source_project_ids: null, source_word_chat_ids: [WORD_CHAT] });
        });

        it("does not mark a defense that had questions when the outcome was read, even if they are gone by the time it is written", async () => {
            const world = trainingWorld(OPEN_DOCUMENT_ONLY, {
                training_defenses: [withQuestions({ source_project_ids: null, source_word_chat_ids: null })],
            });
            beforeMarking(world, () => Object.assign(rowOf(world), { questions: null }));
            await recordedFor(world);
            expect(rowOf(world).source_word_chat_ids).toBeNull();
            expect(rowOf(world).source_project_ids).toBeNull();
        });
    });
});
