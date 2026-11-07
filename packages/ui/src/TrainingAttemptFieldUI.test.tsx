import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TRAINING_ATTEMPT_MAX_CHARS,
  TrainingAttemptFieldUI,
  TrainingUrgencyPassLineUI,
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

describe("TrainingUrgencyPassLineUI", () => {
  const now = new Date(2026, 10, 7, 9, 0);

  it("says until when the pass is in force today, as plain text", () => {
    const end = new Date(2026, 10, 7, 17, 30);
    const { container } = render(<TrainingUrgencyPassLineUI expiresAt={end.toISOString()} now={now} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/^Pase de urgencia vigente hasta las 17:30\./);
    expect(text).toContain("sigue necesitando aprobación");
    expect(container.querySelector("button, [role=status]")).toBeNull();
  });

  it("adds the date when the pass ends another day", () => {
    const end = new Date(2026, 10, 9, 8, 5);
    render(<TrainingUrgencyPassLineUI expiresAt={end.toISOString()} now={now} />);
    expect(screen.getByText(/hasta el 9 de noviembre, a las 08:05/)).toBeInTheDocument();
  });
});
