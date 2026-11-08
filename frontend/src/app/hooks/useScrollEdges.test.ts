import { describe, expect, it } from "vitest";
import { crossAxisGutter, scrollEdges, scrollFadeMaskStyle } from "./useScrollEdges";

function box(sizes: Partial<HTMLElement>): HTMLElement {
    return sizes as HTMLElement;
}

describe("scrollEdges", () => {
    it("reports nothing hidden when the content fits", () => {
        expect(
            scrollEdges(box({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }), "y"),
        ).toEqual({ start: false, end: false });
    });

    it("reports content past the end, then before the start once scrolled", () => {
        const at = (scrollLeft: number) =>
            scrollEdges(box({ scrollLeft, scrollWidth: 1200, clientWidth: 800 }), "x");
        expect(at(0)).toEqual({ start: false, end: true });
        expect(at(200)).toEqual({ start: true, end: true });
        expect(at(400)).toEqual({ start: true, end: false });
    });

    it("ignores the fraction of a pixel subpixel layouts leave", () => {
        expect(
            scrollEdges(box({ scrollTop: 0.5, scrollHeight: 100.6, clientHeight: 100 }), "y"),
        ).toEqual({ start: false, end: false });
    });
});

describe("crossAxisGutter", () => {
    it("is the vertical scrollbar's width for a horizontal scroller", () => {
        expect(
            crossAxisGutter(box({ offsetWidth: 815, clientWidth: 800 }), "x"),
        ).toBe(15);
    });

    it("is the horizontal scrollbar's height for a vertical scroller", () => {
        expect(
            crossAxisGutter(box({ offsetHeight: 415, clientHeight: 400 }), "y"),
        ).toBe(15);
    });

    it("is zero for overlay scrollbars, and never negative", () => {
        expect(
            crossAxisGutter(box({ offsetWidth: 800, clientWidth: 800 }), "x"),
        ).toBe(0);
        expect(
            crossAxisGutter(box({ offsetWidth: 799, clientWidth: 800 }), "x"),
        ).toBe(0);
    });
});

describe("scrollFadeMaskStyle", () => {
    it("adds no mask when nothing is hidden", () => {
        expect(scrollFadeMaskStyle({ start: false, end: false })).toBeUndefined();
    });

    it("fades only the ends that hide content", () => {
        const end = scrollFadeMaskStyle({ start: false, end: true });
        expect(end?.maskImage).toBe(
            "linear-gradient(to bottom, #000, #000 calc(100% - 1.5rem), transparent)",
        );
        expect(end?.WebkitMaskImage).toBe(end?.maskImage);

        const both = scrollFadeMaskStyle({ start: true, end: true });
        expect(both?.maskImage).toBe(
            "linear-gradient(to bottom, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent)",
        );
    });
});
