import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CitationReviewHintUI } from "./CitationReviewHintUI";

const LABEL = "Check this citation";
const DESCRIPTION =
    "The automatic review suggests the quoted text may not support what is claimed. Check it before relying on it.";

describe("CitationReviewHintUI", () => {
    it("is plain text in the warning tone, not a pill, with its description", () => {
        render(<CitationReviewHintUI label={LABEL} description={DESCRIPTION} citationRef={2} />);

        const hint = screen.getByText(LABEL, { selector: "span" });
        expect(hint).toHaveClass("text-warning");
        expect(hint.className).not.toMatch(/rounded|\bbg-|border/);
        expect(hint).toHaveAttribute("title", DESCRIPTION);
        expect(hint).toHaveAccessibleDescription(DESCRIPTION);
        expect(hint).toHaveAttribute("data-citation-review-hint", "2");
    });

    it("never says verified, supported or a number", () => {
        const { container } = render(<CitationReviewHintUI label={LABEL} description={DESCRIPTION} />);
        expect(container.textContent).not.toMatch(/verif|✓|✔|\d/i);
    });
});
