import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TRAINING_ATTEMPT_MAX_CHARS,
  TrainingAttemptFieldUI,
  isTrainingAttemptReady,
  trainingAttemptLength,
} from "./TrainingAttemptFieldUI";

const field = (value: string, showError = false, onChange = vi.fn()) =>
  render(
    <TrainingAttemptFieldUI
      id="f"
      value={value}
      onChange={onChange}
      showError={showError}
    />,
  );

describe("TrainingAttemptFieldUI", () => {
  it("counts Unicode code points after trimming, like the server", () => {
    expect(trainingAttemptLength("  😀😀a ")).toBe(3);
    expect(isTrainingAttemptReady("😀".repeat(60))).toBe(true);
    expect(isTrainingAttemptReady("😀".repeat(59))).toBe(false);
    expect(isTrainingAttemptReady("a".repeat(TRAINING_ATTEMPT_MAX_CHARS))).toBe(true);
    expect(isTrainingAttemptReady("a".repeat(TRAINING_ATTEMPT_MAX_CHARS + 1))).toBe(false);
  });

  it("reports what is missing and flags it once an error is shown", () => {
    const onChange = vi.fn();
    field("😀".repeat(10), true, onChange);
    expect(screen.getByText(/10\/60 caracteres: faltan 50/)).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("reports the excess over the limit", () => {
    field("a".repeat(TRAINING_ATTEMPT_MAX_CHARS + 2));
    expect(screen.getByText("4002/4000 caracteres: sobran 2.")).toBeInTheDocument();
    expect(screen.getByText(/sobran/)).toHaveClass("text-red-600");
  });

  it("is ready without an error", () => {
    field("a".repeat(60), true);
    expect(screen.getByText(/^Listo\./)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });
});
