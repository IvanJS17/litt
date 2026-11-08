import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";

vi.mock("../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/access")>()),
    getOrgRole: vi.fn(async (userId: string, orgId: string, db: Db) => {
        const { data } = await db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
        return (data as { role?: string } | null)?.role ?? null;
    }),
}));
vi.mock("../../lib/personalOrgs", () => ({
    isPersonalOrg: vi.fn(async (db: Db, orgId: string) => {
        const { data } = await db.from("organizations").select("kind").eq("id", orgId).maybeSingle();
        return (data as { kind?: string } | null)?.kind === "personal";
    }),
}));
const { audits } = vi.hoisted(() => ({ audits: [] as { action: string; detail: Record<string, unknown>; orgId: unknown }[] }));
vi.mock("../../lib/audit", () => ({
    recordAudit: vi.fn(async (_db: unknown, event: { action: string; detail: Record<string, unknown>; orgId: unknown }) => {
        audits.push({ action: event.action, detail: event.detail, orgId: event.orgId });
    }),
}));
const { playbooks } = vi.hoisted(() => ({ playbooks: new Map<string, { orgId: string | null; rules: string[]; readableBy: string[] }>() }));
vi.mock("../playbooks/playbooks.service", () => {
    class PlaybookRequestError extends Error {
        constructor(message: string, readonly status: number) {
            super(message);
        }
    }
    return {
        PlaybookRequestError,
        getPlaybook: vi.fn(async (userId: string, id: string) => {
            if (id === "boom") throw new Error("database down");
            const playbook = playbooks.get(id);
            if (!playbook || !playbook.readableBy.includes(userId)) throw new PlaybookRequestError("Playbook not found.", 404);
            return { orgId: playbook.orgId, content: { topics: [{ rules: playbook.rules.map((rule) => ({ id: rule })) }] } };
        }),
    };
});

import { FIRM_CRITERIA_MAX_PER_ORG } from "../../lib/firmCriteria";
import { getPlaybook } from "../playbooks/playbooks.service";
import { createFirmCriterion, deleteFirmCriterion, listFirmCriteria, updateFirmCriterion } from "./firmCriteria.service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(100);
const OTHER_ORG = id(101);
const PERSONAL = id(102);
const OWNER = id(1);
const ADMIN = id(2);
const PARTNER = id(3);
const OTHER_PARTNER = id(4);
const TRAINEE = id(5);
const OUTSIDER = id(6);
const PLAYBOOK = id(300);

let state: ReturnType<typeof memoryDb>;
const rows = (table: string): Row[] => state.tables[table] ?? [];
const as = (userId: string, orgId: unknown = ORG) => ({ userId, userEmail: null, orgId });
const body = { topic: "Prescripción cambiaria", position: "El plazo corre desde el vencimiento.", practice: "Mercantil" };

beforeEach(() => {
    audits.length = 0;
    playbooks.clear();
    playbooks.set(PLAYBOOK, { orgId: ORG, rules: ["r1"], readableBy: [PARTNER, ADMIN] });
    playbooks.set(id(301), { orgId: OTHER_ORG, rules: ["r1"], readableBy: [PARTNER] });
    state = memoryDb({
        organizations: [
            { id: ORG, kind: "team" },
            { id: OTHER_ORG, kind: "team" },
            { id: PERSONAL, kind: "personal" },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: ADMIN, role: "admin" },
            { org_id: ORG, user_id: PARTNER, role: "member" },
            { org_id: ORG, user_id: OTHER_PARTNER, role: "member" },
            { org_id: ORG, user_id: TRAINEE, role: "member" },
            { org_id: PERSONAL, user_id: PARTNER, role: "owner" },
            { org_id: OTHER_ORG, user_id: OUTSIDER, role: "owner" },
        ],
        training_stages: [{ org_id: ORG, trainee_user_id: TRAINEE, practice: null, stage: "pasante" }],
        user_profiles: [{ user_id: PARTNER, display_name: "Ana Pérez", email: "ana@example.test" }],
        firm_criteria: [],
    });
});
const db = () => state.db as unknown as Db;

describe("writing", () => {
    it("stores a criterion under the author's name and audits ids and kind only", async () => {
        const created = await createFirmCriterion(db(), { ...as(PARTNER), body });
        expect(created).toMatchObject({
            ok: true,
            data: { kind: "criterio", practice: "mercantil", topic: body.topic, position: body.position, author_user_id: PARTNER, author_name: "Ana Pérez", mine: true },
        });
        expect(rows("firm_criteria")[0]).toMatchObject({ org_id: ORG, author_user_id: PARTNER });
        expect(audits).toEqual([
            { action: "firm_criteria.created", orgId: ORG, detail: { org_id: ORG, criterion_id: rows("firm_criteria")[0].id, kind: "criterio" } },
        ]);
        expect(JSON.stringify(audits)).not.toContain("plazo");
    });

    it("keeps a trainee, a stranger and a personal workspace out", async () => {
        expect(await createFirmCriterion(db(), { ...as(TRAINEE), body })).toMatchObject({ ok: false, kind: "forbidden" });
        expect(await createFirmCriterion(db(), { ...as(OUTSIDER), body })).toMatchObject({ ok: false, kind: "not_found" });
        expect(await createFirmCriterion(db(), { ...as(PARTNER, PERSONAL), body })).toMatchObject({ ok: false, kind: "not_found" });
        expect(await createFirmCriterion(db(), { ...as(PARTNER, "not-an-id"), body })).toMatchObject({ ok: false, kind: "not_found" });
        expect(await createFirmCriterion(db(), { ...as(PARTNER, null), body })).toMatchObject({ ok: false, kind: "not_found" });
        expect(rows("firm_criteria")).toHaveLength(0);
        expect(audits).toEqual([]);
    });

    it("refuses what is not a criterion", async () => {
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: { topic: "", position: "x" } })).toMatchObject({ ok: false, kind: "validation" });
    });

    it("stops at the limit with a code the client handles", async () => {
        state.tables.firm_criteria = Array.from({ length: FIRM_CRITERIA_MAX_PER_ORG }, (_, i) => ({ id: id(1000 + i), org_id: ORG }));
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body })).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "firm_criteria_limit_reached",
        });
    });

    it("stores a dissenting opinion only for a rule the author can open, in this organization", async () => {
        const vote = { ...body, kind: "voto_particular", playbook_id: PLAYBOOK, rule_id: "r1" };
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: vote })).toMatchObject({
            ok: true,
            data: { kind: "voto_particular", playbook_id: PLAYBOOK, rule_id: "r1" },
        });
        const refused = { ok: false, kind: "validation", code: "firm_criteria_rule_not_found" };
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: { ...vote, rule_id: "r9" } })).toMatchObject(refused);
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: { ...vote, playbook_id: id(301) } })).toMatchObject(refused);
        expect(await createFirmCriterion(db(), { ...as(OTHER_PARTNER), body: vote })).toMatchObject(refused);
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: { ...vote, playbook_id: id(399) } })).toMatchObject(refused);
        expect(rows("firm_criteria")).toHaveLength(1);
    });

    it("reports a playbook that cannot be read as an internal failure, not a refusal", async () => {
        const vote = { ...body, kind: "voto_particular", playbook_id: "00000000-0000-4000-8000-000000000bad", rule_id: "r1" };
        playbooks.set(vote.playbook_id, { orgId: ORG, rules: [], readableBy: [] });
        vi.mocked(getPlaybook).mockRejectedValueOnce(new Error("database down"));
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body: vote })).toMatchObject({ ok: false, kind: "error" });
    });

    it("fails closed when the stage cannot be read", async () => {
        state.failNext("training_stages", "select", { message: "boom" });
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body })).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("reading", () => {
    beforeEach(async () => {
        await createFirmCriterion(db(), { ...as(PARTNER), body });
    });

    it("lets every member read, trainee included, and says what each may do", async () => {
        const trainee = await listFirmCriteria(db(), as(TRAINEE));
        expect(trainee).toMatchObject({ ok: true, data: { can_write: false, can_manage: false, max_per_organization: FIRM_CRITERIA_MAX_PER_ORG } });
        expect(trainee.ok && trainee.data.criteria).toMatchObject([{ author_name: "Ana Pérez", mine: false }]);
        expect(await listFirmCriteria(db(), as(PARTNER))).toMatchObject({ ok: true, data: { can_write: true, can_manage: false, criteria: [{ mine: true }] } });
        expect(await listFirmCriteria(db(), as(ADMIN))).toMatchObject({ ok: true, data: { can_write: true, can_manage: true } });
    });

    it("answers the same 404 to a stranger, another organization and a personal workspace", async () => {
        const missing = { ok: false, kind: "not_found", detail: "Not found" };
        expect(await listFirmCriteria(db(), as(OUTSIDER))).toMatchObject(missing);
        expect(await listFirmCriteria(db(), as(PARTNER, OTHER_ORG))).toMatchObject(missing);
        expect(await listFirmCriteria(db(), as(PARTNER, PERSONAL))).toMatchObject(missing);
    });

    it("fails with an internal error when the table cannot be read", async () => {
        state.failNext("firm_criteria", "select", { message: "boom" });
        expect(await listFirmCriteria(db(), as(PARTNER))).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("changing and removing", () => {
    let criterionId: string;
    beforeEach(async () => {
        await createFirmCriterion(db(), { ...as(PARTNER), body });
        criterionId = rows("firm_criteria")[0].id as string;
        audits.length = 0;
    });

    it("lets only the author change it, and audits the change", async () => {
        const changed = await updateFirmCriterion(db(), { ...as(PARTNER), criterionId, body: { ...body, position: "Otra postura." } });
        expect(changed).toMatchObject({ ok: true, data: { position: "Otra postura.", mine: true } });
        expect(rows("firm_criteria")[0]).toMatchObject({ position: "Otra postura." });
        expect(audits).toEqual([{ action: "firm_criteria.updated", orgId: ORG, detail: { org_id: ORG, criterion_id: criterionId, kind: "criterio" } }]);
        for (const other of [OTHER_PARTNER, ADMIN, OWNER, TRAINEE]) {
            expect(await updateFirmCriterion(db(), { ...as(other), criterionId, body })).toMatchObject({ ok: false, kind: "forbidden" });
        }
        expect(rows("firm_criteria")[0]).toMatchObject({ position: "Otra postura." });
    });

    it("refuses an invalid change and a rule the author cannot open", async () => {
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId, body: { topic: "", position: "" } })).toMatchObject({ ok: false, kind: "validation" });
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId, body: { ...body, kind: "voto_particular", playbook_id: PLAYBOOK, rule_id: "zz" } })).toMatchObject({
            ok: false,
            code: "firm_criteria_rule_not_found",
        });
    });

    it("gives the same 404 for an id of another organization, an unknown id and a stranger", async () => {
        state.tables.firm_criteria.push({ id: id(500), org_id: OTHER_ORG, author_user_id: OUTSIDER, kind: "criterio", topic: "t", position: "p" });
        const missing = { ok: false, kind: "not_found" };
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId: id(500), body })).toMatchObject(missing);
        expect(await deleteFirmCriterion(db(), { ...as(ADMIN), criterionId: id(500) })).toMatchObject(missing);
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId: id(501), body })).toMatchObject(missing);
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId: "x", body })).toMatchObject(missing);
        expect(await deleteFirmCriterion(db(), { ...as(OUTSIDER), criterionId })).toMatchObject(missing);
        expect(rows("firm_criteria")).toHaveLength(2);
    });

    it("lets the author or an owner or admin remove it, and nobody else", async () => {
        for (const other of [OTHER_PARTNER, TRAINEE]) {
            expect(await deleteFirmCriterion(db(), { ...as(other), criterionId })).toMatchObject({ ok: false, kind: "forbidden" });
        }
        expect(rows("firm_criteria")).toHaveLength(1);
        expect(await deleteFirmCriterion(db(), { ...as(ADMIN), criterionId })).toEqual({ ok: true, data: { deleted: true } });
        expect(rows("firm_criteria")).toHaveLength(0);
        expect(audits).toEqual([{ action: "firm_criteria.deleted", orgId: ORG, detail: { org_id: ORG, criterion_id: criterionId, kind: "criterio" } }]);
        await createFirmCriterion(db(), { ...as(PARTNER), body });
        const mine = rows("firm_criteria")[0].id as string;
        expect(await deleteFirmCriterion(db(), { ...as(PARTNER), criterionId: mine })).toMatchObject({ ok: true });
        await createFirmCriterion(db(), { ...as(PARTNER), body });
        expect(await deleteFirmCriterion(db(), { ...as(OWNER), criterionId: rows("firm_criteria")[0].id })).toMatchObject({ ok: true });
    });

    it("reports a failed write as an internal error", async () => {
        state.failNext("firm_criteria", "delete", { message: "boom" });
        expect(await deleteFirmCriterion(db(), { ...as(PARTNER), criterionId })).toMatchObject({ ok: false, kind: "error" });
        state.failNext("firm_criteria", "update", { message: "boom" });
        expect(await updateFirmCriterion(db(), { ...as(PARTNER), criterionId, body })).toMatchObject({ ok: false, kind: "error" });
        state.failNext("firm_criteria", "insert", { message: "boom" });
        expect(await createFirmCriterion(db(), { ...as(PARTNER), body })).toMatchObject({ ok: false, kind: "error" });
    });
});
