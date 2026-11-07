import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LITT_HOME_URL, SiteLogo } from "./site-logo";

describe("SiteLogo", () => {
    it("is the outlined wordmark as the page heading, at X = 33 by default", () => {
        render(<SiteLogo />);
        const heading = screen.getByRole("heading", { level: 1 });
        const mark = screen.getByRole("img", { name: "LiTT" });
        expect(heading).toContainElement(mark);
        expect(mark).toHaveAttribute("data-x", "33");
        // The wordmark is never typed out in a font.
        expect(heading.textContent).toBe("");
    });

    it.each([
        ["sm", "22"],
        ["md", "33"],
        ["lg", "44"],
        ["xl", "66"],
    ] as const)("maps size %s to X = %s", (size, x) => {
        render(<SiteLogo size={size} className="mb-4" />);
        expect(screen.getByRole("img", { name: "LiTT" })).toHaveAttribute(
            "data-x",
            x,
        );
        expect(screen.getByRole("heading")).toHaveClass("flex", "mb-4");
    });

    it("links to LiTT's own page in the same tab, not to the upstream site", () => {
        render(<SiteLogo size="lg" asLink />);
        const link = screen.getByRole("link", { name: /LiTT/ });
        expect(link).toHaveAttribute("href", LITT_HOME_URL);
        expect(LITT_HOME_URL).not.toContain("mikeoss");
        expect(link).not.toHaveAttribute("target");
        expect(link).toHaveAccessibleName("LiTT");
    });
});
