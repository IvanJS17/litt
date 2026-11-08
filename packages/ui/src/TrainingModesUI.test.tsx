import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrainingModesUI, type TrainingModesState } from "./TrainingModesUI";
import { modesText } from "./trainingTestText";

const OPEN: TrainingModesState = {
  modes: ["hint", "counterpart"],
  nextHintLevel: 1,
  counterpartNextStep: 1,
};

const modes = (
  state: TrainingModesState = OPEN,
  props: Partial<React.ComponentProps<typeof TrainingModesUI>> = {},
) =>
  render(
    <TrainingModesUI id="m" state={state} text={modesText} onPick={vi.fn()} {...props} />,
  );

describe("TrainingModesUI", () => {
  it("offers a hint and a round, as buttons that do not submit a form", () => {
    modes();
    const hint = screen.getByRole("button", { name: "Ask for a hint" });
    const round = screen.getByRole("button", {
      name: "Test it against the counterparty's lawyer",
    });
    expect(hint).toHaveAttribute("type", "button");
    expect(round).toHaveAttribute("type", "button");
    expect(screen.queryByRole("button", { name: "Close the round" })).toBeNull();
    expect(screen.getByRole("region", { name: "Help for this turn" })).toBeInTheDocument();
  });

  it("asks for the mode that was clicked", () => {
    const onPick = vi.fn();
    modes({ ...OPEN, modes: ["hint", "counterpart", "counterpart_close"] }, { onPick });
    fireEvent.click(screen.getByRole("button", { name: "Ask for a hint" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Test it against the counterparty's lawyer" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close the round" }));
    expect(onPick.mock.calls.map(([mode]) => mode)).toEqual([
      "hint",
      "counterpart",
      "counterpart_close",
    ]);
  });

  it("says which rung is next in words, with the used ones marked and the next one as the current step", () => {
    modes({ ...OPEN, nextHintLevel: 2 });
    expect(screen.getByText("Next: hint 2 of 3, Where to look.")).toBeInTheDocument();
    const rungs = screen.getByRole("list", { name: "Rungs of the hint ladder" });
    const items = within(rungs).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Focus, used",
      "2Where to look, next",
      "3What to review, pending",
    ]);
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  it("describes each button by its own explanation", () => {
    modes();
    const hint = screen.getByRole("button", { name: "Ask for a hint" });
    expect(hint).toHaveAccessibleDescription(
      "A hint never gives the answer. Next: hint 1 of 3, Focus.",
    );
    expect(
      screen.getByRole("button", { name: "Test it against the counterparty's lawyer" }),
    ).toHaveAccessibleDescription("The AI plays the other side. Turn 1 of 3.");
  });

  it("says the hints are used up and offers no hint button", () => {
    modes({ modes: ["counterpart"], nextHintLevel: null, counterpartNextStep: 2 });
    expect(screen.queryByRole("button", { name: "Ask for a hint" })).toBeNull();
    expect(screen.getByText("You already asked for all three hints.")).toBeInTheDocument();
    expect(screen.getByText("Turn 2 of 3.")).toBeInTheDocument();
  });

  it("offers only to close a round that is full", () => {
    modes({ modes: ["counterpart_close"], nextHintLevel: null, counterpartNextStep: null });
    expect(screen.getByText("This round already had three turns.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Test it against the counterparty's lawyer" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Close the round" })).toBeInTheDocument();
  });

  it("draws nothing when no mode is open", () => {
    const { container } = modes({ modes: [], nextHintLevel: null, counterpartNextStep: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("disables the buttons and announces an error tied to them", () => {
    modes(OPEN, { disabled: true, error: "Write your question first." });
    expect(screen.getByRole("button", { name: "Ask for a hint" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Write your question first.");
    expect(screen.getByRole("button", { name: "Ask for a hint" })).toHaveAccessibleDescription(
      expect.stringContaining("Write your question first."),
    );
  });
});
