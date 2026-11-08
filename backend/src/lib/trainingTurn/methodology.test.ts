import { describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { beginTrainingTurn, trainingEnginePlan, type TrainingSurface } from "./index";
import { methodologyBehavior } from "./methodology";
import type { TrainingTurnPlan } from "./types";

const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const USER = "00000000-0000-4000-8000-000000000001";
const NOW = Date.now();
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function world(stage: string | null, pass: boolean) {
    const passes: Row[] = pass
        ? [{ org_id: ORG, trainee_user_id: USER, project_id: PROJECT, starts_at: iso(-10), expires_at: iso(60), revoked_at: null }]
        : [];
    return memoryDb({
        training_stages: stage ? [{ org_id: ORG, trainee_user_id: USER, practice: null, stage }] : [],
        organizations: [{ id: ORG, kind: "team", deleted_at: null }],
        projects: [{ id: PROJECT, practice: null }],
        matters: [],
        training_urgency_passes: passes,
        training_turn_notes: [],
    });
}

const SURFACES: TrainingSurface[] = ["chat", "project_chat", "tabular", "word"];
const ATTEMPT = { attempt: "a".repeat(400), confidence: 3 };

describe("the methodology tool is offered to a junior's turn and nobody else's", () => {
    for (const surface of SURFACES) {
        for (const stage of [null, "pasante", "junior"] as const) {
            for (const pass of [false, true]) {
                it(`${surface} · ${stage ?? "no stage"} · ${pass ? "pass" : "no pass"}`, async () => {
                    const { db } = world(stage, pass);
                    const begun = await beginTrainingTurn(db, {
                        surface,
                        userId: USER,
                        scope: { orgId: ORG, projectId: PROJECT },
                        body: ATTEMPT,
                    });
                    expect(begun.ok).toBe(true);
                    if (!begun.ok) return;
                    const offered = stage === "junior";
                    expect(begun.plan.toolPolicy.methodology).toBe(offered ? true : undefined);
                    expect(trainingEnginePlan(begun.plan)?.methodology).toBe(offered ? true : undefined);
                });
            }
        }
    }

    it("turns no plan, or an empty one, into nothing for the engine", () => {
        expect(trainingEnginePlan(null)).toBeUndefined();
    });

    it("only narrows: it adds no engine permission and keeps what the plan already had", () => {
        const plan = {
            stage: "junior",
            passActive: false,
            toolPolicy: { allowDocumentMutation: false, noSubagents: true },
        } as unknown as TrainingTurnPlan;
        const next = methodologyBehavior(plan, plan);
        expect(next.toolPolicy).toEqual({ allowDocumentMutation: false, noSubagents: true, methodology: true });
        expect(methodologyBehavior({ stage: "junior", passActive: true }, plan)).toBe(plan);
        expect(methodologyBehavior({ stage: "pasante", passActive: false }, plan)).toBe(plan);
        expect(methodologyBehavior({ stage: null, passActive: false }, plan)).toBe(plan);
    });
});
