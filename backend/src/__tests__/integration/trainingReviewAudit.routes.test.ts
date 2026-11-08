import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// The bulk review designer (training layer 3) over HTTP, against an in-memory
// database whose training_can_read_learning is the SQL rule's own statement.
// The review's access, its rows and the readability of their sources are
// stubbed at their seams so each test sees exactly who can read what; the SQL
// function and the table are covered against PostgreSQL in
// trainingReviewAudit.postgres.test.ts and performance.litt-training-supervision.sql.
const h = vi.hoisted(() => ({
    caller: { id: "" },
    state: null as null | { db: unknown; tables: Record<string, Row[]> },
    reviewAccess: new Set<string>(),
    openable: new Set<string>(),
    // user id -> row ids that user cannot read (their sources are out of reach)
    unreadable: new Map<string, Set<string>>(),
}));
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => h.state!.db),
}));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.caller.id;
                res.locals.userEmail = `${h.caller.id}@test.local`;
                next();
            }),
    };
});
vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    ensureReviewAccess: vi.fn(async (_review: unknown, userId: string) =>
        h.reviewAccess.has(userId) ? { ok: true } : { ok: false, status: 404 },
    ),
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => ({
        ok: h.openable.has(`${projectId}:${userId}`),
    })),
    // The batch rule of the same verdict: the matters of the list that the user may open.
    loadOpenableProjects: vi.fn(async (_db: unknown, userId: string, _email: unknown, projectIds: string[]) =>
        new Map(projectIds.filter((p) => h.openable.has(`${p}:${userId}`)).map((p) => [p, { orgId: null }])),
    ),
}));
vi.mock("../../lib/tabularReadAccess", () => ({
    loadReviewRows: vi.fn(async () => h.state!.tables.tabular_review_rows),
    filterReadableReviewRows: vi.fn(async (_db: unknown, rows: { id: string }[], _extra: unknown, userId: string) => ({
        rows: rows.filter((row) => !h.unreadable.get(userId)?.has(row.id)),
        readableDocumentIds: new Set<string>(),
    })),
}));
vi.mock("../../lib/audit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/audit")>()),
    recordAudit: vi.fn(async () => undefined),
}));

import { app } from "../../app";
import { checkProjectAccess, loadOpenableProjects } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const PUPIL = id(1);
const MENTOR = id(2);
const FORMER_MENTOR = id(3);
const OWNER = id(4);
const ADMIN = id(5);
const MEMBER = id(6);
const OUTSIDER = id(7);
const REVIEW = id(500);
const PROJECT = id(300);
const PASANTE = id(8);
const COLUMNS = 3;
const ROWS = 12;
const rowId = (n: number) => id(1000 + n);

const CELL_SECRET = "La cláusula décima establece la rescisión por falta de pago.";
const content = (n: number) =>
    JSON.stringify({ summary: `${CELL_SECRET} #${n}`, flag: "green", reasoning: `Razón [[document:${id(900)}||page:2||quote:texto citado ${n}]]` });

function seed() {
    const cells: Row[] = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLUMNS; c++)
            cells.push({
                id: id(5000 + r * COLUMNS + c),
                review_id: REVIEW,
                row_id: rowId(r),
                column_index: c,
                status: "done",
                content: content(r * COLUMNS + c),
                citations: null,
            });
    h.state = memoryDb(
        {
            org_members: [
                { org_id: ORG, user_id: PUPIL, role: "member" },
                { org_id: ORG, user_id: PASANTE, role: "member" },
                { org_id: ORG, user_id: MENTOR, role: "member" },
                { org_id: ORG, user_id: FORMER_MENTOR, role: "member" },
                { org_id: ORG, user_id: OWNER, role: "owner" },
                { org_id: ORG, user_id: ADMIN, role: "admin" },
                { org_id: ORG, user_id: MEMBER, role: "member" },
                { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
            ],
            training_pupils: [
                { org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR },
                { org_id: ORG, trainee_user_id: PASANTE, mentor_user_id: MENTOR },
            ],
            training_stages: [
                { org_id: ORG, trainee_user_id: PUPIL, practice: null, stage: "junior" },
                { org_id: ORG, trainee_user_id: PASANTE, practice: null, stage: "pasante" },
            ],
            projects: [{ id: PROJECT, practice: null }],
            matters: [],
            tabular_reviews: [
                {
                    id: REVIEW,
                    user_id: PUPIL,
                    project_id: PROJECT,
                    org_id: ORG,
                    title: "Contratos de arrendamiento",
                    columns_config: [
                        { index: 0, name: "Rescisión", prompt: "Resume la cláusula de rescisión del contrato", format: "text" },
                        { index: 1, name: "Rescisión", prompt: "Plazo", format: "text" },
                        { index: 2, name: "Ley", prompt: "" },
                    ],
                    active_generation_id: null,
                    generation_lease_expires_at: null,
                },
            ],
            tabular_review_rows: Array.from({ length: ROWS }, (_, r) => ({ id: rowId(r), label: `Contrato ${r}` })),
            tabular_cells: cells,
            training_review_audits: [],
        },
        {
            training_can_read_learning: ({ p_actor, p_org, p_trainee }, tables) => {
                const member = (user: unknown) =>
                    tables.org_members.some((m) => m.org_id === p_org && m.user_id === user);
                if (!member(p_actor) || !member(p_trainee)) return false;
                if (p_actor === p_trainee) return true;
                return tables.training_pupils.some(
                    (p) => p.org_id === p_org && p.trainee_user_id === p_trainee && p.mentor_user_id === p_actor,
                );
            },
        },
    );
}

const audit = `/tabular-review/${REVIEW}/training-audit`;
const mentorBase = `/orgs/${ORG}/training/pupils/${PUPIL}/review-audits`;
const as = (user: string) => {
    h.caller.id = user;
    return request(app);
};
const key = (cell: { row_id: string; column_index: number }) => `${cell.row_id}:${cell.column_index}`;
const rows = () => h.state!.tables.training_review_audits;

async function startAndMarkAll(marks: Record<string, string> = {}) {
    const started = await as(PUPIL).post(audit).send({});
    expect(started.status).toBe(201);
    for (const cell of started.body.cells) {
        const response = await as(PUPIL)
            .put(`${audit}/cells/${key(cell)}`)
            .send({ mark: marks[key(cell)] ?? "correct" });
        expect(response.status).toBe(200);
    }
    return started.body as { id: string; cells: { row_id: string; column_index: number }[] };
}

beforeEach(() => {
    seed();
    h.reviewAccess = new Set([PUPIL, PASANTE, MENTOR, OWNER, ADMIN, MEMBER]);
    h.openable = new Set([`${PROJECT}:${MENTOR}`]);
    h.unreadable = new Map();
    vi.mocked(recordAudit).mockClear();
});

describe("the junior's design review and sample", () => {
    it("reviews the questions without a model", async () => {
        const response = await as(PUPIL).get(audit);
        expect(response.status).toBe(200);
        expect(response.body.applies).toBe(true);
        expect(response.body.ready).toBe(true);
        expect(response.body.audit).toBeNull();
        expect(response.body.columns).toEqual([
            { index: 0, name: "Rescisión", prompt: "Resume la cláusula de rescisión del contrato" },
            { index: 1, name: "Rescisión", prompt: "Plazo" },
            { index: 2, name: "Ley", prompt: "" },
        ]);
        expect(response.body.lint).toEqual([
            { code: "duplicate_name", column_index: 1, other_index: 0 },
            { code: "short_instruction", column_index: 1 },
            { code: "empty_instruction", column_index: 2 },
            { code: "no_format", column_index: 2 },
        ]);
    });

    it("draws a stratified sample on the server and shows the cited passage", async () => {
        const response = await as(PUPIL).post(audit).send({});
        expect(response.status).toBe(201);
        const { cells } = response.body;
        // 36 done cells: 10 % rounds up to 4, the floor is 5.
        expect(cells).toHaveLength(5);
        expect(new Set(cells.map((cell: { column_index: number }) => cell.column_index)).size).toBe(COLUMNS);
        expect(cells[0].summary).toContain(CELL_SECRET);
        expect(cells[0].reasoning).toContain("quote:texto citado");
        expect(cells[0].row_label).toMatch(/^Contrato /);
        expect(cells.every((cell: { mark: unknown }) => cell.mark === null)).toBe(true);
        expect(response.body.columns.map((column: { name: string }) => column.name)).toEqual(["Rescisión", "Rescisión", "Ley"]);
    });

    it("keeps no cell content in the row: identifiers, digests and marks only", async () => {
        await startAndMarkAll();
        const stored = JSON.stringify(rows());
        expect(stored).not.toContain(CELL_SECRET);
        expect(stored).not.toContain("texto citado");
        for (const item of rows()[0].sample as Row[])
            expect(Object.keys(item).sort()).toEqual(["column_index", "digest", "mark", "row_id"]);
    });

    it("keys every digest with a salt of the audit itself, which never leaves the server", async () => {
        const { cellDigest } = await import("../../lib/trainingReviewAudit.js");
        const first = await as(PUPIL).post(audit).send({});
        const cellOf = (item: { row_id: string; column_index: number }) =>
            h.state!.tables.tabular_cells.find((c) => c.row_id === item.row_id && c.column_index === item.column_index)!;
        const firstRow = rows()[0];
        expect(firstRow.digest_salt).toMatch(/^[0-9a-f]{64}$/);
        for (const item of firstRow.sample as { row_id: string; column_index: number; digest: string }[]) {
            const cell = cellOf(item);
            expect(item.digest).toBe(cellDigest(firstRow.digest_salt as string, cell.content, cell.citations));
            expect(item.digest).toMatch(/^[0-9a-f]{32}$/);
        }
        // The same cell content under a second audit gives another digest; a changed cell still marks stale.
        const target = first.body.cells[0];
        const original = cellOf(target).content;
        cellOf(target).content = content(999);
        expect((await as(PUPIL).get(audit)).body.audit.status).toBe("stale");
        cellOf(target).content = original;
        const second = await as(PUPIL).post(audit).send({});
        expect(second.status).toBe(201);
        const secondRow = rows().find((row) => row.status === "open")!;
        expect(secondRow.digest_salt).not.toBe(firstRow.digest_salt);
        const shared = (secondRow.sample as { row_id: string; column_index: number; digest: string }[]).find(
            (item) => (firstRow.sample as { row_id: string; column_index: number }[]).some((o) => key(o) === key(item)),
        );
        if (shared) {
            const old = (firstRow.sample as { row_id: string; column_index: number; digest: string }[]).find((o) => key(o) === key(shared))!;
            expect(shared.digest).not.toBe(old.digest);
        }
        const cell = cellOf((secondRow.sample as { row_id: string; column_index: number }[])[0]);
        const sameBoth = [firstRow.digest_salt, secondRow.digest_salt].map((salt) => cellDigest(salt as string, cell.content, cell.citations));
        expect(sameBoth[0]).not.toBe(sameBoth[1]);
        // Neither the client nor the response carries the salt.
        for (const body of [first.body, second.body, (await as(PUPIL).get(audit)).body])
            expect(JSON.stringify(body)).not.toMatch(new RegExp(`${firstRow.digest_salt}|${secondRow.digest_salt}|digest_salt`));
    });

    it("is reproducible: the stored seed draws the same sample again", async () => {
        const started = await as(PUPIL).post(audit).send({});
        const { drawSample } = await import("../../lib/trainingReviewAudit.js");
        const cells = (h.state!.tables.tabular_cells as { row_id: string; column_index: number }[]);
        const again = drawSample(cells, 5, rows()[0].seed as string).map(key).sort();
        expect(started.body.cells.map(key).sort()).toEqual(again);
    });

    it("returns the live audit instead of drawing another", async () => {
        const first = await as(PUPIL).post(audit).send({});
        const second = await as(PUPIL).post(audit).send({});
        expect(second.status).toBe(200);
        expect(second.body.id).toBe(first.body.id);
        expect(rows()).toHaveLength(1);
        expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
    });

    it("withholds the cells whose sources the person cannot read, and never samples them", async () => {
        h.unreadable.set(PUPIL, new Set(Array.from({ length: ROWS - 1 }, (_, r) => rowId(r))));
        const response = await as(PUPIL).post(audit).send({});
        // Only the last row's three cells are readable: the sample is 3, not 5.
        expect(response.body.cells).toHaveLength(3);
        expect(response.body.cells.every((cell: { row_id: string }) => cell.row_id === rowId(ROWS - 1))).toBe(true);
    });

    it("needs finished cells", async () => {
        for (const cell of h.state!.tables.tabular_cells) cell.status = "pending";
        const response = await as(PUPIL).post(audit).send({});
        expect(response.status).toBe(409);
        expect((await as(PUPIL).get(audit)).body.ready).toBe(false);
    });

    it("waits for a generation in progress", async () => {
        Object.assign(h.state!.tables.tabular_reviews[0], {
            active_generation_id: id(9),
            generation_lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        expect((await as(PUPIL).post(audit).send({})).status).toBe(409);
    });
});

describe("marks and completion", () => {
    it("refuses to finish with unmarked cells, then finishes and counts by column", async () => {
        const started = await as(PUPIL).post(audit).send({});
        const [first, ...rest] = started.body.cells;
        expect((await as(PUPIL).put(`${audit}/cells/${key(first)}`).send({ mark: "incorrect", note: "  No dice  " })).status).toBe(200);
        expect((await as(PUPIL).post(`${audit}/complete`).send({})).status).toBe(409);
        for (const cell of rest) await as(PUPIL).put(`${audit}/cells/${key(cell)}`).send({ mark: "correct" });
        const done = await as(PUPIL).post(`${audit}/complete`).send({});
        expect(done.status).toBe(200);
        expect(done.body.status).toBe("complete");
        const tally = done.body.tally as { column_index: number; marked: number; incorrect: number; column_name: string }[];
        expect(tally.reduce((total, column) => total + column.marked, 0)).toBe(5);
        expect(tally.find((column) => column.column_index === first.column_index)!.incorrect).toBe(1);
        expect(done.body.cells.find((cell: { row_id: string; column_index: number }) => key(cell) === key(first)).note).toBe("No dice");
        // Completing again changes nothing; marking a complete audit is refused.
        expect((await as(PUPIL).post(`${audit}/complete`).send({})).status).toBe(200);
        expect((await as(PUPIL).put(`${audit}/cells/${key(first)}`).send({ mark: "correct" })).status).toBe(409);
    });

    it("validates the mark, the note and the cell", async () => {
        const started = await as(PUPIL).post(audit).send({});
        const cell = started.body.cells[0];
        const url = `${audit}/cells/${key(cell)}`;
        expect((await as(PUPIL).put(url).send({ mark: "bad" })).status).toBe(400);
        expect((await as(PUPIL).put(url).send({})).status).toBe(400);
        expect((await as(PUPIL).put(url).send({ mark: "correct", note: 4 })).status).toBe(400);
        expect((await as(PUPIL).put(url).send({ mark: "correct", note: "x".repeat(501) })).status).toBe(400);
        expect((await as(PUPIL).put(`${audit}/cells/not-a-key`).send({ mark: "correct" })).status).toBe(404);
        expect((await as(PUPIL).put(`${audit}/cells/${rowId(99)}:0`).send({ mark: "correct" })).status).toBe(404);
        const remarked = await as(PUPIL).put(url).send({ mark: "incomplete", note: "" });
        expect(remarked.body.cells.find((c: { row_id: string; column_index: number }) => key(c) === key(cell)).note).toBeNull();
    });

    it("expires when the review is regenerated, and a new sample can be drawn", async () => {
        const started = await startAndMarkAll();
        const changed = h.state!.tables.tabular_cells.find(
            (cell) => cell.row_id === started.cells[0].row_id && cell.column_index === started.cells[0].column_index,
        )!;
        changed.content = content(999);
        const stale = await as(PUPIL).get(audit);
        expect(stale.body.audit.status).toBe("stale");
        expect(stale.body.audit.cells).toEqual([]);
        const marked = await as(PUPIL).put(`${audit}/cells/${key(started.cells[0])}`).send({ mark: "correct" });
        expect(marked.status).toBe(409);
        expect(marked.body.code).toBe("training_review_audit_stale");
        expect((await as(PUPIL).post(`${audit}/complete`).send({})).body.code).toBe("training_review_audit_stale");
        const next = await as(PUPIL).post(audit).send({});
        expect(next.status).toBe(201);
        expect(next.body.id).not.toBe(started.id);
        expect(rows().map((row) => row.status).sort()).toEqual(["open", "stale"]);
    });

    it("also expires when a sampled cell is gone or no longer done", async () => {
        const started = await as(PUPIL).post(audit).send({});
        const tables = h.state!.tables;
        tables.tabular_cells = tables.tabular_cells.filter(
            (cell) => !(cell.row_id === started.body.cells[0].row_id && cell.column_index === started.body.cells[0].column_index),
        );
        expect((await as(PUPIL).get(audit)).body.audit.status).toBe("stale");
    });
});

describe("who audits", () => {
    it("is for a junior only; a pasante or someone with no stage gets nothing", async () => {
        h.reviewAccess.add(PASANTE);
        const read = await as(PASANTE).get(audit);
        expect(read.body).toEqual({ applies: false, ready: false, columns: [], lint: [], audit: null });
        expect((await as(PASANTE).post(audit).send({})).status).toBe(404);
        expect((await as(OWNER).get(audit)).body.applies).toBe(false);
        expect((await as(OWNER).post(audit).send({})).status).toBe(404);
        expect(rows()).toHaveLength(0);
    });

    it("gives a stage no access to a review the person cannot open", async () => {
        h.reviewAccess.delete(PUPIL);
        expect((await as(PUPIL).get(audit)).status).toBe(404);
        expect((await as(PUPIL).post(audit).send({})).status).toBe(404);
    });

    it("answers 404 to a malformed or unknown review", async () => {
        expect((await as(PUPIL).get("/tabular-review/not-a-uuid/training-audit")).status).toBe(404);
        expect((await as(PUPIL).get(`/tabular-review/${id(777)}/training-audit`)).status).toBe(404);
    });

    it("lets the person read only their own audit", async () => {
        await as(PUPIL).post(audit).send({});
        // Another junior in the same organization starts their own, never sees the first.
        h.state!.tables.training_stages.push({ org_id: ORG, trainee_user_id: MEMBER, practice: null, stage: "junior" });
        h.state!.tables.training_pupils.push({ org_id: ORG, trainee_user_id: MEMBER, mentor_user_id: MENTOR });
        const other = await as(MEMBER).get(audit);
        expect(other.body.applies).toBe(true);
        expect(other.body.audit).toBeNull();
    });
});

describe("the audit trail", () => {
    it("records started and completed with identifiers only", async () => {
        await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        const events = vi.mocked(recordAudit).mock.calls.map(([, event]) => event);
        expect(events.map((event) => event.action)).toEqual([
            "training.review_audit_started",
            "training.review_audit_completed",
        ]);
        for (const event of events) {
            expect(event.reviewId).toBe(REVIEW);
            expect(Object.keys(event.detail ?? {}).sort()).toEqual(["org_id", "target_user_id"]);
            expect(JSON.stringify(event)).not.toContain(CELL_SECRET);
        }
    });
});

describe("the mentor's evaluation", () => {
    it("lists the person's audits for the current mentor, with the cited cells", async () => {
        await startAndMarkAll();
        const response = await as(MENTOR).get(mentorBase);
        expect(response.status).toBe(200);
        expect(response.body.without_access).toBe(0);
        expect(response.body.audits).toHaveLength(1);
        expect(response.body.audits[0].review_title).toBe("Contratos de arrendamiento");
        expect(response.body.audits[0].cells[0].summary).toContain(CELL_SECRET);
    });

    it("evaluates a complete audit with a note and corrects a mark as the mentor's", async () => {
        const started = await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        const target = started.cells[0];
        const response = await as(MENTOR)
            .put(`${mentorBase}/${started.id}/evaluation`)
            .send({
                outcome: "needs_work",
                note: "  Falta precisar el plazo.  ",
                corrections: [{ row_id: target.row_id, column_index: target.column_index, mark: "incorrect" }],
            });
        expect(response.status).toBe(200);
        expect(response.body.evaluation).toMatchObject({ outcome: "needs_work", note: "Falta precisar el plazo." });
        const cell = response.body.cells.find((c: { row_id: string; column_index: number }) => key(c) === key(target));
        expect(cell.mentor_mark).toBe("incorrect");
        // The person's own mark is untouched, and the person sees the evaluation.
        expect(cell.mark).toBe("correct");
        const own = await as(PUPIL).get(audit);
        expect(own.body.audit.evaluation.outcome).toBe("needs_work");
        expect(own.body.audit.tally.reduce((total: number, column: { incorrect: number }) => total + column.incorrect, 0)).toBe(0);
        const events = vi.mocked(recordAudit).mock.calls.map(([, event]) => event);
        const evaluated = events.find((event) => event.action === "training.review_audit_evaluated")!;
        expect(Object.keys(evaluated.detail ?? {}).sort()).toEqual(["org_id", "target_user_id"]);
        expect(JSON.stringify(evaluated)).not.toContain("plazo");
        // Evaluating again replaces the first.
        const again = await as(MENTOR).put(`${mentorBase}/${started.id}/evaluation`).send({ outcome: "adequate" });
        expect(again.body.evaluation).toMatchObject({ outcome: "adequate", note: null });
    });

    it("waits for the person to finish, refuses stale audits and bad requests", async () => {
        const started = await as(PUPIL).post(audit).send({});
        const url = `${mentorBase}/${started.body.id}/evaluation`;
        expect((await as(MENTOR).put(url).send({ outcome: "adequate" })).status).toBe(409);
        await startAndMarkAllExisting(started.body);
        expect((await as(MENTOR).put(url).send({ outcome: "great" })).status).toBe(400);
        expect((await as(MENTOR).put(url).send({ outcome: "adequate", note: "x".repeat(501) })).status).toBe(400);
        expect((await as(MENTOR).put(url).send({ outcome: "adequate", note: 3 })).status).toBe(400);
        expect((await as(MENTOR).put(url).send({ outcome: "adequate", corrections: "no" })).status).toBe(400);
        expect((await as(MENTOR).put(url).send({ outcome: "adequate", corrections: [{ row_id: "x" }] })).status).toBe(400);
        expect(
            (await as(MENTOR).put(url).send({ outcome: "adequate", corrections: [{ row_id: rowId(99), column_index: 0, mark: "correct" }] })).status,
        ).toBe(400);
        expect((await as(MENTOR).put(`${mentorBase}/not-a-uuid/evaluation`).send({ outcome: "adequate" })).status).toBe(404);
        expect((await as(MENTOR).put(`${mentorBase}/${id(888)}/evaluation`).send({ outcome: "adequate" })).status).toBe(404);
        h.state!.tables.tabular_cells[0].content = content(12345);
        for (const cell of h.state!.tables.tabular_cells) cell.content = content(1);
        const stale = await as(MENTOR).put(url).send({ outcome: "adequate" });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe("training_review_audit_stale");
    });

    it("shows nothing of a review in a matter the mentor cannot open, only a count", async () => {
        const started = await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        h.openable.clear();
        const listed = await as(MENTOR).get(mentorBase);
        expect(listed.body).toEqual({ audits: [], without_access: 1 });
        expect((await as(MENTOR).put(`${mentorBase}/${started.id}/evaluation`).send({ outcome: "adequate" })).status).toBe(404);
    });

    it("withholds the cells whose sources the mentor cannot read, and rejects corrections to them", async () => {
        const started = await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        h.unreadable.set(MENTOR, new Set(started.cells.map((cell) => cell.row_id)));
        const listed = await as(MENTOR).get(mentorBase);
        expect(listed.body.audits[0].withheld).toBe(5);
        expect(JSON.stringify(listed.body)).not.toContain(CELL_SECRET);
        const target = started.cells[0];
        const response = await as(MENTOR)
            .put(`${mentorBase}/${started.id}/evaluation`)
            .send({ outcome: "adequate", corrections: [{ row_id: target.row_id, column_index: target.column_index, mark: "incorrect" }] });
        expect(response.status).toBe(400);
    });

    it("reads the access of every matter once for the whole list, with the same result as asking one by one", async () => {
        const tables = h.state!.tables;
        const MATTERS = [id(301), id(302), id(303)];
        const extra = MATTERS.flatMap((matter, n) =>
            [0, 1].map((k) => ({ matter, review: id(600 + n * 2 + k), created: `2026-11-0${1 + n * 2 + k}T10:00:00Z` })),
        );
        for (const { matter, review, created } of extra) {
            tables.tabular_reviews.push({ id: review, user_id: PUPIL, project_id: matter, org_id: ORG, title: `R ${review}`, columns_config: [], active_generation_id: null, generation_lease_expires_at: null });
            tables.training_review_audits.push({
                id: id(700 + Number(review.slice(-3)) - 600), org_id: ORG, trainee_user_id: PUPIL, tabular_review_id: review,
                columns_snapshot: [], lint: [], seed: "s", digest_salt: "s".repeat(64), status: "open", completed_at: null,
                sample: [{ row_id: rowId(0), column_index: 0, digest: "d" }], created_at: created, updated_at: created,
            });
        }
        h.openable = new Set([`${MATTERS[0]}:${MENTOR}`, `${MATTERS[2]}:${MENTOR}`]);
        vi.mocked(checkProjectAccess).mockClear();
        vi.mocked(loadOpenableProjects).mockClear();
        const listed = await as(MENTOR).get(mentorBase);
        expect(listed.status).toBe(200);
        const expected = extra.filter((e) => h.openable.has(`${e.matter}:${MENTOR}`)).map((e) => e.review).sort();
        expect(listed.body.audits.map((a: { tabular_review_id: string }) => a.tabular_review_id).sort()).toEqual(expected);
        expect(listed.body.without_access).toBe(extra.length - expected.length);
        // One batch read, no per-review verdict.
        expect(vi.mocked(loadOpenableProjects)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(checkProjectAccess)).not.toHaveBeenCalled();
        // Differential: the per-matter rule gives the same verdict for each.
        for (const { matter } of extra) {
            const one = await checkProjectAccess(matter, MENTOR, `${MENTOR}@test.local`, h.state!.db as never);
            expect(one.ok).toBe(expected.some((r) => extra.find((e) => e.review === r)!.matter === matter));
        }
    });

    it("lists a review outside any matter only when the mentor can open the review itself", async () => {
        await startAndMarkAll();
        h.state!.tables.tabular_reviews[0].project_id = null;
        expect((await as(MENTOR).get(mentorBase)).body.audits).toHaveLength(1);
        h.reviewAccess.delete(MENTOR);
        expect((await as(MENTOR).get(mentorBase)).body).toEqual({ audits: [], without_access: 1 });
    });
});

// Every route of the two routers has a row here: a new route without one fails
// the structural test below.
const MATRIX: [string, string, string][] = [
    ["get", "/", "junior"],
    ["post", "/", "junior"],
    ["put", "/cells/:key", "junior"],
    ["post", "/complete", "junior"],
];
const MENTOR_MATRIX: [string, string][] = [
    ["get", "/"],
    ["put", "/:auditId/evaluation"],
];

async function startAndMarkAllExisting(auditView: { cells: { row_id: string; column_index: number }[] }) {
    for (const cell of auditView.cells)
        await as(PUPIL).put(`${audit}/cells/${key(cell)}`).send({ mark: "correct" });
    await as(PUPIL).post(`${audit}/complete`).send({});
}

describe("privacy by role", () => {
    it("lists every route in the matrix", async () => {
        const { reviewAuditRouter, pupilReviewAuditsRouter } = await import(
            "../../modules/training-review-audit/trainingReviewAudit.routes.js"
        );
        const routesOf = (router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }) =>
            router.stack
                .filter((layer) => layer.route)
                .flatMap((layer) => Object.keys(layer.route!.methods).map((method) => `${method} ${layer.route!.path}`))
                .sort();
        expect(routesOf(reviewAuditRouter as never)).toEqual(MATRIX.map(([m, p]) => `${m} ${p}`).sort());
        expect(routesOf(pupilReviewAuditsRouter as never)).toEqual(MENTOR_MATRIX.map(([m, p]) => `${m} ${p}`).sort());
    });

    const denied: [string, string][] = [
        ["the former mentor", FORMER_MENTOR],
        ["an owner", OWNER],
        ["an admin", ADMIN],
        ["another member", MEMBER],
        ["someone from another organization", OUTSIDER],
        ["the person themself, on the mentor's routes", PUPIL],
    ];

    it.each(denied)("answers %s the same 404 on every mentor route", async (_who, user) => {
        const started = await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        const list = await as(user).get(mentorBase);
        const evaluate = await as(user).put(`${mentorBase}/${started.id}/evaluation`).send({ outcome: "adequate" });
        const missing = await as(user).put(`${mentorBase}/${id(889)}/evaluation`).send({ outcome: "adequate" });
        for (const response of [list, evaluate, missing]) {
            expect(response.status).toBe(404);
            expect(response.body).toEqual(list.body);
        }
        expect(rows()[0].mentor_outcome ?? null).toBeNull();
    });

    it("never returns a score, rank, average, percentile or group total", async () => {
        const started = await startAndMarkAll();
        await as(PUPIL).post(`${audit}/complete`).send({});
        await as(MENTOR).put(`${mentorBase}/${started.id}/evaluation`).send({ outcome: "adequate", note: "ok" });
        const bodies = [
            (await as(PUPIL).get(audit)).body,
            (await as(MENTOR).get(mentorBase)).body,
        ];
        const keys = new Set<string>();
        const walk = (value: unknown) => {
            if (Array.isArray(value)) return value.forEach(walk);
            if (value && typeof value === "object")
                for (const [name, inner] of Object.entries(value)) {
                    keys.add(name);
                    walk(inner);
                }
        };
        bodies.forEach(walk);
        for (const forbidden of ["score", "rank", "ranking", "average", "avg", "percentile", "percentage", "total"])
            expect(keys.has(forbidden)).toBe(false);
    });
});
