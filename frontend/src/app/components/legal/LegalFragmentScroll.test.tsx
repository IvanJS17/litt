import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegalFragmentScroll } from "./LegalFragmentScroll";

// jsdom has no layout: each case places the clause where it needs it.
function clauseAt(top: number) {
    const clause = document.createElement("li");
    clause.id = "5-5";
    clause.getBoundingClientRect = () => ({ top, bottom: top + 120 }) as DOMRect;
    clause.scrollIntoView = vi.fn();
    document.body.appendChild(clause);
    return clause;
}

describe("LegalFragmentScroll", () => {
    beforeEach(() => {
        window.history.replaceState(null, "", "/terminos#5-5");
        window.scrollY = 0;
    });
    afterEach(() => {
        document.body.replaceChildren();
        window.history.replaceState(null, "", "/");
        window.scrollY = 0;
    });

    it("brings the linked clause into view when the browser left the page at the top", () => {
        const clause = clauseAt(6000);
        render(<LegalFragmentScroll />);
        expect(clause.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });

    it("does nothing when the browser already landed on the clause", () => {
        const clause = clauseAt(24);
        render(<LegalFragmentScroll />);
        expect(clause.scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves a reader who already scrolled where they are", () => {
        const clause = clauseAt(6000);
        window.scrollY = 300;
        render(<LegalFragmentScroll />);
        expect(clause.scrollIntoView).not.toHaveBeenCalled();
    });

    it("ignores a fragment that names nothing on the page", () => {
        window.history.replaceState(null, "", "/terminos#%E0");
        const clause = clauseAt(6000);
        render(<LegalFragmentScroll />);
        expect(clause.scrollIntoView).not.toHaveBeenCalled();
    });
});
