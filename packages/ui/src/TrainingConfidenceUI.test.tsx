import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrainingConfidenceUI } from "./TrainingConfidenceUI";
import { confidenceText } from "./trainingTestText";

const thermometer = (
  props: Partial<React.ComponentProps<typeof TrainingConfidenceUI>> = {},
) =>
  render(
    <TrainingConfidenceUI
      id="t"
      value={null}
      onChange={vi.fn()}
      text={confidenceText}
      {...props}
    />,
  );

describe("TrainingConfidenceUI", () => {
  it("is a named radio group with the four levels in order and none chosen", () => {
    thermometer();
    const group = screen.getByRole("radiogroup", {
      name: "How sure are you of your approach?",
    });
    expect(group).toHaveAttribute("aria-required", "true");
    expect(group).toHaveAccessibleDescription("One mark for the whole approach.");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["1", "2", "3", "4"]);
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual([
      "Almost a guess",
      "I doubt it",
      "Fairly sure",
      "Sure",
    ]);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(radios.every((r) => (r as HTMLInputElement).name === "t")).toBe(true);
    expect(group.querySelector("svg")).toBeNull();
  });

  it("reports the level that is chosen and marks it with a check, not only a colour", () => {
    const onChange = vi.fn();
    thermometer({ onChange });
    fireEvent.click(screen.getByRole("radio", { name: "Fairly sure" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("shows the chosen level as checked with a check mark", () => {
    const { container } = thermometer({ value: 2 });
    expect(screen.getByRole("radio", { name: "I doubt it" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sure" })).not.toBeChecked();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("I doubt it").closest("label")).toContainElement(
      container.querySelector("svg") as SVGElement,
    );
  });

  it("asks for the mark only once a send was refused, and clears it when chosen", () => {
    const { rerender } = thermometer({ showError: false });
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <TrainingConfidenceUI
        id="t"
        value={null}
        onChange={vi.fn()}
        text={confidenceText}
        showError
      />,
    );
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Mark how sure you are before sending.");
    expect(group).toHaveAccessibleDescription(
      "One mark for the whole approach. Mark how sure you are before sending.",
    );
    rerender(
      <TrainingConfidenceUI id="t" value={4} onChange={vi.fn()} text={confidenceText} showError />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-invalid");
  });

  it("works without a help line and disables every level", () => {
    thermometer({ text: { ...confidenceText, help: undefined }, disabled: true, className: "extra" });
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-describedby");
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLInputElement).disabled)).toBe(true);
  });
});
