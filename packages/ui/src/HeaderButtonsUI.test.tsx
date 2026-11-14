import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    HeaderButtonUI,
    HeaderButtonsUI,
} from "./HeaderButtonsUI";

describe("HeaderButtonsUI", () => {
    it("renders the shared action group and icon button styling", () => {
        render(
            <HeaderButtonsUI data-testid="actions">
                <HeaderButtonUI iconOnly aria-label="New chat">
                    +
                </HeaderButtonUI>
            </HeaderButtonsUI>,
        );

        expect(screen.getByTestId("actions")).toHaveClass(
            "rounded-full",
            "bg-surface-sheet",
            "shadow-elev-sheet",
        );
        expect(screen.getByRole("button", { name: "New chat" })).toHaveClass(
            "h-7",
            "w-7",
            "rounded-full",
            "liquid-glass-hover",
            "liquid-glass-pressed",
        );
    });
});
