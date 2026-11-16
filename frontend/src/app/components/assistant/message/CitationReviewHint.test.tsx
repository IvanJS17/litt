import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DocumentCitation } from "../../shared/types";
import { CitationReviewHint, needsCitationReview } from "./CitationReviewHint";
import { CitationsBlock } from "./CitationSources";
import { MarkdownContent } from "./MarkdownContent";

const LABEL = "Check this citation";
const DESCRIPTION =
    "The automatic review suggests the quoted text may not support what is claimed. Check it before relying on it.";

function documentCitation(ref: number): DocumentCitation {
    return {
        type: "citation_data",
        kind: "document",
        ref,
        doc_id: `doc-${ref}`,
        document_id: `document-${ref}`,
        filename: `source-${ref}.pdf`,
        page: ref,
        quote: `Quote ${ref}`,
        quotes: [{ page: ref, quote: `Quote ${ref}` }],
    };
}

describe("needsCitationReview", () => {
    it("is true only for a ref in the list", () => {
        expect(needsCitationReview([2, 4], 2)).toBe(true);
        expect(needsCitationReview([2, 4], 3)).toBe(false);
        expect(needsCitationReview([], 1)).toBe(false);
        expect(needsCitationReview(undefined, 1)).toBe(false);
        expect(needsCitationReview([1], undefined)).toBe(false);
    });
});

describe("CitationReviewHint", () => {
    it("reads its text from the catalog and describes itself to assistive technology", () => {
        render(<CitationReviewHint citationRef={2} />);
        const hint = screen.getByText(LABEL, { selector: "span" });
        expect(hint).toHaveAccessibleDescription(DESCRIPTION);
        expect(hint).toHaveAttribute("title", DESCRIPTION);
    });
});

describe("the hint in an answer", () => {
    it("is drawn next to the listed citations only, with no mark for the others", () => {
        const targets = [documentCitation(1), documentCitation(2), documentCitation(3)];
        const { container } = render(
            <MarkdownContent
                text={"Uno `§0§` dos `§1§` tres `§2§`."}
                inlineCitationTargets={targets}
                reviewRefs={[2]}
            />,
        );
        const hints = container.querySelectorAll("[data-citation-review-hint]");
        expect(hints).toHaveLength(1);
        expect(hints[0]).toHaveAttribute("data-citation-review-hint", "2");
        // The hint follows citation 2's pill.
        const pill2 = container.querySelector('[data-citation-ref="2"]');
        expect(pill2?.nextElementSibling).toBe(hints[0]);
        expect(container.textContent).not.toMatch(/verified|✓|✔/i);
    });

    it("draws nothing when no ref is listed", () => {
        const { container } = render(
            <MarkdownContent text={"Uno `§0§`."} inlineCitationTargets={[documentCitation(1)]} />,
        );
        expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
    });

    it("is drawn in the sources list beside the listed citation only", () => {
        render(
            <CitationsBlock
                citations={[documentCitation(1), documentCitation(2)]}
                reviewRefs={[1]}
            />,
        );
        const hints = screen.getAllByText(LABEL, { selector: "span" });
        expect(hints).toHaveLength(1);
        expect(within(hints[0].parentElement as HTMLElement).getByRole("button")).toHaveTextContent("1");
    });
});
