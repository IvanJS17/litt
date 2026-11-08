import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainingNoteUI } from "./TrainingNoteUI";
import { noteText } from "./trainingTestText";
import { requestTrainingReply } from "./trainingReply";

vi.mock("./trainingReply", () => ({ requestTrainingReply: vi.fn() }));

afterEach(() => vi.clearAllMocks());

const base = { attempt: "Creo que procede la rescisión." };
const ready = {
  ...base,
  contrast: "Coincide: la cláusula quinta aplica.",
  contrast_status: "ready" as const,
};

const note = (
  value: React.ComponentProps<typeof TrainingNoteUI>["note"],
  more: Partial<React.ComponentProps<typeof TrainingNoteUI>> = {},
) => render(<TrainingNoteUI note={value} text={noteText} {...more} />);

describe("TrainingNoteUI", () => {
  it("shows the approach, the contrast and the privacy legend", () => {
    note(ready, { className: "extra" });
    expect(screen.getByRole("region", { name: "Private training notes" })).toHaveClass("extra");
    expect(screen.getByRole("heading", { name: "Your approach" })).toBeInTheDocument();
    expect(screen.getByText(base.attempt)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contrast with your approach" })).toBeInTheDocument();
    expect(screen.getByText("Coincide: la cláusula quinta aplica.")).toBeInTheDocument();
    expect(screen.getByText("Private: only you and your mentor see this")).toBeInTheDocument();
    // A note of layers 1 and 2 has no mark, no verdict and no question.
    expect(screen.queryByText(/Your mark/)).toBeNull();
    expect(screen.queryByText(/Match with the answer/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says how sure the pasante was, by name", () => {
    note({ ...ready, confidence: 4 });
    expect(screen.getByText("Your mark: Sure")).toBeInTheDocument();
    expect(screen.getByText(base.attempt).closest("div")).toHaveTextContent("Your mark: Sure");
  });

  it("says the contrast is being generated", () => {
    note({ ...base, contrast: null, contrast_status: "pending" });
    expect(screen.getByRole("status")).toHaveTextContent("Generating contrast…");
  });

  it.each([
    ["failed", null],
    ["ready", null],
  ] as const)("says the contrast failed (%s, %s)", (status, contrast) => {
    note({ ...base, contrast, contrast_status: status, effective_verdict: "coincide" });
    expect(screen.getByText("The contrast couldn't be generated")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Match with the answer/)).toBeNull();
  });

  it("draws no contrast block, verdict or question for a turn with nothing to contrast", () => {
    note({
      ...base,
      contrast: null,
      contrast_status: "skipped",
      effective_verdict: "coincide",
      foundation_question: "¿Por qué?",
    });
    expect(screen.getByText(base.attempt)).toBeInTheDocument();
    expect(screen.queryByText("Contrast with your approach")).toBeNull();
    expect(screen.queryByText(/Match with the answer/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["coincide", "Matches"],
    ["parcial", "Partly matches"],
    ["no_coincide", "Doesn't match"],
  ] as const)("names the verdict %s in words", (verdict, label) => {
    note({ ...ready, effective_verdict: verdict });
    expect(screen.getByText("Match with the answer, per the AI contrast:")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/corrected by|per your mentor/)).toBeNull();
  });

  it("names a hint by its rung and a counterpart turn by its turn, with no contrast block", () => {
    const { unmount } = note({
      ...base,
      contrast: null,
      contrast_status: "skipped",
      mode: "hint",
      step: 2,
    });
    expect(screen.getByText("Hint 2 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contrast with your approach" })).toBeNull();
    unmount();
    note({ ...base, contrast: null, contrast_status: "skipped", mode: "counterpart", step: 1 });
    expect(screen.getByText("Round, turn 1 of 3")).toBeInTheDocument();
  });

  it("heads the contrast of a closed round as how the round went", () => {
    note({
      ...ready,
      contrast: "Sostuviste: la primera.",
      mode: "counterpart_close",
      step: 3,
    });
    expect(screen.getByText("Close of the round")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How the round went" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contrast with your approach" })).toBeNull();
    expect(screen.getByText("Sostuviste: la primera.")).toBeInTheDocument();
  });

  it("falls back to the first step when a mode note carries none", () => {
    note({ ...base, contrast: null, contrast_status: "skipped", mode: "hint" });
    expect(screen.getByText("Hint 1 of 3")).toBeInTheDocument();
  });

  it("says when the mentor wrote the verdict and shows the basis", () => {
    note({
      ...ready,
      effective_verdict: "parcial",
      verdict_source: "mentor",
      foundation: "weak",
    });
    expect(screen.getByText("Partly matches")).toBeInTheDocument();
    // The verdict is not the AI contrast's: its heading must not say so.
    expect(screen.getByText("Match with the answer, per your mentor:")).toBeInTheDocument();
    expect(screen.queryByText(/per the AI contrast/)).toBeNull();
    // The mentor is named once, in the heading.
    expect(screen.getAllByText(/per your mentor/)).toHaveLength(1);
    expect(screen.queryByText(/corrected by/)).toBeNull();
    expect(screen.getByText("Basis: weak")).toBeInTheDocument();
  });

  it("names a right-for-the-wrong-reason turn", () => {
    note({
      ...ready,
      effective_verdict: "parcial",
      right_for_wrong_reason: true,
      foundation: "wrong",
    });
    expect(screen.getByText("Right for the wrong reason.")).toBeInTheDocument();
    expect(screen.getByText("Basis: wrong")).toBeInTheDocument();
  });

  it("offers «Responder» on the basis question and takes it to the chat's composer", () => {
    note({
      ...ready,
      chat_id: "chat-9",
      effective_verdict: "coincide",
      foundation: "weak",
      foundation_question: "  ¿En qué precepto se apoya?  ",
    });
    expect(screen.getByRole("heading", { name: "A question about your basis" })).toBeInTheDocument();
    expect(screen.getByText("¿En qué precepto se apoya?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reply to the question about your basis" }));
    expect(requestTrainingReply).toHaveBeenCalledWith("¿En qué precepto se apoya?", "chat-9");
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("lets the host decide where the answer goes", () => {
    const onReply = vi.fn();
    note({ ...ready, foundation_question: "¿Por qué?" }, { onReply });
    fireEvent.click(screen.getByRole("button"));
    expect(onReply).toHaveBeenCalledWith("¿Por qué?");
    expect(requestTrainingReply).not.toHaveBeenCalled();
  });

  it("draws no question while the contrast is not ready", () => {
    note({ ...base, contrast: null, contrast_status: "pending", foundation_question: "¿Por qué?" });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
