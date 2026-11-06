import { describe, expect, it } from "vitest";
import { memoryDb } from "../__tests__/helpers/memoryDb";
import {
    checkTrainingTurn,
    normalizePractice,
    pickEffectiveStage,
    resolveTrainingStage,
    resolveWordTrainingStage,
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
            organizations: [
                { id: ORG, kind: "team", deleted_at: null },
                { id: OTHER_ORG, kind: "team", deleted_at: null },
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

    it("resolves the Word stage through resolveWordTrainingStage", async () => {
        const { db } = setup();
        expect(await resolveTrainingStage(db, USER, { anyOrganization: true })).toBe("pasante");
    });

    it("fails instead of answering none when the stages cannot be read", async () => {
        const { db, failNext } = setup();
        failNext("training_stages", "select", { message: "down" });
        await expect(resolveTrainingStage(db, USER, { orgId: ORG })).rejects.toThrow();
    });
});

describe("resolveWordTrainingStage", () => {
    const THIRD_ORG = "00000000-0000-4000-8000-000000000012";
    const stage = (org_id: string, stage: string, practice: string | null = null) => ({
        org_id,
        trainee_user_id: USER,
        practice,
        stage,
    });
    const orgs = (...rows: { id: string; deleted_at?: string | null; kind?: string }[]) =>
        rows.map((r) => ({ kind: "team", deleted_at: null, ...r }));

    it("is none without any general stage, even with a stage in one practice area", async () => {
        const { db } = memoryDb({
            training_stages: [stage(ORG, "pasante", "laboral")],
            organizations: orgs({ id: ORG }),
        });
        expect(await resolveWordTrainingStage(db, USER)).toEqual({ stage: null, orgId: null });
    });

    it("lets a pasante in one organization win over a junior in another", async () => {
        const { db } = memoryDb({
            training_stages: [stage(ORG, "junior"), stage(OTHER_ORG, "pasante")],
            organizations: orgs({ id: ORG }, { id: OTHER_ORG }),
        });
        expect(await resolveWordTrainingStage(db, USER)).toEqual({
            stage: "pasante",
            orgId: OTHER_ORG,
        });
    });

    it("falls to junior when that is the most junior general stage", async () => {
        const { db } = memoryDb({
            training_stages: [stage(OTHER_ORG, "junior")],
            organizations: orgs({ id: OTHER_ORG }),
        });
        expect(await resolveWordTrainingStage(db, USER)).toEqual({
            stage: "junior",
            orgId: OTHER_ORG,
        });
    });

    it("excludes deleted organizations and a stage in an unknown one", async () => {
        const { db } = memoryDb({
            training_stages: [stage(ORG, "pasante"), stage(OTHER_ORG, "junior"), stage(THIRD_ORG, "pasante")],
            organizations: orgs({ id: ORG, deleted_at: "2026-11-01T00:00:00Z" }, { id: OTHER_ORG }),
        });
        expect(await resolveWordTrainingStage(db, USER)).toEqual({
            stage: "junior",
            orgId: OTHER_ORG,
        });
    });

    it("breaks ties between organizations by the lowest id", async () => {
        const { db } = memoryDb({
            training_stages: [stage(OTHER_ORG, "pasante"), stage(ORG, "pasante")],
            organizations: orgs({ id: ORG }, { id: OTHER_ORG }),
        });
        expect((await resolveWordTrainingStage(db, USER)).orgId).toBe(ORG);
    });

    it("fails instead of answering none when the stages cannot be read", async () => {
        const { db, failNext } = memoryDb({ training_stages: [], organizations: [] });
        failNext("training_stages", "select", { message: "down" });
        await expect(resolveWordTrainingStage(db, USER)).rejects.toThrow();
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
    it("answers an attempt over 4000 characters with its own message", () => {
        const tooLong = checkTrainingTurn("pasante", "x".repeat(4001));
        expect(tooLong).toMatchObject({ ok: false, status: 400, code: "training_attempt_required" });
        expect((tooLong as { detail: string }).detail).toContain("demasiado largo");
        expect((tooLong as { detail: string }).detail).not.toContain("mínimo");
        expect(checkTrainingTurn("pasante", "x".repeat(4000))).toMatchObject({ ok: true });
    });
    it("counts characters, not UTF-16 units", () => {
        expect(checkTrainingTurn("pasante", "😀".repeat(59))).toMatchObject({ ok: false });
        expect(checkTrainingTurn("pasante", "😀".repeat(60))).toMatchObject({ ok: true });
    });
    it("ignores the attempt of a junior or a lawyer", () => {
        expect(checkTrainingTurn("junior", sixty)).toEqual({ ok: true, attempt: null });
        expect(checkTrainingTurn(null, undefined)).toEqual({ ok: true, attempt: null });
    });
});
