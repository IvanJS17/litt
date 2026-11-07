import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../__tests__/helpers/memoryDb";
import {
    isUrgencyPassActive,
    resolveTurnTraining,
    turnStage,
    URGENCY_PASS_DEFAULT_MINUTES,
    URGENCY_PASS_MAX_ACTIVE,
    URGENCY_PASS_MAX_MINUTES,
    URGENCY_PASS_MIN_MINUTES,
} from "./trainingPass";

const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const OTHER_PROJECT = "00000000-0000-4000-8000-000000000021";
const PUPIL = "00000000-0000-4000-8000-000000000001";
const OTHER_PUPIL = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-07T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

function pass(extra: Row = {}): Row {
    return {
        org_id: ORG,
        trainee_user_id: PUPIL,
        project_id: PROJECT,
        starts_at: at(-10),
        expires_at: at(60),
        revoked_at: null,
        ...extra,
    };
}

function world(stage: string | null, passes: Row[] = []) {
    return memoryDb({
        training_stages: stage
            ? [{ org_id: ORG, trainee_user_id: PUPIL, practice: null, stage }]
            : [],
        projects: [{ id: PROJECT, practice: null }],
        matters: [],
        training_urgency_passes: passes,
    });
}

const scope = { orgId: ORG, projectId: PROJECT };

afterEach(() => vi.restoreAllMocks());

describe("the product parameters (open question 1)", () => {
    it("are 30 minutes to 72 hours, 8 hours by default, at most 5 in force", () => {
        expect([URGENCY_PASS_MIN_MINUTES, URGENCY_PASS_DEFAULT_MINUTES, URGENCY_PASS_MAX_MINUTES])
            .toEqual([30, 480, 4320]);
        expect(URGENCY_PASS_MAX_ACTIVE).toBe(5);
    });
});

describe("resolveTurnTraining", () => {
    it("asks a pasante for the attempt without a pass", async () => {
        const turn = await resolveTurnTraining(world("pasante").db, PUPIL, scope, NOW);
        expect(turn).toEqual({
            stage: "pasante",
            passActive: false,
            passExpiresAt: null,
            attemptRequired: true,
        });
        expect(turnStage(turn)).toBe("pasante");
    });

    it("lifts the attempt while a pass on this project is in force, keeping the stage", async () => {
        const turn = await resolveTurnTraining(world("pasante", [pass()]).db, PUPIL, scope, NOW);
        expect(turn).toEqual({
            stage: "pasante",
            passActive: true,
            passExpiresAt: at(60),
            attemptRequired: false,
        });
        expect(turnStage(turn)).toBeNull();
    });

    it("answers the latest end when several passes are in force", async () => {
        const turn = await resolveTurnTraining(
            world("pasante", [pass({ expires_at: at(30) }), pass({ expires_at: at(240) })]).db,
            PUPIL,
            scope,
            NOW,
        );
        expect(turn.passExpiresAt).toBe(at(240));
    });

    it.each([
        ["expired", pass({ expires_at: at(-1) })],
        ["ending right now", pass({ expires_at: at(0) })],
        ["not started yet", pass({ starts_at: at(5) })],
        ["revoked", pass({ revoked_at: at(-5) })],
        ["on another project", pass({ project_id: OTHER_PROJECT })],
        ["of another pupil", pass({ trainee_user_id: OTHER_PUPIL })],
        ["in another organization", pass({ org_id: "00000000-0000-4000-8000-000000000099" })],
    ])("asks for the attempt again with a pass %s", async (_label, row) => {
        const turn = await resolveTurnTraining(world("pasante", [row]).db, PUPIL, scope, NOW);
        expect(turn).toMatchObject({ passActive: false, attemptRequired: true });
    });

    it("has no pass outside a project: a chat without a matter", async () => {
        const turn = await resolveTurnTraining(
            world("pasante", [pass()]).db,
            PUPIL,
            { orgId: ORG, projectId: null },
            NOW,
        );
        expect(turn).toMatchObject({ passActive: false, attemptRequired: true });
    });

    it.each([["a junior", "junior"], ["a lawyer", null]])(
        "does not read passes for %s, who never needs an attempt",
        async (_label, stage) => {
            const { db, tables } = world(stage, [pass()]);
            const from = vi.spyOn(db, "from");
            const turn = await resolveTurnTraining(db, PUPIL, scope, NOW);
            expect(turn).toMatchObject({ passActive: false, attemptRequired: false });
            expect(from.mock.calls.map(([table]) => table)).not.toContain("training_urgency_passes");
            expect(tables.training_urgency_passes).toHaveLength(1);
        },
    );

    it("asks for the attempt when the passes cannot be read, logging no data", async () => {
        const { db, failNext } = world("pasante", [pass()]);
        failNext("training_urgency_passes", "select", { message: "boom", details: PUPIL });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const turn = await resolveTurnTraining(db, PUPIL, scope, NOW);
        expect(turn).toMatchObject({ stage: "pasante", passActive: false, attemptRequired: true });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(PUPIL);
    });

    it("still fails the turn when the stage itself cannot be read", async () => {
        const { db, failNext } = world("pasante", [pass()]);
        failNext("training_stages", "select", { message: "boom" });
        await expect(resolveTurnTraining(db, PUPIL, scope, NOW)).rejects.toThrow();
    });
});

describe("isUrgencyPassActive", () => {
    it("re-checks a row whatever the query filtered", () => {
        expect(isUrgencyPassActive(pass(), NOW)).toBe(true);
        expect(isUrgencyPassActive(pass({ expires_at: at(-1) }), NOW)).toBe(false);
        expect(isUrgencyPassActive({ expires_at: at(60) }, NOW)).toBe(false);
        expect(isUrgencyPassActive({ starts_at: 1, expires_at: null }, NOW)).toBe(false);
    });
});
