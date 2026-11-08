import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import {
    TRAINING_ATTEMPT_MAX_CHARS,
    TRAINING_ATTEMPT_MIN_CHARS,
    TRAINING_ATTEMPT_REQUIRED_CODE,
} from "../training";
import type { Db } from "../supabase";
import { launchTurnContrast } from "../trainingNotes";
import {
    beginTrainingTurn,
    finishTrainingTurn,
    readTrainingBody,
    recordTrainingNote,
    trainingEnginePlan,
    type TrainingSurface,
    type TrainingTurnPlan,
} from "./index";

vi.mock("../trainingNotes", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../trainingNotes")>()),
    launchTurnContrast: vi.fn(),
}));

const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const USER = "00000000-0000-4000-8000-000000000001";
const NOW = Date.now();
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function world(stage: string | null, pass: boolean) {
    const passes: Row[] = pass
        ? [
              {
                  org_id: ORG,
                  trainee_user_id: USER,
                  project_id: PROJECT,
                  starts_at: iso(-10),
                  expires_at: iso(60),
                  revoked_at: null,
              },
          ]
        : [];
    return memoryDb({
        training_stages: stage
            ? [{ org_id: ORG, trainee_user_id: USER, practice: null, stage }]
            : [],
        organizations: [{ id: ORG, kind: "team", deleted_at: null }],
        projects: [{ id: PROJECT, practice: null }],
        matters: [],
        training_urgency_passes: passes,
        training_turn_notes: [],
    });
}

/** A database whose every query answers with an error. */
function failingDb(): Db {
    const failure = { data: null, error: { message: "down" } };
    const chain: unknown = new Proxy(() => undefined, {
        get: (_target, key) =>
            key === "then" ? (resolve: (v: unknown) => void) => resolve(failure) : chain,
        apply: () => chain,
    });
    return chain as Db;
}

const GOOD = "a".repeat(TRAINING_ATTEMPT_MIN_CHARS + 20);
const BODIES = {
    valid: { attempt: `  ${GOOD}  ` },
    missing: {},
    short: { attempt: "a".repeat(TRAINING_ATTEMPT_MIN_CHARS - 1) },
    long: { attempt: "a".repeat(TRAINING_ATTEMPT_MAX_CHARS + 1) },
    notAString: { attempt: 42 },
} as const;

const SURFACES: TrainingSurface[] = ["chat", "project_chat", "tabular", "word"];
const STAGES = [null, "junior", "pasante"] as const;

/**
 * The observable behavior of the four surfaces before the turn was wired in
 * one place (superficie × etapa × pase × cuerpo): only a pasante without a
 * pass owes an attempt; Word has no project, so no pass can lift it there;
 * everybody else's `attempt` is ignored.
 */
describe("beginTrainingTurn: surface × stage × pass × body", () => {
    for (const surface of SURFACES) {
        for (const stage of STAGES) {
            for (const pass of [false, true]) {
                for (const [bodyName, body] of Object.entries(BODIES)) {
                    const passApplies = pass && surface !== "word" && stage === "pasante";
                    const owesAttempt = stage === "pasante" && !passApplies;
                    const label = `${surface} · ${stage ?? "no stage"} · ${pass ? "pass" : "no pass"} · ${bodyName}`;
                    it(label, async () => {
                        const { db } = world(stage, pass);
                        const begun = await beginTrainingTurn(db, {
                            surface,
                            userId: USER,
                            scope: { orgId: ORG, projectId: PROJECT },
                            body,
                        });
                        if (owesAttempt && bodyName !== "valid") {
                            expect(begun).toMatchObject({
                                ok: false,
                                status: 400,
                                code: TRAINING_ATTEMPT_REQUIRED_CODE,
                            });
                            return;
                        }
                        expect(begun.ok).toBe(true);
                        if (!begun.ok) return;
                        expect(begun.plan).toMatchObject({
                            surface,
                            stage,
                            passActive: surface !== "word" && passApplies,
                            attempt: owesAttempt ? GOOD : null,
                            orgId: surface === "word" ? (stage ? ORG : null) : ORG,
                        });
                    });
                }
            }
        }
    }
});

describe("beginTrainingTurn failures", () => {
    it("throws when the stage cannot be read, so no turn skips its requirement", async () => {
        const db = failingDb();
        await expect(
            beginTrainingTurn(db, {
                surface: "chat",
                userId: USER,
                scope: { orgId: ORG },
                body: {},
            }),
        ).rejects.toBeTruthy();
    });

    it("has no stage in the personal space", async () => {
        const { db } = world("pasante", false);
        const begun = await beginTrainingTurn(db, {
            surface: "chat",
            userId: USER,
            scope: { orgId: null },
            body: {},
        });
        expect(begun.ok && begun.plan.stage).toBeNull();
    });
});

describe("readTrainingBody", () => {
    it("reads the attempt and ignores everything else", () => {
        expect(readTrainingBody({ attempt: "x", other: 1 })).toEqual({
            attempt: "x",
            confidence: null,
            mode: null,
            divergence: null,
        });
    });
    it("tolerates a body that is not an object", () => {
        for (const body of [undefined, null, "text", 3, ["attempt"]])
            expect(readTrainingBody(body).attempt).toBeUndefined();
    });
});

function plan(over: Partial<TrainingTurnPlan> = {}): TrainingTurnPlan {
    return {
        surface: "chat",
        stage: "pasante",
        passActive: false,
        attempt: GOOD,
        confidence: null,
        mode: null,
        step: null,
        orgId: ORG,
        toolPolicy: {},
        afterTurn: [],
        ...over,
    };
}

describe("recordTrainingNote", () => {
    it("writes a pending note on the surface's own chat column", async () => {
        for (const [surface, column] of [
            ["chat", "chat_id"],
            ["project_chat", "chat_id"],
            ["word", "word_chat_id"],
            ["tabular", "tabular_chat_id"],
        ] as const) {
            const { db, tables } = world("pasante", false);
            const recorded = await recordTrainingNote(db, {
                plan: plan({ surface }),
                userId: USER,
                chatId: "chat-1",
                messageId: "message-1",
            });
            expect(recorded.ok && recorded.note?.attempt).toBe(GOOD);
            expect(tables.training_turn_notes).toHaveLength(1);
            expect(tables.training_turn_notes[0]).toMatchObject({
                org_id: ORG,
                trainee_user_id: USER,
                [column]: "chat-1",
                message_id: "message-1",
                attempt: GOOD,
                contrast_status: "pending",
            });
        }
    });

    it.each([
        ["no attempt", { attempt: null }, "message-1"],
        ["no organization", { orgId: null }, "message-1"],
        ["no persisted message (local Word chat)", {}, null],
        ["no message id", {}, undefined],
    ] as const)("writes nothing with %s", async (_name, over, messageId) => {
        const { db, tables } = world("pasante", false);
        const recorded = await recordTrainingNote(db, {
            plan: plan(over),
            userId: USER,
            chatId: "chat-1",
            messageId,
        });
        expect(recorded).toEqual({ ok: true, note: null });
        expect(tables.training_turn_notes).toHaveLength(0);
    });

    it("reports a failed write", async () => {
        const db = failingDb();
        const recorded = await recordTrainingNote(db, {
            plan: plan(),
            userId: USER,
            chatId: "chat-1",
            messageId: "message-1",
        });
        expect(recorded.ok).toBe(false);
    });
});

describe("finishTrainingTurn", () => {
    const { db } = memoryDb({});
    const note = { id: "note-1", attempt: GOOD };
    beforeEach(() => vi.mocked(launchTurnContrast).mockClear());

    it("launches the contrast of a completed turn with the conversation's model", () => {
        finishTrainingTurn(db, {
            plan: plan(),
            note,
            completed: true,
            answer: "respuesta",
            model: "m",
        });
        expect(launchTurnContrast).toHaveBeenCalledWith(db, {
            noteId: "note-1",
            attempt: GOOD,
            answer: "respuesta",
            model: "m",
            apiKeys: undefined,
        });
    });

    it("launches nothing for a turn that errored or has no note", () => {
        finishTrainingTurn(db, { plan: plan(), note, completed: false, answer: "", model: "m" });
        finishTrainingTurn(db, { plan: plan(), note: null, completed: true, answer: "", model: "m" });
        finishTrainingTurn(db, { plan: null, note: null, completed: true, answer: "", model: "m" });
        expect(launchTurnContrast).not.toHaveBeenCalled();
    });

    it("never lets an after-turn hook fail the turn", () => {
        const hook = vi.fn(() => {
            throw new Error("boom");
        });
        finishTrainingTurn(db, {
            plan: plan({ afterTurn: [hook] }),
            note,
            completed: true,
            answer: "a",
            model: "m",
        });
        expect(hook).toHaveBeenCalledOnce();
        expect(launchTurnContrast).toHaveBeenCalledOnce();
    });
});

describe("trainingEnginePlan", () => {
    it("asks nothing of the engine today", () => {
        expect(trainingEnginePlan(plan())).toBeUndefined();
        expect(trainingEnginePlan(null)).toBeUndefined();
    });
    it("passes the addendum and only the limits the plan sets", () => {
        expect(
            trainingEnginePlan(
                plan({ systemAddendum: "x", toolPolicy: { noSubagents: true } }),
            ),
        ).toEqual({ systemAddendum: "x", noSubagents: true });
    });
});
