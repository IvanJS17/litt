import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceCodeLinkUI } from "./SourceCodeLinkUI";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("SourceCodeLinkUI", () => {
    it("links the source of the injected commit in a new tab", () => {
        render(<SourceCodeLinkUI commit={SHA} />);
        const link = screen.getByRole("link", { name: /Código fuente/ });
        expect(link).toHaveAttribute(
            "href",
            `https://github.com/IvanJS17/litt/tree/${SHA}`,
        );
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link).toHaveAccessibleName(
            "Código fuente de esta versión (se abre en una pestaña nueva)",
        );
        expect(link.className).toContain("focus-visible:ring-2");
    });

    it("renders nothing without a full commit SHA", () => {
        const { container } = render(<SourceCodeLinkUI commit="" />);
        expect(container).toBeEmptyDOMElement();
    });
});
