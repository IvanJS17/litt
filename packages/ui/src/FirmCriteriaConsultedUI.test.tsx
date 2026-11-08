import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FirmCriteriaConsultedUI,
  type FirmCriteriaConsultedLabels,
  type FirmCriterionView,
} from "./FirmCriteriaConsultedUI";

const labels: FirmCriteriaConsultedLabels = {
  summary: (count) => `Consulted: ${count}`,
  note: "Positions written by people of the firm, not law.",
  empty: "Nothing written.",
  failed: "Could not consult.",
  more: "There are more.",
  kind: (kind) => (kind === "voto_particular" ? "Dissenting opinion" : "Criterion"),
  byline: (criterion) => `According to ${criterion.author_name ?? "a deleted user"} on ${criterion.created_at.slice(0, 10)}`,
  practice: (practice) => `Area: ${practice}`,
  rule: (ruleId) => `Disagrees with rule ${ruleId}`,
};

const criterion = (over: Partial<FirmCriterionView> = {}): FirmCriterionView => ({
  id: "c1",
  kind: "criterio",
  practice: "mercantil",
  topic: "Prescripción cambiaria",
  position: "El plazo corre desde el vencimiento.\nSegunda línea.",
  author_name: "Ana Pérez",
  playbook_id: null,
  rule_id: null,
  created_at: "2026-11-01T10:00:00.000Z",
  ...over,
});

describe("FirmCriteriaConsultedUI", () => {
  it("lists each criterion as stored, with kind, area, author and date, inside a disclosure with a visible name", () => {
    render(<FirmCriteriaConsultedUI consultation={{ criteria: [criterion()], truncated: false }} labels={labels} />);
    expect(screen.getByText("Consulted: 1").tagName).toBe("SUMMARY");
    expect(screen.getByText("Positions written by people of the firm, not law.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Prescripción cambiaria", hidden: true })).toBeTruthy();
    expect(screen.getByText("Criterion · Area: mercantil")).toBeTruthy();
    expect(screen.getByText(/El plazo corre desde el vencimiento\./).className).toContain("whitespace-pre-wrap");
    expect(screen.getByText("According to Ana Pérez on 2026-11-01")).toBeTruthy();
    expect(screen.queryByText("There are more.")).toBeNull();
  });

  it("names a dissenting opinion's rule, a deleted author, and omits an absent area", () => {
    render(
      <FirmCriteriaConsultedUI
        consultation={{ criteria: [criterion({ kind: "voto_particular", practice: null, rule_id: "r1", author_name: null })], truncated: true }}
        labels={labels}
      />,
    );
    expect(screen.getByText("Dissenting opinion · Disagrees with rule r1")).toBeTruthy();
    expect(screen.getByText("According to a deleted user on 2026-11-01")).toBeTruthy();
    expect(screen.getByText("There are more.")).toBeTruthy();
  });

  it("says plainly that nothing was written, or that the consultation failed", () => {
    const { rerender } = render(<FirmCriteriaConsultedUI consultation={{ criteria: [], truncated: false }} labels={labels} />);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("Nothing written.");
    rerender(<FirmCriteriaConsultedUI consultation={{ criteria: [], truncated: true, error: "x" }} labels={labels} />);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("Could not consult.");
    expect(screen.queryByText("There are more.")).toBeNull();
  });
});
