import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { generateDefenseQuestions, listDefenses, recordDefenseOutcome } from "./trainingSupervision.defenses";
import { listUrgencyPasses } from "./trainingSupervision.passes";

// A defense's questions and a pass's note come from a pupil's work in a
// matter. The pupil's current mentor reads them only while they can open that
// matter; the rule itself is the matter gate's (lib/access), asked here.
const matters = vi.hoisted(() => ({ open: new Set<string>(), failing: false }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError,
}));
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    checkProjectAccess: vi.fn(async (projectId: string) => {
        if (matters.failing) throw new Error("access lookup down");
        return { ok: matters.open.has(projectId) };
    }),
    loadOpenableProjects: vi.fn(async (_db: unknown, _user: string, _email: unknown, projectIds: string[]) => {
        if (matters.failing) throw new Error("access lookup down");
        return new Map(projectIds.filter((id) => matters.open.has(id)).map((id) => [id, { orgId: null }]));
    }),
}));
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
    completeSupervision: vi.fn(async () => "generated"),
    parseDefenseQuestions: vi.fn(() => QUESTIONS_GENERATED),
}));

const QUESTIONS_GENERATED = vi.hoisted(() => [{ kind: "base", text: "Pregunta generada", listen_for: "razón" }]);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const PUPIL = id(1);
const MENTOR = id(2);
const OPEN_MATTER = id(30);
const CLOSED_MATTER = id(31);
const actor = { actorId: MENTOR, actorEmail: "mentor@example.test", orgId: ORG, traineeId: PUPIL };
const QUESTIONS = [
    ...[1, 2, 3, 4].map((n) => ({ kind: "base", text: `Pregunta ${n} sobre el contrato de Acme`, listen_for: "razón" })),
    { kind: "cambio_de_hechos", text: "Si cambian los hechos", listen_for: "ajuste" },
];

const defense = (over: Row): Row => ({
    org_id: ORG, trainee_user_id: PUPIL, practice: null, work_review_id: null,
    questions: QUESTIONS, questions_status: "ready", outcome: "approved", outcome_reason: "razonamiento_solido",
    outcome_note: "Nota sobre el asunto Acme", held_at: "2026-11-10T10:00:00Z",
    created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z", ...over,
});

function world(defenses: Row[], passes: Row[] = [], notes: Row[] = []) {
    return memoryDb(
        {
            training_defenses: defenses,
            training_turn_notes: notes,
            training_urgency_passes: passes,
            training_work_reviews: [
                { id: id(40), org_id: ORG, trainee_user_id: PUPIL, chat_id: id(50), word_chat_id: null, tabular_chat_id: null },
                { id: id(41), org_id: ORG, trainee_user_id: PUPIL, chat_id: id(51), word_chat_id: null, tabular_chat_id: null },
            ],
            chats: [
                { id: id(50), project_id: OPEN_MATTER, title: "abierto" },
                { id: id(51), project_id: CLOSED_MATTER, title: "cerrado" },
            ],
        },
        { training_can_read_learning: () => true },
    );
}

beforeEach(() => {
    reportError.mockClear();
    matters.open = new Set([OPEN_MATTER]);
    matters.failing = false;
});

const listed = async (rows: Row[]) => {
    const result = await listDefenses(world(rows).db, actor);
    if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
    return result.data.defenses;
};

describe("the current mentor reads a defense only for matters they can open", () => {
    it("withholds the questions and the note of a defense on a work in a matter they cannot open", async () => {
        const [closed, open] = await listed([
            defense({ id: id(60), work_review_id: id(41) }),
            defense({ id: id(61), work_review_id: id(40) }),
        ]);
        expect(closed).toMatchObject({ id: id(60), questions: null, outcome_note: null, outcome: "approved" });
        expect(open.questions).toHaveLength(5);
        expect(open.outcome_note).toBe("Nota sobre el asunto Acme");
    });

    it("withholds a practice-area defense when any matter its questions rest on is closed, and fails closed on legacy rows", async () => {
        const rows = await listed([
            defense({ id: id(62), source_project_ids: [OPEN_MATTER] }),
            defense({ id: id(63), source_project_ids: [OPEN_MATTER, CLOSED_MATTER] }),
            defense({ id: id(64), source_project_ids: null }),
            defense({ id: id(65), source_project_ids: [] }),
        ]);
        const byId = new Map(rows.map((row) => [row.id, row]));
        expect(byId.get(id(62))!.questions).toHaveLength(5);
        expect(byId.get(id(63))!.questions).toBeNull();
        expect(byId.get(id(64))!.questions).toBeNull();
        expect(byId.get(id(64))!.outcome_note).toBeNull();
        expect(byId.get(id(65))!.questions).toHaveLength(5);
        expect(JSON.stringify(rows.filter((row) => row.id !== id(62) && row.id !== id(65)))).not.toContain("Acme");
    });

    it("withholds a defense linked to a work review that no longer exists", async () => {
        const [row] = await listed([defense({ id: id(68), work_review_id: id(99) })]);
        expect(row).toMatchObject({ id: id(68), questions: null, outcome_note: null, outcome: "approved" });
    });

    it("leaves a defense with no questions and no note as it is", async () => {
        const [row] = await listed([defense({ id: id(66), questions: null, questions_status: "none", outcome: null, outcome_reason: null, outcome_note: null, held_at: null })]);
        expect(row).toMatchObject({ id: id(66), questions: null, outcome_note: null });
    });

    it("fails, rather than shows the questions, when the matters cannot be checked", async () => {
        matters.failing = true;
        const result = await listDefenses(world([defense({ id: id(67), work_review_id: id(40) })]).db, actor);
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("recording an outcome returns the defense as a list of them does", () => {
    const body = { outcome: "approved", reason: "razonamiento_solido", note: "Nota de la defensa" };
    const pending = (over: Row) => defense({ outcome: null, outcome_reason: null, outcome_note: null, held_at: null, ...over });
    const record = async (rows: Row[], defenseId: string) => {
        const { db, tables } = world(rows);
        const result = await recordDefenseOutcome(db, { ...actor, defenseId, body });
        if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
        return { defense: result.data, stored: tables.training_defenses.find((row) => row.id === defenseId)! };
    };

    it("records the outcome but does not return the questions or the note of work in a matter the mentor cannot open", async () => {
        const { defense: returned, stored } = await record([pending({ id: id(80), work_review_id: id(41) })], id(80));
        expect(stored).toMatchObject({ outcome: "approved", outcome_note: "Nota de la defensa" });
        expect(returned).toMatchObject({ id: id(80), outcome: "approved", questions: null, outcome_note: null });
        expect(JSON.stringify(returned)).not.toContain("Acme");
    });

    it("withholds them from a defense whose matters were not recorded", async () => {
        const { defense: returned } = await record([pending({ id: id(81), source_project_ids: null })], id(81));
        expect(returned).toMatchObject({ outcome: "approved", questions: null, outcome_note: null });
    });

    it("keeps the note of a defense recorded without questions: it rests on no work", async () => {
        const rows = [pending({ id: id(84), questions: null, questions_status: "none" })];
        const { defense: returned, stored } = await record(rows, id(84));
        expect(returned).toMatchObject({ outcome: "approved", outcome_note: "Nota de la defensa" });
        expect(stored.source_project_ids).toEqual([]);
        // And a later list shows it too, to whoever is the mentor then.
        expect((await listed([stored]))[0].outcome_note).toBe("Nota de la defensa");
    });

    it("returns them for work in a matter the mentor can open", async () => {
        const { defense: returned } = await record([pending({ id: id(82), work_review_id: id(40) })], id(82));
        expect(returned.questions).toHaveLength(5);
        expect(returned.outcome_note).toBe("Nota de la defensa");
    });

    it("answers that the outcome was recorded, without the questions or the note, and reports the failure, when the matters cannot be checked", async () => {
        matters.failing = true;
        const { db, tables } = world([pending({ id: id(83), work_review_id: id(41) })]);
        const result = await recordDefenseOutcome(db, { ...actor, defenseId: id(83), body });
        // The write happened: it is not answered as an error, so a retry is not told it was already recorded.
        expect(result).toMatchObject({ ok: true, data: { id: id(83), outcome: "approved", questions: null, outcome_note: null } });
        expect(tables.training_defenses[0]).toMatchObject({ outcome: "approved" });
        expect(JSON.stringify(result)).not.toContain("Acme");
        expect(reportError).toHaveBeenCalledTimes(1);
    });

    /** A question generation commits to `row` between the load of the defense and the write of its outcome. */
    const generatedBeforeWrite = (db: ReturnType<typeof world>["db"], row: Row, change: Row) => {
        const from = db.from.bind(db);
        let generated = false;
        (db as unknown as { from: (table: string) => unknown }).from = (table: string) => {
            const query = from(table) as unknown as Record<string, unknown>;
            if (table !== "training_defenses") return query;
            const update = (query.update as (...args: unknown[]) => unknown).bind(query);
            query.update = (...args: unknown[]) => {
                if (!generated) {
                    generated = true;
                    Object.assign(row, change);
                }
                return update(...args);
            };
            return query;
        };
    };

    it("does not overwrite the matters of questions generated after the outcome was loaded", async () => {
        const { db, tables } = world([pending({ id: id(85), questions: null, questions_status: "none" })]);
        generatedBeforeWrite(db, tables.training_defenses[0], { questions: QUESTIONS, questions_status: "ready", source_project_ids: [CLOSED_MATTER] });
        const result = await recordDefenseOutcome(db, { ...actor, defenseId: id(85), body });
        expect(tables.training_defenses[0].source_project_ids).toEqual([CLOSED_MATTER]);
        // Their questions rest on a matter the mentor cannot open: the answer says so.
        expect(result).toMatchObject({ ok: true, data: { questions: null, outcome_note: null } });
    });

    it("does not mark as resting on no work questions that were written meanwhile without recording their matters", async () => {
        const { db, tables } = world([pending({ id: id(86), questions: null, questions_status: "none" })]);
        generatedBeforeWrite(db, tables.training_defenses[0], { questions: QUESTIONS, questions_status: "ready", source_project_ids: null });
        const result = await recordDefenseOutcome(db, { ...actor, defenseId: id(86), body });
        expect(tables.training_defenses[0].source_project_ids).toBeNull();
        // Their questions rest on a matter the mentor cannot open: the answer says so.
        expect(result).toMatchObject({ ok: true, data: { questions: null, outcome_note: null } });
    });
});

describe("the matters new questions rest on are recorded with them", () => {
    it("stores the matters of the works the questions were drawn from, and judges the defense by them afterwards", async () => {
        const note = (n: number, chatId: string): Row => ({
            id: id(n), org_id: ORG, trainee_user_id: PUPIL, chat_id: chatId, word_chat_id: null, tabular_chat_id: null,
            message_id: id(n + 100), attempt: "Mi enfoque", contrast: null, contrast_status: "none", created_at: "2026-11-09T10:00:00Z",
        });
        const { db, tables } = world(
            [defense({ id: id(90), questions: null, questions_status: "none", outcome: null, outcome_reason: null, outcome_note: null, held_at: null })],
            [],
            [note(1, id(50)), note(2, id(51))],
        );
        const result = await generateDefenseQuestions(db, { ...actor, defenseId: id(90) });
        if (!result.ok) throw new Error(`expected ok, got ${result.kind}`);
        // The mentor can open one of the two works' matters only: the questions rest on that one.
        expect(tables.training_defenses[0]).toMatchObject({ questions_status: "ready", source_project_ids: [OPEN_MATTER] });
        matters.open = new Set([OPEN_MATTER, CLOSED_MATTER]);
        expect((await listed(tables.training_defenses.map((row) => ({ ...row, outcome: "approved" }))))[0].questions).toHaveLength(1);
        matters.open = new Set([CLOSED_MATTER]);
        expect((await listed(tables.training_defenses.map((row) => ({ ...row, outcome: "approved" }))))[0].questions).toBeNull();
    });
});

describe("the current mentor reads a pass note only for matters they can open", () => {
    const pass = (n: number, projectId: string): Row => ({
        id: id(n), org_id: ORG, trainee_user_id: PUPIL, project_id: projectId,
        starts_at: "2026-11-07T10:00:00Z", expires_at: "2026-11-07T18:00:00Z",
        reason_code: "plazo", reason_note: `Nota del asunto ${n}`, revoked_at: "2026-11-07T12:00:00Z", created_at: "2026-11-07T10:00:00Z",
    });

    it("keeps that a pass exists, and its dates, but not the matter, the reason or the note of a matter they cannot open", async () => {
        const result = await listUrgencyPasses(world([], [pass(70, OPEN_MATTER), pass(71, CLOSED_MATTER)]).db, actor);
        if (!result.ok) throw new Error("expected ok");
        const byId = new Map(result.data.passes.map((p) => [p.id, p]));
        expect(byId.get(id(70))).toMatchObject({ project_id: OPEN_MATTER, reason_code: "plazo", reason_note: "Nota del asunto 70" });
        expect(byId.get(id(70))).not.toHaveProperty("details_withheld");
        expect(byId.get(id(71))).toMatchObject({
            id: id(71), starts_at: "2026-11-07T10:00:00Z", expires_at: "2026-11-07T18:00:00Z", revoked_at: "2026-11-07T12:00:00Z",
            project_id: null, reason_code: null, reason_note: null, details_withheld: true,
        });
        expect(JSON.stringify(byId.get(id(71)))).not.toContain(CLOSED_MATTER);
        expect(JSON.stringify(byId.get(id(71)))).not.toContain("plazo");
    });

    it("fails when the matters cannot be checked", async () => {
        matters.failing = true;
        const result = await listUrgencyPasses(world([], [pass(72, OPEN_MATTER)]).db, actor);
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });
});
