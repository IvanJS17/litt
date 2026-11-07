import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isTrainingHeld, TRAINING_HELD_LABEL, TrainingHeldNoteUI } from "./TrainingHeldNoteUI";

describe("TrainingHeldNoteUI", () => {
  it("says in plain text that the draft waits for approval", () => {
    render(<TrainingHeldNoteUI className="mt-1" />);
    const note = screen.getByText(TRAINING_HELD_LABEL);
    expect(note.tagName).toBe("SPAN");
    expect(note).toHaveClass("mt-1", "text-muted-foreground");
  });

  it("holds only what the server marked held", () => {
    expect(isTrainingHeld({ training_held: true })).toBe(true);
    expect(isTrainingHeld({ training_held: false })).toBe(false);
    expect(isTrainingHeld({})).toBe(false);
    expect(isTrainingHeld(null)).toBe(false);
  });
});
