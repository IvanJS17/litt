import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";

// Roles and the organization's kind are read from the same in-memory rows.
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    getOrgRole: vi.fn(async (userId: string, orgId: string, db: Db) => {
        const { data } = await db
            .from("org_members")
            .select("role")
            .eq("org_id", orgId)
            .eq("user_id", userId)
            .maybeSingle();
        return (data as { role?: string } | null)?.role ?? null;
    }),
}));
vi.mock("../../lib/personalOrgs", () => ({
    isPersonalOrg: vi.fn(async (db: Db, orgId: string) => {
        const { data } = await db.from("organizations").select("kind").eq("id", orgId).maybeSingle();
        return (data as { kind?: string } | null)?.kind === "personal";
    }),
}));
const { audits } = vi.hoisted(() => ({ audits: [] as { action: string; detail: unknown; orgId: unknown }[] }));
vi.mock("../../lib/audit", () => ({
    recordAudit: vi.fn(async (_db: unknown, event: { action: string; detail: unknown; orgId: unknown }) => {
        audits.push({ action: event.action, detail: event.detail, orgId: event.orgId });
    }),
}));

import {
    assignPupil,
    designateMentor,
    getEffectiveTrainingStage,
    getMyPupils,
    getMyTraining,
    getOrgTraining,
    releasePupil,
    removeMentor,
    removeStage,
    setStage,
} from "./training.service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const PERSONAL = id(101);
const OWNER = id(1);
const ADMIN = id(2);
const MENTOR = id(3);
const MENTOR2 = id(4);
const PUPIL = id(5);
const MEMBER = id(6);
const OUTSIDER = id(7);
const PROJECT = id(200);

let state: ReturnType<typeof memoryDb>;
const as = (actorId: string, orgId = ORG) => ({ actorId, orgId, actorEmail: null });
const rows = (table: string): Row[] => state.tables[table] ?? [];

beforeEach(() => {
    audits.length = 0;
    state = memoryDb({
        organizations: [
            { id: ORG, kind: "team" },
            { id: PERSONAL, kind: "personal" },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: ADMIN, role: "admin" },
            { org_id: ORG, user_id: MENTOR, role: "member" },
            { org_id: ORG, user_id: MENTOR2, role: "member" },
            { org_id: ORG, user_id: PUPIL, role: "member" },
            { org_id: ORG, user_id: MEMBER, role: "member" },
            { org_id: PERSONAL, user_id: OWNER, role: "owner" },
        ],
        training_mentors: [
            { org_id: ORG, user_id: MENTOR },
            { org_id: ORG, user_id: MENTOR2 },
        ],
        training_pupils: [],
        training_stages: [],
        projects: [{ id: PROJECT, org_id: ORG, practice: "Laboral" }],
        matters: [],
    });
});

const withPupil = () => {
    rows("training_pupils").push({ org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR });
};

describe("mentors", () => {
    it("an owner or admin designates a member as mentor, once, with an audit event", async () => {
        expect(await designateMentor(state.db, { ...as(ADMIN), userId: MEMBER })).toEqual({
            ok: true,
            data: { user_id: MEMBER },
        });
        expect(await designateMentor(state.db, { ...as(OWNER), userId: MEMBER })).toMatchObject({ ok: true });
        expect(rows("training_mentors").filter((r) => r.user_id === MEMBER)).toHaveLength(1);
        expect(audits).toEqual([
            {
                action: "training.mentor_designated",
                orgId: ORG,
                detail: { org_id: ORG, target_user_id: MEMBER },
            },
        ]);
    });

    it("refuses a member, an outsider target, an outsider actor and a personal space", async () => {
        expect(await designateMentor(state.db, { ...as(MENTOR), userId: MEMBER })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await designateMentor(state.db, { ...as(ADMIN), userId: OUTSIDER })).toMatchObject({
            ok: false,
            kind: "validation",
        });
        expect(await designateMentor(state.db, { ...as(OUTSIDER), userId: MEMBER })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        expect(
            await designateMentor(state.db, { ...as(OWNER, PERSONAL), userId: OWNER }),
        ).toMatchObject({ ok: false, kind: "not_found" });
        expect(audits).toEqual([]);
    });

    it("does not retire a mentor who still has pupils", async () => {
        withPupil();
        expect(await removeMentor(state.db, { ...as(OWNER), userId: MENTOR })).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "training_mentor_has_pupils",
        });
        expect(rows("training_mentors").some((r) => r.user_id === MENTOR)).toBe(true);
    });

    it("an owner or admin retires a mentor without pupils; a member cannot", async () => {
        expect(await removeMentor(state.db, { ...as(MENTOR2), userId: MENTOR })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await removeMentor(state.db, { ...as(ADMIN), userId: MENTOR })).toEqual({ ok: true, data: null });
        expect(rows("training_mentors").some((r) => r.user_id === MENTOR)).toBe(false);
        expect(audits.map((a) => a.action)).toEqual(["training.mentor_removed"]);
    });
});

describe("pupils", () => {
    it("a mentor takes a member without a mentor", async () => {
        expect(await assignPupil(state.db, { ...as(MENTOR), userId: PUPIL })).toEqual({
            ok: true,
            data: { trainee_user_id: PUPIL, mentor_user_id: MENTOR },
        });
        expect(audits).toEqual([
            {
                action: "training.pupil_assigned",
                orgId: ORG,
                detail: {
                    org_id: ORG,
                    target_user_id: PUPIL,
                    mentor_user_id: MENTOR,
                    previous_mentor_user_id: null,
                },
            },
        ]);
    });

    it("refuses a non-mentor, a pupil of themselves and an outsider", async () => {
        expect(await assignPupil(state.db, { ...as(MEMBER), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await assignPupil(state.db, { ...as(MENTOR), userId: MENTOR })).toMatchObject({
            ok: false,
            kind: "validation",
        });
        expect(await assignPupil(state.db, { ...as(MENTOR), userId: OUTSIDER })).toMatchObject({
            ok: false,
            kind: "validation",
        });
        expect(rows("training_pupils")).toEqual([]);
    });

    it("only an owner or admin moves a pupil who already has a mentor", async () => {
        withPupil();
        expect(await assignPupil(state.db, { ...as(MENTOR2), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "training_pupil_has_mentor",
        });
        expect(
            await assignPupil(state.db, { ...as(MENTOR), userId: PUPIL, mentorUserId: MENTOR2 }),
        ).toMatchObject({ ok: false, kind: "forbidden" });
        expect(
            await assignPupil(state.db, { ...as(ADMIN), userId: PUPIL, mentorUserId: MEMBER }),
        ).toMatchObject({ ok: false, kind: "validation" });
        expect(
            await assignPupil(state.db, { ...as(ADMIN), userId: PUPIL, mentorUserId: MENTOR2 }),
        ).toMatchObject({ ok: true });
        expect(rows("training_pupils")).toEqual([
            expect.objectContaining({ trainee_user_id: PUPIL, mentor_user_id: MENTOR2, assigned_by: ADMIN }),
        ]);
        expect(audits.at(-1)).toMatchObject({
            action: "training.pupil_assigned",
            detail: { previous_mentor_user_id: MENTOR, mentor_user_id: MENTOR2 },
        });
    });

    it("their mentor or an owner or admin releases a pupil; nobody else", async () => {
        withPupil();
        expect(await releasePupil(state.db, { ...as(MENTOR2), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await releasePupil(state.db, { ...as(PUPIL), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await releasePupil(state.db, { ...as(MENTOR), userId: PUPIL })).toEqual({ ok: true, data: null });
        expect(rows("training_pupils")).toEqual([]);
        withPupil();
        expect(await releasePupil(state.db, { ...as(OWNER), userId: PUPIL })).toMatchObject({ ok: true });
        expect(audits.map((a) => a.action)).toEqual(["training.pupil_released", "training.pupil_released"]);
    });
});

describe("stages", () => {
    beforeEach(withPupil);

    it("the current mentor sets a normalized stage per practice area and changes it", async () => {
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "  Laboral ", stage: "pasante" }),
        ).toEqual({ ok: true, data: { practice: "laboral", stage: "pasante" } });
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "laboral", stage: "junior" }),
        ).toMatchObject({ ok: true });
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: null, stage: "pasante" }),
        ).toMatchObject({ ok: true });
        expect(rows("training_stages").map((r) => [r.practice, r.stage])).toEqual([
            ["laboral", "junior"],
            [null, "pasante"],
        ]);
        expect(audits.map((a) => a.detail)).toEqual([
            { org_id: ORG, target_user_id: PUPIL, practice: "laboral", stage: "pasante", previous_stage: null },
            { org_id: ORG, target_user_id: PUPIL, practice: "laboral", stage: "junior", previous_stage: "pasante" },
            { org_id: ORG, target_user_id: PUPIL, practice: null, stage: "pasante", previous_stage: null },
        ]);
    });

    it("refuses anybody but the current mentor, and an unknown stage", async () => {
        for (const actor of [OWNER, ADMIN, MENTOR2, PUPIL])
            expect(
                await setStage(state.db, { ...as(actor), userId: PUPIL, practice: null, stage: "pasante" }),
            ).toMatchObject({ ok: false, kind: "forbidden" });
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: null, stage: "socio" }),
        ).toMatchObject({ ok: false, kind: "validation" });
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: MEMBER, practice: null, stage: "pasante" }),
        ).toMatchObject({ ok: false, kind: "not_found" });
        expect(rows("training_stages")).toEqual([]);
    });

    it("the current mentor removes a stage, with an audit event", async () => {
        await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "Fiscal", stage: "junior" });
        expect(await removeStage(state.db, { ...as(ADMIN), userId: PUPIL, practice: "fiscal" })).toMatchObject({
            ok: false,
            kind: "forbidden",
        });
        expect(await removeStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: " FISCAL" })).toEqual({
            ok: true,
            data: null,
        });
        expect(await removeStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "fiscal" })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        expect(audits.at(-1)).toEqual({
            action: "training.stage_removed",
            orgId: ORG,
            detail: { org_id: ORG, target_user_id: PUPIL, practice: "fiscal", stage: "junior" },
        });
    });
});

describe("reads", () => {
    beforeEach(() => {
        withPupil();
        rows("training_stages").push({ org_id: ORG, trainee_user_id: PUPIL, practice: "laboral", stage: "pasante" });
    });

    it("the pupil sees their mentor and stages", async () => {
        expect(await getMyTraining(state.db, { userId: PUPIL })).toEqual({
            ok: true,
            data: {
                memberships: [
                    {
                        org_id: ORG,
                        is_mentor: false,
                        mentor_user_id: MENTOR,
                        stages: [{ practice: "laboral", stage: "pasante" }],
                    },
                ],
            },
        });
        expect(await getMyTraining(state.db, { userId: MEMBER })).toEqual({ ok: true, data: { memberships: [] } });
    });

    it("the mentor sees their pupils' stages and who they could take on", async () => {
        expect(await getMyPupils(state.db, as(MENTOR))).toEqual({
            ok: true,
            data: {
                pupils: [{ user_id: PUPIL, stages: [{ practice: "laboral", stage: "pasante" }] }],
                candidates: [OWNER, ADMIN, MENTOR2, MEMBER],
            },
        });
        expect(await getMyPupils(state.db, as(ADMIN))).toMatchObject({ ok: false, kind: "forbidden" });
    });

    it("an owner or admin sees who mentors whom, never the stages", async () => {
        const overview = await getOrgTraining(state.db, as(OWNER));
        expect(overview).toEqual({
            ok: true,
            data: {
                mentors: [MENTOR, MENTOR2],
                pupils: [{ trainee_user_id: PUPIL, mentor_user_id: MENTOR }],
            },
        });
        expect(JSON.stringify(overview)).not.toContain("pasante");
        expect(await getOrgTraining(state.db, as(MENTOR))).toMatchObject({ ok: false, kind: "forbidden" });
    });

    it("tells the client the caller's effective stage in a project", async () => {
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT })).toEqual({
            ok: true,
            data: { stage: "pasante" },
        });
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, orgId: ORG })).toEqual({
            ok: true,
            data: { stage: null },
        });
        expect(await getEffectiveTrainingStage(state.db, { userId: MEMBER, projectId: PROJECT })).toEqual({
            ok: true,
            data: { stage: null },
        });
    });
});
