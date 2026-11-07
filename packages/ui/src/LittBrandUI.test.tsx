import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    LITT_PIXEL_MONOGRAM_SIZES,
    LittMonogramPixel,
    LittWordmark,
    littPixelMonogramGeometry,
} from "./LittBrandUI";

describe("LittWordmark", () => {
    it("is one image named LiTT at the 22px minimum by default", () => {
        render(<LittWordmark />);
        const mark = screen.getByRole("img", { name: "LiTT" });
        // 36u × 18.3709u with u = 2px, the height rounded up to a whole pixel.
        expect(mark).toHaveAttribute("width", "72");
        expect(mark).toHaveAttribute("height", "37");
        expect(mark).toHaveAttribute("data-x", "22");
        expect(mark).toHaveAttribute("viewBox", "0 0 36 18.3709");
    });

    it("scales by X, which keeps the pixel letters on whole pixels", () => {
        render(<LittWordmark x={44} className="mx-auto" />);
        const mark = screen.getByRole("img", { name: "LiTT" });
        expect(mark).toHaveAttribute("width", "144");
        expect(mark).toHaveAttribute("height", "74");
        expect(mark).toHaveClass("block", "shrink-0", "mx-auto");
    });

    it("keeps the square at 3u, 1u above the dotless i, in the accent color only", () => {
        const { container } = render(<LittWordmark />);
        const square = container.querySelector('[data-slot="litt-square"]');
        expect(square).toHaveAttribute("x", "14");
        expect(square).toHaveAttribute("y", "4");
        expect(square).toHaveAttribute("width", "3");
        expect(square).toHaveAttribute("height", "3");
        expect((square as SVGElement).style.fill).toContain("--litt-mark-accent");
        // Every letter takes the ink color; none takes the amber.
        const letters = container.querySelector("g");
        expect((letters as SVGElement).style.fill).toContain("--litt-mark-ink");
        expect(letters?.innerHTML).not.toContain("accent");
    });

    it("can be hidden from assistive technology when LiTT is named nearby", () => {
        const { container } = render(<LittWordmark decorative />);
        expect(screen.queryByRole("img")).toBeNull();
        const mark = container.querySelector('[data-slot="litt-wordmark"]');
        expect(mark).toHaveAttribute("aria-hidden", "true");
    });
});

describe("littPixelMonogramGeometry", () => {
    it("matches the package's 16px favicon pixel for pixel", () => {
        expect(littPixelMonogramGeometry(16)).toEqual({
            stem: { x: 4, y: 4, width: 1, height: 8 },
            foot: { x: 4, y: 11, width: 5, height: 1 },
            square: { x: 10, y: 9, width: 3, height: 3 },
        });
    });

    it("matches the package's 32px favicon and doubles every module", () => {
        expect(littPixelMonogramGeometry(32)).toEqual({
            stem: { x: 7, y: 8, width: 2, height: 16 },
            foot: { x: 7, y: 22, width: 10, height: 2 },
            square: { x: 19, y: 18, width: 6, height: 6 },
        });
    });

    it("lands on whole pixels at every native size", () => {
        for (const size of LITT_PIXEL_MONOGRAM_SIZES) {
            const { stem, foot, square } = littPixelMonogramGeometry(size);
            for (const rect of [stem, foot, square]) {
                for (const value of Object.values(rect)) {
                    expect(Number.isInteger(value)).toBe(true);
                }
            }
            // A 1u gap between the foot of the L and the square.
            const u = size / 16;
            expect(square.x - (foot.x + foot.width)).toBe(u);
            expect(square.y + square.height).toBe(foot.y + foot.height);
        }
    });
});

describe("LittMonogramPixel", () => {
    it("is «L.» named LiTT at its native 16px by default", () => {
        const { container } = render(<LittMonogramPixel />);
        const mark = screen.getByRole("img", { name: "LiTT" });
        expect(mark).toHaveAttribute("width", "16");
        expect(mark).toHaveAttribute("height", "16");
        expect(mark).toHaveAttribute("shape-rendering", "crispEdges");
        expect(
            container.querySelector('[data-slot="litt-square"]'),
        ).toHaveAttribute("width", "3");
    });

    it("draws 32 and 48 px natively, not by scaling the 16px one", () => {
        const { rerender } = render(<LittMonogramPixel size={32} />);
        expect(screen.getByRole("img")).toHaveAttribute("viewBox", "0 0 32 32");
        rerender(<LittMonogramPixel size={48} className="m-1" />);
        const mark = screen.getByRole("img");
        expect(mark).toHaveAttribute("viewBox", "0 0 48 48");
        expect(mark).toHaveClass("m-1");
    });

    it("can be decorative", () => {
        const { container } = render(<LittMonogramPixel decorative />);
        expect(screen.queryByRole("img")).toBeNull();
        expect(
            container.querySelector('[data-slot="litt-monogram"]'),
        ).toHaveAttribute("aria-hidden", "true");
    });
});
