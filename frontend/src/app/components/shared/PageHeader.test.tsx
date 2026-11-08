import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import {
    PAGE_HEADER_ROW_CLASS,
    PAGE_HEADER_TITLE_CLASS,
} from "./pageHeaderStyles";

// A page's title is one size wherever it appears: as a plain title, as
// breadcrumbs, and as the placeholder shown while a name loads.
describe("PageHeader title size", () => {
    it("is one step below the display headings", () => {
        expect(PAGE_HEADER_TITLE_CLASS.split(" ")).toEqual(
            expect.arrayContaining(["font-serif", "text-xl", "font-medium"]),
        );
        expect(PAGE_HEADER_TITLE_CLASS).not.toContain("text-2xl");
    });

    it("sets the breadcrumbs at the title's size", () => {
        render(
            <PageHeader
                breadcrumbs={[
                    { label: "Organization", onClick: () => {} },
                    { label: "Members", cursor: "text" },
                ]}
            />,
        );
        const trail = screen
            .getAllByText("Members")[0]
            .closest(".font-serif") as HTMLElement;
        expect(trail).toHaveClass("text-xl", "font-medium", "font-serif");
        expect(trail).not.toHaveClass("text-2xl");
    });

    it("holds a loading crumb's place at the height of a line of the title", () => {
        const { container } = render(
            <PageHeader
                breadcrumbs={[
                    { label: "Projects", onClick: () => {} },
                    { loading: true, skeletonClassName: "w-40" },
                ]}
            />,
        );
        const skeleton = container.querySelector(".animate-pulse");
        expect(skeleton).toHaveClass("h-5", "w-40");
    });

    it("sits its title on the same line as the sidebar's logo text", () => {
        // The sidebar's logo row is 44px tall and starts 12px down plus the
        // sidebar's 1px border. The header's 44px of content has to start
        // 13px down too, or the title rides a pixel above the logo.
        // (Measured in a browser; the classes are what hold it there.)
        const { container } = render(
            <PageHeader>
                <h1>Projects</h1>
            </PageHeader>,
        );
        const header = container.firstElementChild;
        expect(header).toHaveClass(
            "min-h-[76px]",
            "md:pt-[13px]",
            "md:pb-[19px]",
        );
        expect(PAGE_HEADER_ROW_CLASS.split(" ")).toEqual(
            expect.arrayContaining([
                "min-h-[76px]",
                "md:pt-[13px]",
                "md:pb-[19px]",
            ]),
        );
    });

    it("lets a page pass its own title at the same size", () => {
        render(
            <PageHeader>
                <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-gray-900`}>
                    Projects
                </h1>
            </PageHeader>,
        );
        expect(screen.getByRole("heading", { name: "Projects" })).toHaveClass(
            "text-xl",
            "font-serif",
        );
    });
});

describe("PageHeader long names", () => {
    const LONG =
        "Arrendamiento Bajío 2026 — revisión integral del contrato marco, anexos A, B y C";

    function renderProjectCrumb() {
        render(
            <PageHeader
                breadcrumbs={[
                    { label: "Projects", onClick: () => {}, title: "Back to Projects" },
                    { label: LONG, onClick: () => {}, title: "Back to project documents" },
                ]}
            />,
        );
        // The visible crumb is the button; hidden copies measure widths.
        return screen.getByRole("button", { name: LONG });
    }

    function cutAt(element: HTMLElement, scrollWidth: number, clientWidth: number) {
        Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
        Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
    }

    it("keeps the whole name in the crumb's accessible name", () => {
        expect(renderProjectCrumb()).toHaveAccessibleName(LONG);
    });

    it("shows the whole name as the tooltip once the name is cut", () => {
        const crumb = renderProjectCrumb();
        cutAt(crumb, 900, 420);
        fireEvent.pointerEnter(crumb);
        expect(crumb).toHaveAttribute("title", LONG);
    });

    it("keeps the action hint as the tooltip while the name fits", () => {
        const crumb = renderProjectCrumb();
        cutAt(crumb, 300, 420);
        fireEvent.pointerEnter(crumb);
        expect(crumb).toHaveAttribute("title", "Back to project documents");
    });

    it("measures on keyboard focus too", () => {
        const crumb = renderProjectCrumb();
        cutAt(crumb, 900, 420);
        fireEvent.focus(crumb);
        expect(crumb).toHaveAttribute("title", LONG);
    });
});
