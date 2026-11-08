import { describe, expect, it } from "vitest";
import {
    FIRM_CRITERIA_CONSULT_MAX,
    foldForMatch,
    parseFirmCriterionInput,
    selectFirmCriteria,
    toFirmCriterionSnapshots,
    type FirmCriterionRow,
} from "./firmCriteria";
import { memoryDb } from "../__tests__/helpers/memoryDb";

const PLAYBOOK = "00000000-0000-4000-8000-000000000999";
const row = (n: number, over: Partial<FirmCriterionRow> = {}): FirmCriterionRow => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    org_id: "o1",
    author_user_id: "u1",
    kind: "criterio",
    practice: null,
    topic: "Prescripción cambiaria",
    position: "El plazo corre desde el vencimiento.",
    playbook_id: null,
    rule_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: `2026-11-0${n}T00:00:00.000Z`,
    ...over,
});

describe("parseFirmCriterionInput", () => {
    it("trims, defaults to a criterion and normalizes the practice area", () => {
        expect(parseFirmCriterionInput({ topic: "  Tema ", position: " Postura ", practice: "  Mercantil " })).toEqual({
            ok: true,
            value: { kind: "criterio", practice: "mercantil", topic: "Tema", position: "Postura", playbookId: null, ruleId: null },
        });
        expect(parseFirmCriterionInput({ topic: "t", position: "p", practice: "" })).toMatchObject({ ok: true, value: { practice: null } });
    });

    it.each([
        ["no body", undefined],
        ["a blank topic", { topic: "  ", position: "p" }],
        ["a long topic", { topic: "x".repeat(121), position: "p" }],
        ["a blank position", { topic: "t", position: "" }],
        ["a long position", { topic: "t", position: "x".repeat(2001) }],
        ["an unknown kind", { topic: "t", position: "p", kind: "tesis" }],
        ["a practice that is not text", { topic: "t", position: "p", practice: 4 }],
        ["a practice with control characters", { topic: "t", position: "p", practice: "a\u0000b" }],
        ["a criterion that names a rule", { topic: "t", position: "p", rule_id: "r1" }],
        ["a dissenting opinion without a playbook", { topic: "t", position: "p", kind: "voto_particular", rule_id: "r1" }],
        ["a dissenting opinion with a bad playbook id", { topic: "t", position: "p", kind: "voto_particular", playbook_id: "x", rule_id: "r1" }],
        ["a dissenting opinion without a rule", { topic: "t", position: "p", kind: "voto_particular", playbook_id: PLAYBOOK }],
        ["a dissenting opinion with a long rule id", { topic: "t", position: "p", kind: "voto_particular", playbook_id: PLAYBOOK, rule_id: "r".repeat(101) }],
    ])("refuses %s", (_label, body) => {
        expect(parseFirmCriterionInput(body)).toMatchObject({ ok: false });
    });

    it("keeps the rule of a dissenting opinion", () => {
        expect(parseFirmCriterionInput({ topic: "t", position: "p", kind: "voto_particular", playbook_id: PLAYBOOK, rule_id: "r1" })).toMatchObject({
            ok: true,
            value: { kind: "voto_particular", playbookId: PLAYBOOK, ruleId: "r1" },
        });
    });
});

describe("selectFirmCriteria", () => {
    it("folds accents and case", () => {
        expect(foldForMatch("  Prescripción,  CAMBIARIA ")).toBe("prescripcion cambiaria");
    });

    it("needs a shared word when a topic is given, and ranks the heading above the body", () => {
        const rows = [
            row(1, { topic: "Intereses moratorios", position: "Hablan de la prescripcion." }),
            row(2, { topic: "Prescripción de letras" }),
            row(3, { topic: "Competencia", position: "Nada que ver." }),
        ];
        const picked = selectFirmCriteria(rows, { topic: "prescripcion" });
        expect(picked.rows.map((r) => r.id)).toEqual([rows[1].id, rows[0].id]);
        expect(picked.truncated).toBe(false);
    });

    it("ignores short words, so a topic made of them gives the most recent, like no topic", () => {
        const rows = [row(1), row(3), row(2)];
        const recent = [rows[1].updated_at, rows[2].updated_at, rows[0].updated_at];
        expect(selectFirmCriteria(rows, { topic: "de la" }).rows.map((r) => r.updated_at)).toEqual(recent);
        expect(selectFirmCriteria(rows, {}).rows.map((r) => r.updated_at)).toEqual(recent);
        expect(selectFirmCriteria(rows, { topic: "zzzz" }).rows).toEqual([]);
    });

    it("leaves out another practice area, keeps those for any, and prefers the exact one", () => {
        const rows = [
            row(1, { practice: "civil" }),
            row(2, { practice: "mercantil" }),
            row(3, { practice: null }),
        ];
        const picked = selectFirmCriteria(rows, { practice: " Mercantil " });
        expect(picked.rows.map((r) => r.id)).toEqual([rows[1].id, rows[2].id]);
        expect(selectFirmCriteria(rows, {}).rows).toHaveLength(3);
    });

    it("carries at most the maximum and says there were more", () => {
        const rows = Array.from({ length: FIRM_CRITERIA_CONSULT_MAX + 3 }, (_, i) => row(i + 1, { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` }));
        const picked = selectFirmCriteria(rows, {});
        expect(picked.rows).toHaveLength(FIRM_CRITERIA_CONSULT_MAX);
        expect(picked.truncated).toBe(true);
    });

    it("breaks ties by id so the order is stable", () => {
        const a = row(1, { id: "00000000-0000-4000-8000-00000000000b", updated_at: "x" });
        const b = row(1, { id: "00000000-0000-4000-8000-00000000000a", updated_at: "x" });
        expect(selectFirmCriteria([a, b], {}).rows.map((r) => r.id)).toEqual([b.id, a.id]);
        expect(selectFirmCriteria([b, a], {}).rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });
});

describe("toFirmCriterionSnapshots", () => {
    it("names the author as their profile does, and leaves a deleted user without a name", async () => {
        const db = memoryDb({
            user_profiles: [
                { user_id: "u1", display_name: "Ana Pérez", email: "ana@example.test" },
                { user_id: "u2", display_name: null, email: "Beto@Example.test" },
                { user_id: "u3", display_name: null, email: null },
            ],
        }).db;
        const out = await toFirmCriterionSnapshots(db, [
            row(1, { author_user_id: "u1" }),
            row(2, { author_user_id: "u2" }),
            row(3, { author_user_id: null }),
            row(4, { author_user_id: "u3" }),
            row(5, { author_user_id: "u9" }),
        ]);
        expect(out.map((c) => c.author_name)).toEqual(["Ana Pérez", "beto@example.test", null, null, null]);
        expect(out[0]).toMatchObject({ id: row(1).id, topic: "Prescripción cambiaria", position: "El plazo corre desde el vencimiento.", author_user_id: "u1" });
        expect(out[0]).not.toHaveProperty("org_id");
    });
});
