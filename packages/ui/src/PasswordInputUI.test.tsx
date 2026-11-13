import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasswordInputUI } from "./PasswordInputUI";

describe("PasswordInputUI", () => {
  it("toggles between password and text with aria-pressed and a translated label", async () => {
    render(<PasswordInputUI aria-label="Pw" autoComplete="new-password" />);
    const input = screen.getByLabelText("Pw");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveAttribute("type", "button");
    expect(show).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(show);
    expect(input).toHaveAttribute("type", "text");
    // Same name, state in aria-pressed only.
    expect(screen.queryByRole("button", { name: "Hide password" })).toBeNull();
    const pressed = screen.getByRole("button", { name: "Show password" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(pressed);
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(input).toHaveAttribute("type", "password");
  });

  it("does not submit the form and toggles each field independently", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInputUI aria-label="One" />
        <PasswordInputUI aria-label="Two" disabled />
      </form>,
    );
    const [first, second] = screen.getAllByRole("button");
    await userEvent.click(first);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("One")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Two")).toHaveAttribute("type", "password");
    expect(second).toBeDisabled();
  });
});
