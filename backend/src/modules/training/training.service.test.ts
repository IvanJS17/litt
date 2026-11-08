import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { normalizePractice } from "../../lib/training";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";

// Roles and the organization's kind are read from the same in-memory rows.
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    // Project access: a member of the project's organization.
    checkProjectAccess: vi.fn(async (projectId: string, userId: string, _email: unknown, db: Db) => {
        const { data: project } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
        const row = project as { id: string; org_id: string | null; private_to?: string } | null;
        if (!row) return { ok: false };
        if (row.private_to && row.private_to !== userId) return { ok: false };
        const { data: member } = await db
            .from("org_members").select("role").eq("org_id", row.org_id).eq("user_id", userId).maybeSingle();
        return member ? { ok: true, project: row } : { ok: false };
    }),
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

/** The modes of a pasante who owes an approach on a chat with no notes yet, and of anybody else. */
const FIRST_RUNG = { modes: ["hint", "counterpart"], next_hint_level: 1, counterpart_next_step: 1 } as const;
const NO_MODES = { modes: [], next_hint_level: null, counterpart_next_step: null } as const;

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
                detail: { org_id: ORG, target_user_id: PUPIL },
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
        expect(audits.at(-1)).toEqual({
            action: "training.pupil_assigned",
            orgId: ORG,
            detail: { org_id: ORG, target_user_id: PUPIL },
        });
    });

    it("their mentor or an owner or admin releases a pupil; nobody else", async () => {
        withPupil();
        expect(await releasePupil(state.db, { ...as(MENTOR2), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        expect(await releasePupil(state.db, { ...as(PUPIL), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "not_found",
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
            { org_id: ORG, target_user_id: PUPIL },
            { org_id: ORG, target_user_id: PUPIL },
            { org_id: ORG, target_user_id: PUPIL },
        ]);
    });

    it("refuses anybody but the current mentor, and an unknown stage", async () => {
        for (const actor of [OWNER, ADMIN, PUPIL])
            expect(
                await setStage(state.db, { ...as(actor), userId: PUPIL, practice: null, stage: "pasante" }),
            ).toMatchObject({ ok: false, kind: "forbidden" });
        // Anybody else cannot tell this member is in training: same 404 as for a non-pupil.
        const outsiderView = await setStage(state.db, { ...as(MENTOR2), userId: PUPIL, practice: null, stage: "pasante" });
        const nonPupilView = await setStage(state.db, { ...as(MENTOR2), userId: MEMBER, practice: null, stage: "pasante" });
        expect(outsiderView).toEqual(nonPupilView);
        expect(outsiderView).toMatchObject({ ok: false, kind: "not_found" });
        expect(await removeStage(state.db, { ...as(MENTOR2), userId: PUPIL, practice: null })).toEqual(
            await removeStage(state.db, { ...as(MENTOR2), userId: MEMBER, practice: null }),
        );
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
            detail: { org_id: ORG, target_user_id: PUPIL },
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
                candidates: [MENTOR2, MEMBER],
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
            data: { stage: "pasante", attempt_required: true, confidence_required: true, urgency_pass: null, ...FIRST_RUNG },
        });
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, orgId: ORG })).toEqual({
            ok: true,
            data: { stage: null, attempt_required: false, confidence_required: false, urgency_pass: null, ...NO_MODES },
        });
        expect(await getEffectiveTrainingStage(state.db, { userId: MEMBER, projectId: PROJECT })).toEqual({
            ok: true,
            data: { stage: null, attempt_required: false, confidence_required: false, urgency_pass: null, ...NO_MODES },
        });
    });
});

describe("authorization corrections", () => {
    it("an owner or admin cannot move a pupil to themselves", async () => {
        withPupil();
        for (const actor of [OWNER, ADMIN]) {
            rows("training_mentors").push({ org_id: ORG, user_id: actor });
            expect(
                await assignPupil(state.db, { ...as(actor), userId: PUPIL, mentorUserId: actor }),
            ).toMatchObject({ ok: false, kind: "forbidden" });
            expect(
                await assignPupil(state.db, { ...as(actor), userId: PUPIL }),
            ).toMatchObject({ ok: false, kind: "forbidden" });
        }
        expect(rows("training_pupils")[0]).toMatchObject({ mentor_user_id: MENTOR });
        // Moving to somebody else still works, and so does taking a pupil who has no mentor.
        expect(
            await assignPupil(state.db, { ...as(ADMIN), userId: PUPIL, mentorUserId: MENTOR2 }),
        ).toMatchObject({ ok: true });
        expect(await assignPupil(state.db, { ...as(ADMIN), userId: MEMBER })).toMatchObject({ ok: true });
    });

    it("only members with the member role can be pupils, on taking and on moving", async () => {
        for (const target of [OWNER, ADMIN])
            expect(await assignPupil(state.db, { ...as(MENTOR), userId: target })).toMatchObject({
                ok: false,
                kind: "validation",
            });
        withPupil();
        expect(
            await assignPupil(state.db, { ...as(OWNER), userId: ADMIN, mentorUserId: MENTOR2 }),
        ).toMatchObject({ ok: false, kind: "validation" });
        expect(rows("training_pupils")).toHaveLength(1);
        expect(audits).toEqual([]);
        // Candidates are members only.
        expect(await getMyPupils(state.db, as(MENTOR2))).toMatchObject({
            ok: true,
            data: { candidates: [MENTOR, MEMBER] },
        });
    });

    it("a promoted pupil cannot release themselves, while their mentor still can", async () => {
        withPupil();
        state.tables.org_members.find((r) => r.user_id === PUPIL)!.role = "admin";
        expect(await releasePupil(state.db, { ...as(PUPIL), userId: PUPIL })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        expect(await releasePupil(state.db, { ...as(MENTOR), userId: PUPIL })).toMatchObject({ ok: true });
    });

    it("every training audit event carries only org and affected user", async () => {
        await designateMentor(state.db, { ...as(OWNER), userId: MEMBER });
        await assignPupil(state.db, { ...as(MENTOR), userId: PUPIL });
        await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "Fiscal", stage: "pasante" });
        await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "Fiscal", stage: "junior" });
        await removeStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "fiscal" });
        await assignPupil(state.db, { ...as(ADMIN), userId: PUPIL, mentorUserId: MENTOR2 });
        await releasePupil(state.db, { ...as(ADMIN), userId: PUPIL });
        await removeMentor(state.db, { ...as(OWNER), userId: MEMBER });
        expect(audits.map((a) => a.action)).toEqual([
            "training.mentor_designated",
            "training.pupil_assigned",
            "training.stage_set",
            "training.stage_set",
            "training.stage_removed",
            "training.pupil_assigned",
            "training.pupil_released",
            "training.mentor_removed",
        ]);
        for (const event of audits) {
            expect(Object.keys(event.detail as object).sort()).toEqual(["org_id", "target_user_id"]);
            expect(JSON.stringify(event.detail)).not.toMatch(/pasante|junior|fiscal/);
        }
    });
});

describe("practice validation", () => {
    beforeEach(withPupil);

    it("a blank practice is a 400, never 'all practice areas'", async () => {
        for (const practice of ["", "   ", "\t", "\u00a0 \u00a0", "\n"]) {
            expect(
                await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice, stage: "pasante" }),
            ).toMatchObject({ ok: false, kind: "validation" });
            expect(await removeStage(state.db, { ...as(MENTOR), userId: PUPIL, practice })).toMatchObject({
                ok: false,
                kind: "validation",
            });
        }
        expect(rows("training_stages")).toEqual([]);
        // Absent or null still means every practice area.
        expect(
            await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: null, stage: "pasante" }),
        ).toMatchObject({ ok: true, data: { practice: null } });
    });

    it("rejects control characters and labels that lowercase differently in SQL", async () => {
        for (const practice of ["lab\u0000oral", "lab\u0007oral", "İstanbul"])
            expect(
                await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice, stage: "pasante" }),
            ).toMatchObject({ ok: false, kind: "validation" });
    });

    it("stores and resolves with the same normalization", async () => {
        const cases: [string, string][] = [
            ["LABORAL", "laboral"],
            ["  Laboral  ", "laboral"],
            ["Derecho   Civil", "derecho civil"],
            ["Derecho\tCivil", "derecho civil"],
            ["\u00a0Derecho\u00a0Civil\u00a0", "derecho civil"],
            ["Propiedad Intelectual", "propiedad intelectual"],
            ["Penal ÁÉ", "penal áé"],
            ["PENAL AE", "penal ae"],
        ];
        for (const [input, expected] of cases) {
            expect(normalizePractice(input)).toBe(expected);
            expect(normalizePractice(expected)).toBe(expected); // idempotent: a fixed point
            // What the service stores is what lower(btrim(...)) leaves untouched.
            expect(expected).toBe(expected.trim().toLowerCase());
        }
        // Accents are kept as typed: these are different practice areas.
        expect(normalizePractice("penal áé")).not.toBe(normalizePractice("penal ae"));
        expect(normalizePractice("   ")).toBeNull();

        // Set through the service with one spelling, resolved from a project spelled another way.
        await setStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: "Derecho\tCivil", stage: "pasante" });
        expect(rows("training_stages")[0].practice).toBe("derecho civil");
        for (const spelling of ["DERECHO CIVIL", " derecho   civil ", "Derecho\u00a0Civil"]) {
            state.tables.projects[0].practice = spelling;
            expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT })).toEqual({
                ok: true,
                data: { stage: "pasante", attempt_required: true, confidence_required: true, urgency_pass: null, ...FIRST_RUNG },
            });
        }
        state.tables.projects[0].practice = "Derecho Civil Y Mercantil";
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT })).toEqual({
            ok: true,
            data: { stage: null, attempt_required: false, confidence_required: false, urgency_pass: null, ...NO_MODES },
        });
        // Removing uses the same normalization.
        expect(
            await removeStage(state.db, { ...as(MENTOR), userId: PUPIL, practice: " DERECHO\u00a0civil " }),
        ).toMatchObject({ ok: true });
    });
});

describe("GET /training/stage with an urgency pass (layer 2)", () => {
    const pass = (extra: Row = {}): Row => ({
        org_id: ORG,
        trainee_user_id: PUPIL,
        project_id: PROJECT,
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: "2999-01-01T00:00:00.000Z",
        revoked_at: null,
        ...extra,
    });
    beforeEach(() => {
        withPupil();
        rows("training_stages").push({ org_id: ORG, trainee_user_id: PUPIL, practice: null, stage: "pasante" });
    });

    it("keeps the stage and lifts the attempt on the project while the pass is in force", async () => {
        state.tables.training_urgency_passes = [pass()];
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT })).toEqual({
            ok: true,
            data: {
                stage: "pasante",
                attempt_required: false,
                confidence_required: false,
                urgency_pass: { project_id: PROJECT, expires_at: "2999-01-01T00:00:00.000Z" },
                // A pass lifts the approach, and with it the modes (hints, counterpart).
                ...NO_MODES,
            },
        });
    });

    it("asks for the attempt outside the project, with an expired pass, and in Word", async () => {
        state.tables.training_urgency_passes = [pass()];
        const required = { stage: "pasante", attempt_required: true, confidence_required: true, urgency_pass: null, ...FIRST_RUNG };
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, orgId: ORG })).toEqual({
            ok: true,
            data: required,
        });
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, surface: "word" })).toEqual({
            ok: true,
            data: required,
        });
        state.tables.training_urgency_passes = [pass({ expires_at: new Date(Date.now() - 1000).toISOString() })];
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT })).toEqual({
            ok: true,
            data: required,
        });
    });
});

describe("GET /training/stage: the modes and the rung the next hint would be", () => {
    const CHAT = id(300);
    const note = (mode: string | null, step: number | null, seconds: number, over: Row = {}): Row => ({
        trainee_user_id: PUPIL,
        chat_id: CHAT,
        word_chat_id: null,
        tabular_chat_id: null,
        mode,
        step,
        attempt: "intento",
        created_at: new Date(Date.UTC(2026, 10, 8, 12, 0, seconds)).toISOString(),
        ...over,
    });
    const stage = async (args: Record<string, unknown> = {}, userId = PUPIL) => {
        const result = await getEffectiveTrainingStage(state.db, { userId, projectId: PROJECT, chatId: CHAT, ...args });
        if (!result.ok) throw new Error(result.kind);
        return result.data;
    };
    beforeEach(() => {
        withPupil();
        rows("training_stages").push({ org_id: ORG, trainee_user_id: PUPIL, practice: null, stage: "pasante" });
        state.tables.training_turn_notes = [];
    });

    it("counts the rungs from the caller's own notes, and closes the ladder after three", async () => {
        expect(await stage()).toMatchObject({ modes: ["hint", "counterpart"], next_hint_level: 1, counterpart_next_step: 1 });
        rows("training_turn_notes").push(note("hint", 1, 1));
        expect(await stage()).toMatchObject({ next_hint_level: 2 });
        rows("training_turn_notes").push(note("hint", 2, 2), note("hint", 3, 3));
        expect(await stage()).toMatchObject({ modes: ["counterpart"], next_hint_level: null });
        // The full answer starts the ladder over.
        rows("training_turn_notes").push(note(null, null, 4));
        expect(await stage()).toMatchObject({ modes: ["hint", "counterpart"], next_hint_level: 1 });
    });

    it("offers the round while it has turns left, and the close once it has begun", async () => {
        rows("training_turn_notes").push(note("counterpart", 1, 1), note("counterpart", 2, 2));
        expect(await stage()).toMatchObject({ modes: ["hint", "counterpart", "counterpart_close"], counterpart_next_step: 3 });
        rows("training_turn_notes").push(note("counterpart", 3, 3));
        expect(await stage()).toMatchObject({ modes: ["hint", "counterpart_close"], counterpart_next_step: null });
        rows("training_turn_notes").push(note("counterpart_close", 3, 4));
        expect(await stage()).toMatchObject({ modes: ["hint", "counterpart"], counterpart_next_step: 1 });
    });

    it("ignores another person's notes and a chat id that is not a uuid", async () => {
        rows("training_turn_notes").push(note("hint", 1, 1, { trainee_user_id: MEMBER }), note("hint", 2, 2, { trainee_user_id: MEMBER }));
        expect(await stage()).toMatchObject({ next_hint_level: 1 });
        rows("training_turn_notes").push(note("hint", 1, 3));
        expect(await stage({ chatId: "not-a-uuid" })).toMatchObject({ next_hint_level: 1 });
        expect(await stage({ chatId: undefined })).toMatchObject({ next_hint_level: 1 });
    });

    it("finds a Word chat by its own column", async () => {
        rows("training_turn_notes").push(note("hint", 1, 1, { chat_id: null, word_chat_id: CHAT }));
        expect(await stage({ surface: "word", projectId: undefined })).toMatchObject({ next_hint_level: 2 });
    });

    it("offers nothing to anybody the turn owes no approach: another stage, no stage, an urgency pass", async () => {
        rows("training_stages")[0].stage = "junior";
        expect(await stage()).toMatchObject(NO_MODES);
        expect(await stage({}, MEMBER)).toMatchObject(NO_MODES);
        rows("training_stages")[0].stage = "pasante";
        state.tables.training_urgency_passes = [
            {
                org_id: ORG,
                trainee_user_id: PUPIL,
                project_id: PROJECT,
                starts_at: new Date(Date.now() - 60_000).toISOString(),
                expires_at: "2999-01-01T00:00:00.000Z",
                revoked_at: null,
            },
        ];
        expect(await stage()).toMatchObject(NO_MODES);
    });

    it("answers an internal failure when the notes cannot be read, not a guessed rung", async () => {
        state.failNext("training_turn_notes", "select", { message: "down" });
        expect(await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId: PROJECT, chatId: CHAT })).toMatchObject({
            ok: false,
            kind: "error",
        });
    });
});

describe("GET /training/stage project access", () => {
    beforeEach(() => {
        withPupil();
        rows("training_stages").push({ org_id: ORG, trainee_user_id: PUPIL, practice: "laboral", stage: "pasante" });
    });

    it("answers 404 for a project the caller cannot open, and for a malformed or missing one", async () => {
        const secret = id(201);
        rows("projects").push({ id: secret, org_id: ORG, practice: "Fiscal", private_to: OWNER });
        for (const projectId of [secret, id(999), "not-a-uuid"])
            expect(
                await getEffectiveTrainingStage(state.db, { userId: PUPIL, projectId }),
            ).toMatchObject({ ok: false, kind: "not_found" });
        // Somebody outside the organization gets the same answer for a real project.
        expect(
            await getEffectiveTrainingStage(state.db, { userId: OUTSIDER, projectId: PROJECT }),
        ).toMatchObject({ ok: false, kind: "not_found" });
    });
});
