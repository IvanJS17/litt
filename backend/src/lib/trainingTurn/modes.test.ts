import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { TRAINING_ATTEMPT_MIN_CHARS, TRAINING_ATTEMPT_REQUIRED_CODE } from "../training";
import { launchCounterpartClose } from "../trainingCounterpart";
import { launchTurnContrast } from "../trainingNotes";
import { UNVERIFIED_LEGAL_FOOTER } from "../trainingHint";
import {
    beginTrainingTurn,
    finishTrainingTurn,
    recordTrainingNote,
    trainingEnginePlan,
    TRAINING_COUNTERPART_DONE_CODE,
    TRAINING_HINT_LIMIT_CODE,
    TRAINING_MODE_NOT_ALLOWED_CODE,
    type TrainingSurface,
} from "./index";
import { COUNTERPART_ADDENDUM, hintAddendum, modesBehavior, readMode } from "./modes";

vi.mock("../trainingNotes", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../trainingNotes")>()),
    launchTurnContrast: vi.fn(),
}));
vi.mock("../trainingCounterpart", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../trainingCounterpart")>()),
    launchCounterpartClose: vi.fn(),
}));

const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CHAT = "00000000-0000-4000-8000-0000000000c2";
const ATTEMPT = "a".repeat(TRAINING_ATTEMPT_MIN_CHARS + 20);
const NOW = Date.now();

let sequence = 0;
/** A note of the chat, created `sequence` seconds after the last one made here. */
function note(over: Row = {}): Row {
    sequence += 1;
    return {
        org_id: ORG,
        trainee_user_id: USER,
        chat_id: CHAT,
        word_chat_id: null,
        tabular_chat_id: null,
        message_id: `m${sequence}`,
        attempt: `intento ${sequence}`,
        mode: null,
        step: null,
        created_at: new Date(NOW + sequence * 1000).toISOString(),
        ...over,
    };
}
const hint = (step: number, over: Row = {}) => note({ mode: "hint", step, ...over });
const counterpart = (step: number, over: Row = {}) => note({ mode: "counterpart", step, ...over });
const close = (step: number, over: Row = {}) => note({ mode: "counterpart_close", step, ...over });

function world(stage: string | null, pass: boolean, notes: Row[] = []) {
    return memoryDb({
        training_stages: stage ? [{ org_id: ORG, trainee_user_id: USER, practice: null, stage }] : [],
        organizations: [{ id: ORG, kind: "team", deleted_at: null }],
        projects: [{ id: PROJECT, practice: null }],
        matters: [],
        training_urgency_passes: pass
            ? [
                  {
                      org_id: ORG,
                      trainee_user_id: USER,
                      project_id: PROJECT,
                      starts_at: new Date(NOW - 600_000).toISOString(),
                      expires_at: new Date(NOW + 3_600_000).toISOString(),
                      revoked_at: null,
                  },
              ]
            : [],
        training_turn_notes: notes,
    });
}

async function begin(
    mode: unknown,
    opts: {
        stage?: string | null;
        pass?: boolean;
        notes?: Row[];
        surface?: TrainingSurface;
        chatId?: string | null;
        persisted?: boolean;
        body?: Record<string, unknown>;
    } = {},
) {
    const { db } = world(opts.stage === undefined ? "pasante" : opts.stage, opts.pass ?? false, opts.notes ?? []);
    return beginTrainingTurn(db, {
        surface: opts.surface ?? "chat",
        userId: USER,
        scope: { orgId: ORG, projectId: PROJECT },
        body: { attempt: ATTEMPT, confidence: 3, training_mode: mode, ...opts.body },
        chatId: opts.chatId === undefined ? CHAT : opts.chatId,
        persisted: opts.persisted,
    });
}

beforeEach(() => {
    sequence = 0;
    vi.mocked(launchTurnContrast).mockClear();
    vi.mocked(launchCounterpartClose).mockClear();
});

describe("readMode", () => {
    it("reads the three modes, nothing as no mode, and anything else as unknown", () => {
        expect(readMode("hint")).toBe("hint");
        expect(readMode("counterpart")).toBe("counterpart");
        expect(readMode("counterpart_close")).toBe("counterpart_close");
        for (const none of [undefined, null, ""]) expect(readMode(none)).toBeNull();
        // A later card's modes and plain garbage are not this card's to grant.
        for (const unknown of ["criteria_contrast", "HINT", 1, true, {}, ["hint"]])
            expect(readMode(unknown)).toBeUndefined();
    });
});

describe("modes: surface × stage × pass × mode", () => {
    const SURFACES: TrainingSurface[] = ["chat", "project_chat", "tabular", "word"];
    const MODES = ["hint", "counterpart", "counterpart_close", "criteria_contrast", "nonsense"] as const;
    for (const surface of SURFACES) {
        for (const stage of [null, "junior", "pasante"] as const) {
            for (const pass of [false, true]) {
                for (const mode of MODES) {
                    // Word has no project, so no pass can apply there.
                    const passApplies = pass && surface !== "word";
                    const open = stage === "pasante" && !passApplies;
                    // A close needs a round to close; a pasante with one open is exercised below.
                    const known = mode === "hint" || mode === "counterpart";
                    it(`${surface} · ${stage ?? "no stage"} · ${pass ? "pass" : "no pass"} · ${mode}`, async () => {
                        const begun = await begin(mode, {
                            stage,
                            pass,
                            surface,
                            // A pass turns the requirement off, so the body needs no approach of its own.
                            notes: [],
                        });
                        if (open && known) {
                            expect(begun).toMatchObject({ ok: true, plan: { mode, step: 1 } });
                        } else {
                            expect(begun).toMatchObject({
                                ok: false,
                                status: 400,
                                code: TRAINING_MODE_NOT_ALLOWED_CODE,
                            });
                        }
                    });
                }
            }
        }
    }

    it("an urgency pass turns the modes off, and the pass ending turns them back on", async () => {
        expect(await begin("hint", { pass: true })).toMatchObject({ ok: false, code: TRAINING_MODE_NOT_ALLOWED_CODE });
        expect(await begin("hint", { pass: false })).toMatchObject({ ok: true });
    });

    it("a chat the server keeps no notes of (Word with local storage) has no modes", async () => {
        expect(await begin("hint", { surface: "word", persisted: false })).toMatchObject({
            ok: false,
            code: TRAINING_MODE_NOT_ALLOWED_CODE,
        });
        // ... while an ordinary turn there is untouched.
        expect(await begin(undefined, { surface: "word", persisted: false })).toMatchObject({ ok: true });
    });

    it("a turn with no mode is the ordinary turn", async () => {
        const begun = await begin(undefined);
        expect(begun).toMatchObject({ ok: true, plan: { mode: null, step: null, confidence: 3 } });
        expect(begun.ok && begun.plan.systemAddendum).toBeUndefined();
        expect(begun.ok && trainingEnginePlan(begun.plan)).toBeUndefined();
    });

    it("a mode still owes the approach (a hint is asked from a planteamiento)", async () => {
        expect(await begin("hint", { body: { attempt: undefined } })).toMatchObject({
            ok: false,
            code: TRAINING_ATTEMPT_REQUIRED_CODE,
        });
        expect(await begin("counterpart", { body: { attempt: "corto" } })).toMatchObject({
            ok: false,
            code: TRAINING_ATTEMPT_REQUIRED_CODE,
        });
    });
});

describe("the hint ladder is the server's", () => {
    it("starts at 1 and climbs with the chat's own hint notes, whatever the client says", async () => {
        const forged = { step: 3, hint_level: 3, level: 3, next_hint_level: 3, mode_step: 3 };
        const rung = async (notes: Row[]) => {
            const begun = await begin("hint", { notes, body: forged });
            return begun.ok ? begun.plan.step : begun;
        };
        expect(await rung([])).toBe(1);
        expect(await rung([hint(1)])).toBe(2);
        sequence = 0;
        expect(await rung([hint(1), hint(2)])).toBe(3);
    });

    it("refuses a fourth hint, with its own code", async () => {
        const notes = [hint(1), hint(2), hint(3)];
        expect(await begin("hint", { notes })).toMatchObject({
            ok: false,
            status: 400,
            code: TRAINING_HINT_LIMIT_CODE,
        });
    });

    it("starts over after the full answer, and never repeats or skips a rung", async () => {
        const climbed = [hint(1), hint(2), hint(3), note()];
        expect(await begin("hint", { notes: climbed })).toMatchObject({ ok: true, plan: { step: 1 } });
        // Hints 1 and 3 with a plain turn between them: the ladder after the plain turn is at 1.
        sequence = 0;
        const gap = [hint(1), hint(2), note(), hint(1)];
        expect(await begin("hint", { notes: gap })).toMatchObject({ ok: true, plan: { step: 2 } });
    });

    it("counts only this person's notes of this chat", async () => {
        const notes = [
            hint(1, { trainee_user_id: OTHER }),
            hint(2, { trainee_user_id: OTHER }),
            hint(1, { chat_id: OTHER_CHAT }),
            hint(2, { chat_id: OTHER_CHAT }),
        ];
        expect(await begin("hint", { notes })).toMatchObject({ ok: true, plan: { step: 1 } });
        expect(await begin("hint", { notes, chatId: null })).toMatchObject({ ok: true, plan: { step: 1 } });
    });

    it("reads each surface's own chat column", async () => {
        const notes = [hint(1, { chat_id: null, word_chat_id: CHAT }), hint(2, { chat_id: null, word_chat_id: CHAT })];
        expect(await begin("hint", { notes, surface: "word" })).toMatchObject({ ok: true, plan: { step: 3 } });
        expect(await begin("hint", { notes, surface: "chat" })).toMatchObject({ ok: true, plan: { step: 1 } });
    });

    it("is not rated and not contrasted: any mark sent with a hint is dropped, and none is required", async () => {
        const withMark = await begin("hint", { body: { confidence: 4 } });
        expect(withMark).toMatchObject({ ok: true, plan: { confidence: null } });
        const noMark = await begin("hint", { body: { confidence: undefined } });
        expect(noMark).toMatchObject({ ok: true, plan: { confidence: null } });
        // The counterpart is a rated approach like any other.
        expect(await begin("counterpart", { body: { confidence: undefined } })).toMatchObject({
            ok: false,
            code: "training_confidence_required",
        });
    });

    it("throws when the chat's notes cannot be read, so a rung is never guessed", async () => {
        const { db, failNext } = world("pasante", false);
        failNext("training_turn_notes", "select", { message: "down" });
        await expect(
            beginTrainingTurn(db, {
                surface: "chat",
                userId: USER,
                scope: { orgId: ORG, projectId: PROJECT },
                body: { attempt: ATTEMPT, confidence: 3, training_mode: "hint" },
                chatId: CHAT,
            }),
        ).rejects.toBeTruthy();
    });
});

describe("the counterparty's lawyer round", () => {
    it("takes up to three turns, and a fourth is refused (round 4)", async () => {
        const steps: unknown[] = [];
        const notes: Row[] = [];
        for (let turn = 1; turn <= 3; turn++) {
            const begun = await begin("counterpart", { notes: [...notes] });
            steps.push(begun.ok ? begun.plan.step : begun);
            notes.push(counterpart(turn));
        }
        expect(steps).toEqual([1, 2, 3]);
        expect(await begin("counterpart", { notes })).toMatchObject({
            ok: false,
            status: 400,
            code: TRAINING_COUNTERPART_DONE_CODE,
        });
        // The full round can still be closed, and then a new one opens.
        expect(await begin("counterpart_close", { notes })).toMatchObject({ ok: true, plan: { step: 3 } });
        expect(await begin("counterpart", { notes: [...notes, close(3)] })).toMatchObject({
            ok: true,
            plan: { step: 1 },
        });
    });

    it("closes only an open round, carrying the round's attempts to the closing contrast", async () => {
        expect(await begin("counterpart_close", { notes: [] })).toMatchObject({
            ok: false,
            code: TRAINING_MODE_NOT_ALLOWED_CODE,
        });
        const notes = [counterpart(1, { attempt: "primera defensa" }), counterpart(2, { attempt: "segunda defensa" })];
        const begun = await begin("counterpart_close", { notes });
        expect(begun).toMatchObject({ ok: true, plan: { mode: "counterpart_close", step: 2 } });
        expect(begun.ok && begun.plan.roundAttempts).toEqual(["primera defensa", "segunda defensa", ATTEMPT]);
        // A closed round is closed: closing again has nothing to close.
        expect(await begin("counterpart_close", { notes: [...notes, close(2)] })).toMatchObject({
            ok: false,
            code: TRAINING_MODE_NOT_ALLOWED_CODE,
        });
    });

    it("is a run of the counterpart: an ordinary turn or a hint in between starts a new round", async () => {
        expect(await begin("counterpart", { notes: [counterpart(1), note()] })).toMatchObject({
            ok: true,
            plan: { step: 1 },
        });
        sequence = 0;
        expect(await begin("counterpart", { notes: [counterpart(1), hint(1)] })).toMatchObject({
            ok: true,
            plan: { step: 1 },
        });
    });
});

describe("what a mode asks of the engine", () => {
    it.each(["hint", "counterpart", "counterpart_close"] as const)(
        "%s only restricts: no writers, no ask_inputs, no subagents, and the server's footer",
        async (mode) => {
            const notes = mode === "counterpart_close" ? [counterpart(1)] : [];
            const begun = await begin(mode, { notes });
            if (!begun.ok) throw new Error(begun.code);
            expect(trainingEnginePlan(begun.plan)).toEqual({
                systemAddendum: begun.plan.systemAddendum,
                allowDocumentMutation: false,
                includeAskInputs: false,
                noSubagents: true,
                unverifiedFooter: UNVERIFIED_LEGAL_FOOTER,
            });
        },
    );

    it.each(["hint", "counterpart", "counterpart_close"] as const)(
        "%s never offers the methodology calculator, even if an earlier behavior had set it",
        async (mode) => {
            const notes = mode === "counterpart_close" ? [counterpart(1)] : [];
            const { db } = world("pasante", false, notes);
            const resolved = {
                db, userId: USER, chatId: CHAT, persisted: true, surface: "chat" as const,
                body: { attempt: ATTEMPT, confidence: 3, mode, divergence: null },
                stage: "pasante" as const, passActive: false, orgId: ORG,
            };
            const plan = {
                surface: "chat" as const, stage: "pasante" as const, passActive: false, attempt: ATTEMPT,
                confidence: null, mode: null, step: null, orgId: ORG,
                toolPolicy: { methodology: true as const }, afterTurn: [],
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const next = await modesBehavior(resolved as any, plan as any);
            if ("ok" in next) throw new Error(next.code);
            expect(next.toolPolicy.methodology).toBeUndefined();
            expect(next.toolPolicy.allowDocumentMutation).toBe(false);
        },
    );

    it("a junior's mode is refused, so the methodology turn is never a mode turn", async () => {
        expect(await begin("hint", { stage: "junior" })).toMatchObject({ ok: false, code: TRAINING_MODE_NOT_ALLOWED_CODE });
    });

    it("says the rung in the hint's text and never asks for the conclusion", () => {
        for (const step of [1, 2, 3] as const) {
            const text = hintAddendum(step);
            expect(text).toContain(`Escalón ${step}`);
            expect(text).toMatch(/No des la conclusión/);
            expect(text).toMatch(/no están verificados/);
        }
        expect(hintAddendum(1)).not.toContain("Escalón 2");
        expect(COUNTERPART_ADDENDUM).toMatch(/hasta tres objeciones/);
        expect(COUNTERPART_ADDENDUM).toMatch(/No resuelvas las objeciones/);
    });

    it("puts a mode's text before another behavior's and keeps the limits already set", async () => {
        const begun = await begin("hint");
        if (!begun.ok) throw new Error(begun.code);
        expect(begun.plan.systemAddendum?.startsWith("ESTE TURNO ES UNA PISTA")).toBe(true);
    });
});

describe("the note of a mode", () => {
    async function recorded(mode: string, notes: Row[] = []) {
        const { db, tables } = world("pasante", false, notes);
        const begun = await beginTrainingTurn(db, {
            surface: "chat",
            userId: USER,
            scope: { orgId: ORG, projectId: PROJECT },
            body: { attempt: ATTEMPT, confidence: 3, training_mode: mode },
            chatId: CHAT,
        });
        if (!begun.ok) throw new Error(begun.code);
        const result = await recordTrainingNote(db, { plan: begun.plan, userId: USER, chatId: CHAT, messageId: "msg" });
        if (!result.ok) throw new Error("note");
        return { plan: begun.plan, note: result.note!, row: tables.training_turn_notes.at(-1)! };
    }

    it("a hint is recorded pending until it is delivered, with its rung and no mark", async () => {
        const { row } = await recorded("hint", [hint(1)]);
        expect(row).toMatchObject({ mode: "hint", step: 2, contrast_status: "pending", confidence: null, attempt: ATTEMPT });
    });

    it("a counterpart turn is provisional too, and the close waits for its own contrast", async () => {
        expect((await recorded("counterpart")).row).toMatchObject({ mode: "counterpart", step: 1, contrast_status: "pending" });
        expect((await recorded("counterpart_close", [counterpart(1)])).row).toMatchObject({
            mode: "counterpart_close",
            step: 1,
            contrast_status: "pending",
            confidence: 3,
        });
    });

    it("an ordinary turn is pending with no mode, as before", async () => {
        const { db, tables } = world("pasante", false);
        const begun = await beginTrainingTurn(db, {
            surface: "chat",
            userId: USER,
            scope: { orgId: ORG },
            body: { attempt: ATTEMPT, confidence: 2 },
        });
        if (!begun.ok) throw new Error();
        await recordTrainingNote(db, { plan: begun.plan, userId: USER, chatId: CHAT, messageId: "msg" });
        expect(tables.training_turn_notes[0]).toMatchObject({ mode: null, step: null, contrast_status: "pending" });
    });

    it("finishes a hint or a counterpart turn without a contrast, and a close with the round's", async () => {
        const hinted = await recorded("hint");
        finishTrainingTurn(world("pasante", false).db, { plan: hinted.plan, note: hinted.note, completed: true, answer: "pista", model: "m" });
        const turn = await recorded("counterpart");
        finishTrainingTurn(world("pasante", false).db, { plan: turn.plan, note: turn.note, completed: true, answer: "objeción", model: "m" });
        expect(launchTurnContrast).not.toHaveBeenCalled();
        expect(launchCounterpartClose).not.toHaveBeenCalled();

        const closing = await recorded("counterpart_close", [counterpart(1, { attempt: "defensa uno" })]);
        const { db } = world("pasante", false);
        finishTrainingTurn(db, { plan: closing.plan, note: closing.note, completed: true, answer: "cierre", model: "m" });
        expect(launchTurnContrast).not.toHaveBeenCalled();
        expect(launchCounterpartClose).toHaveBeenCalledWith(db, {
            noteId: closing.note.id,
            attempts: ["defensa uno", ATTEMPT],
            answer: "cierre",
            model: "m",
            apiKeys: undefined,
        });
    });

    it("a delivered hint or counterpart turn settles as skipped; one that was not stays provisional", async () => {
        for (const mode of ["hint", "counterpart"]) {
            const done = await recorded(mode);
            const { db, tables } = world("pasante", false, [{ id: done.note.id, mode, contrast_status: "pending" }]);
            finishTrainingTurn(db, { plan: done.plan, note: done.note, completed: true, answer: "x", model: "m" });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(tables.training_turn_notes[0].contrast_status).toBe("skipped");

            const failed = world("pasante", false, [{ id: done.note.id, mode, contrast_status: "pending" }]);
            finishTrainingTurn(failed.db, { plan: done.plan, note: done.note, completed: false, answer: "", model: "m" });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(failed.tables.training_turn_notes[0].contrast_status).toBe("pending");
        }
    });

    it("an aborted turn does not climb the ladder: two aborts, then the first rung is still the next", async () => {
        const pending = (mode: string, step: number) => ({ mode, step, contrast_status: "pending" });
        for (const [mode, expected] of [["hint", 1], ["counterpart", 1]] as const) {
            const aborted = await recorded(mode, [pending(mode, 1), pending(mode, 2)]);
            expect(aborted.row).toMatchObject({ mode, step: expected });
        }
        const delivered = await recorded("hint", [hint(1), pending("hint", 2), pending("hint", 3)]);
        expect(delivered.row.step).toBe(2);
    });

    it("finishes nothing for a close whose turn errored", async () => {
        const closing = await recorded("counterpart_close", [counterpart(1)]);
        finishTrainingTurn(world("pasante", false).db, { plan: closing.plan, note: closing.note, completed: false, answer: "", model: "m" });
        expect(launchCounterpartClose).not.toHaveBeenCalled();
    });
});
