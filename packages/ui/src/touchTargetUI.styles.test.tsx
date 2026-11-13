import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CloseButton } from "./CloseButton";
import { HeaderButtonUI } from "./HeaderButtonsUI";
import { TOUCH_TARGET_CLASS } from "./touchTargetUI.styles";

describe("TOUCH_TARGET_CLASS", () => {
    it("is on the close button and the header buttons, below the caller's classes", () => {
        render(
            <>
                <CloseButton onClick={() => {}} label="Close" />
                <HeaderButtonUI iconOnly aria-label="Menu" />
            </>,
        );
        for (const name of ["Close", "Menu"]) {
            expect(screen.getByRole("button", { name }).className).toContain(
                "pointer-coarse:after:size-11",
            );
        }
    });
});
