import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TRAINING_ATTEMPT_MAX_CHARS,
  TrainingAttemptFieldUI,
  TrainingUrgencyPassLineUI,
  isTrainingAttemptReady,
  trainingAttemptLength,
  trainingAttemptOwnLength,
} from "./TrainingAttemptFieldUI";
import { attemptText } from "./trainingTestText";

const field = (value: string, showError = false, onChange = vi.fn()) =>
  render(
    <TrainingAttemptFieldUI
      id="f"
      value={value}
      onChange={onChange}
      text={attemptText}
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

  it("does not count a quoted question towards the minimum", () => {
    const quote = `> ${"¿En qué precepto se apoya la rescisión? ".repeat(3)}`;
    expect(trainingAttemptLength(quote)).toBeGreaterThan(60);
    expect(trainingAttemptOwnLength(`${quote}\n\nMuy corto`)).toBe(9);
    expect(isTrainingAttemptReady(`${quote}\n\nMuy corto`)).toBe(false);
    expect(isTrainingAttemptReady(`${quote}\n\n${"a".repeat(60)}`)).toBe(true);
    // The server counts everything: the quote still counts towards the limit.
    expect(isTrainingAttemptReady(`${quote}\n\n${"a".repeat(TRAINING_ATTEMPT_MAX_CHARS)}`)).toBe(false);
  });

  it("labels the field and reports what is missing, flagging it once an error is shown", () => {
    const onChange = vi.fn();
    field("😀".repeat(10), true, onChange);
    expect(screen.getByLabelText("Your approach (2–3 lines)")).toBeRequired();
    expect(screen.getByPlaceholderText("Before asking, write how you would solve it.")).toBeInTheDocument();
    expect(screen.getByText("10/60 caracteres: faltan 50.")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("reports the excess over the limit", () => {
    field("a".repeat(TRAINING_ATTEMPT_MAX_CHARS + 2));
    expect(screen.getByText("4002/4000 caracteres: sobran 2.")).toHaveClass("text-destructive");
  });

  it("is ready without an error", () => {
    field("a".repeat(60), true);
    expect(screen.getByText("Ready.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });
});

describe("TrainingUrgencyPassLineUI", () => {
  it("draws the sentence the host wrote, as plain text", () => {
    const { container } = render(<TrainingUrgencyPassLineUI text="Pase vigente." className="x" />);
    expect(container.textContent).toBe("Pase vigente.");
    expect(container.querySelector("button, [role=status]")).toBeNull();
  });
});
