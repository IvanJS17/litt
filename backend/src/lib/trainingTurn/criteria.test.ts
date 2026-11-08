import { describe, expect, it } from "vitest";
import { FIRM_CRITERIA_ADDENDUM, firmCriteriaPlan, withFirmCriteria } from "./criteria";

const ORG = "00000000-0000-4000-8000-000000000010";

describe("firmCriteriaPlan", () => {
    it("gives the addendum and the organization to either stage, and nothing without a stage or an organization", () => {
        expect(firmCriteriaPlan("pasante", ORG)).toEqual({ systemAddendum: FIRM_CRITERIA_ADDENDUM, firmCriteriaOrgId: ORG });
        expect(firmCriteriaPlan("junior", ORG)).toEqual({ systemAddendum: FIRM_CRITERIA_ADDENDUM, firmCriteriaOrgId: ORG });
        expect(firmCriteriaPlan(null, ORG)).toBeNull();
        expect(firmCriteriaPlan("junior", null)).toBeNull();
    });

    it("only asks for more care: present every position, tell documented from remembered, attribute, never invent", () => {
        expect(FIRM_CRITERIA_ADDENDUM).toMatch(/más de una postura razonable, preséntalas todas/);
        expect(FIRM_CRITERIA_ADDENDUM).toMatch(/«sin verificar»/);
        expect(FIRM_CRITERIA_ADDENDUM).toMatch(/list_firm_criteria/);
        expect(FIRM_CRITERIA_ADDENDUM).toMatch(/Nunca inventes/);
        expect(FIRM_CRITERIA_ADDENDUM).not.toMatch(/derecho vigente(?! ni)/);
    });
});

describe("withFirmCriteria", () => {
    const plan = { surface: "chat", stage: "junior", passActive: false, attempt: null, confidence: null, mode: null, step: null, orgId: ORG, toolPolicy: { noSubagents: true }, afterTurn: [] } as const;

    it("adds the addendum and the organization, keeping the limits already set", () => {
        const next = withFirmCriteria({ ...plan, afterTurn: [] }, "junior", ORG);
        expect(next.systemAddendum).toBe(FIRM_CRITERIA_ADDENDUM);
        expect(next.toolPolicy).toEqual({ noSubagents: true, firmCriteriaOrgId: ORG });
    });

    it("appends after an addendum another behavior set, and changes nothing without a stage", () => {
        const next = withFirmCriteria({ ...plan, afterTurn: [], systemAddendum: "antes" }, "junior", ORG);
        expect(next.systemAddendum).toBe(`antes\n\n${FIRM_CRITERIA_ADDENDUM}`);
        const same = { ...plan, afterTurn: [] };
        expect(withFirmCriteria(same, null, ORG)).toBe(same);
    });
});
