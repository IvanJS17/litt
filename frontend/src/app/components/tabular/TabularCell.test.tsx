import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TabularCell as TabularCellData } from "../shared/types";
import { TabularCell } from "./TabularCell";

describe("TabularCell", () => {
    it("passes the cited source document through the click handler", () => {
        const onCitationClick = vi.fn();
        const cell = {
            id: "cell-1",
            status: "done",
            content: {
                summary:
                    "Answer [[document:doc-2||page:4||quote:Exact language]]",
                flag: "grey",
                reasoning: "",
            },
        } as TabularCellData;

        render(
            <TabularCell
                cell={cell}
                onExpand={vi.fn()}
                onCitationClick={onCitationClick}
            />,
        );

        fireEvent.click(screen.getByTitle('Page 4: "Exact language"'));

        expect(onCitationClick).toHaveBeenCalledWith(
            4,
            "Exact language",
            1,
            undefined,
            undefined,
            "doc-2",
        );
    });
});

describe("TabularCell citation review hint", () => {
    const cell = {
        id: "cell-1",
        status: "done",
        content: {
            summary:
                "A [[document:doc-1||page:1||quote:One]] and B [[document:doc-1||page:2||quote:Two]]",
            flag: "grey",
            reasoning: "",
        },
    } as TabularCellData;

    it("shows the hint after the listed citation only", () => {
        const { container } = render(
            <TabularCell cell={cell} reviewRefs={[2]} onExpand={vi.fn()} />,
        );
        const hints = container.querySelectorAll("[data-citation-review-hint]");
        expect(hints).toHaveLength(1);
        expect(hints[0]).toHaveAttribute("data-citation-review-hint", "2");
        // Collapsed: one hint, outside the clamped text, for the listed ref.
        expect(hints[0].closest(".line-clamp-1")).toBeNull();
    });

    it("shows nothing without a listed ref", () => {
        const { container } = render(<TabularCell cell={cell} onExpand={vi.fn()} />);
        expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
    });
});

describe("TabularCell collapsed citation review hint", () => {
    const longCell = {
        id: "cell-2",
        status: "done",
        content: {
            summary: `${"Very long first line ".repeat(40)} [[document:doc-1||page:1||quote:One]]`,
            flag: "red",
            reasoning: "",
        },
    } as TabularCellData;

    it("draws the hint beside, not inside, the clamped text", () => {
        const { container } = render(
            <TabularCell cell={longCell} reviewRefs={[1]} onExpand={vi.fn()} />,
        );
        const hint = container.querySelector("[data-citation-review-hint]");
        expect(hint).not.toBeNull();
        expect(hint?.closest(".line-clamp-1")).toBeNull();
        expect(container.querySelectorAll("[data-citation-review-hint]")).toHaveLength(1);
    });

    it("ignores refs the cell does not have", () => {
        const { container } = render(
            <TabularCell cell={longCell} reviewRefs={[7]} onExpand={vi.fn()} />,
        );
        expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
    });
});
