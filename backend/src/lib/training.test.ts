import { describe, expect, it } from "vitest";
import { memoryDb } from "../__tests__/helpers/memoryDb";
import {
    checkTrainingTurn,
    normalizePractice,
    pickEffectiveStage,
    resolveTrainingStage,
} from "./training";

const ORG = "00000000-0000-4000-8000-000000000010";
const OTHER_ORG = "00000000-0000-4000-8000-000000000011";
const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000020";

describe("normalizePractice", () => {
    it("trims and lowercases, and treats blanks and non-strings as none", () => {
        expect(normalizePractice("  Laboral ")).toBe("laboral");
        expect(normalizePractice("   ")).toBeNull();
        expect(normalizePractice(undefined)).toBeNull();
        expect(normalizePractice(3)).toBeNull();
    });
});

describe("pickEffectiveStage", () => {
    const rows = [
        { practice: "laboral", stage: "pasante" },
        { practice: null, stage: "junior" },
    ];
    it("prefers the exact practice area, matched after normalization", () => {
        expect(pickEffectiveStage(rows, " LABORAL")).toBe("pasante");
    });
    it("falls back to the stage for every practice area", () => {
        expect(pickEffectiveStage(rows, "fiscal")).toBe("junior");
        expect(pickEffectiveStage(rows, null)).toBe("junior");
    });
    it("is none without a matching or general stage", () => {
        expect(pickEffectiveStage([{ practice: "laboral", stage: "pasante" }], "fiscal")).toBeNull();
        expect(pickEffectiveStage([], "laboral")).toBeNull();
    });
});

describe("resolveTrainingStage", () => {
    const setup = () =>
        memoryDb({
            training_stages: [
                { org_id: ORG, trainee_user_id: USER, practice: "laboral", stage: "pasante" },
                { org_id: ORG, trainee_user_id: USER, practice: null, stage: "junior" },
                { org_id: OTHER_ORG, trainee_user_id: USER, practice: null, stage: "pasante" },
            ],
            projects: [{ id: PROJECT, practice: null }],
            matters: [{ project_id: PROJECT, practice: " Laboral" }],
        });

    it("is always none in the personal space", async () => {
        const { db } = setup();
        expect(await resolveTrainingStage(db, USER, { orgId: null, projectId: PROJECT })).toBeNull();
    });

    it("uses the linked matter's practice area when the project has none", async () => {
        const { db } = setup();
        expect(await resolveTrainingStage(db, USER, { orgId: ORG, projectId: PROJECT })).toBe("pasante");
    });

    it("prefers the project's own practice area", async () => {
        const { db, tables } = setup();
        tables.projects[0].practice = "Fiscal";
        expect(await resolveTrainingStage(db, USER, { orgId: ORG, projectId: PROJECT })).toBe("junior");
    });

    it("applies the general stage outside a project, and nothing to a lawyer", async () => {
        const { db } = setup();
        expect(await resolveTrainingStage(db, USER, { orgId: ORG })).toBe("junior");
        expect(
            await resolveTrainingStage(db, "00000000-0000-4000-8000-000000000002", { orgId: ORG }),
        ).toBeNull();
    });

    it("in the Word add-in, takes a general pasante stage from any organization", async () => {
        const { db } = setup();
        expect(await resolveTrainingStage(db, USER, { anyOrganization: true })).toBe("pasante");
    });

    it("fails instead of answering none when the stages cannot be read", async () => {
        const { db, failNext } = setup();
        failNext("training_stages", "select", { message: "down" });
        await expect(resolveTrainingStage(db, USER, { orgId: ORG })).rejects.toThrow();
    });
});

describe("checkTrainingTurn", () => {
    const sixty = "x".repeat(60);
    it("requires a pasante's attempt of at least 60 characters after trimming", () => {
        expect(checkTrainingTurn("pasante", undefined)).toMatchObject({
            ok: false,
            status: 400,
            code: "training_attempt_required",
        });
        expect(checkTrainingTurn("pasante", `   ${"x".repeat(59)}   `)).toMatchObject({ ok: false });
        expect(checkTrainingTurn("pasante", ` ${sixty} `)).toEqual({ ok: true, attempt: sixty });
    });
    it("ignores the attempt of a junior or a lawyer", () => {
        expect(checkTrainingTurn("junior", sixty)).toEqual({ ok: true, attempt: null });
        expect(checkTrainingTurn(null, undefined)).toEqual({ ok: true, attempt: null });
    });
});
