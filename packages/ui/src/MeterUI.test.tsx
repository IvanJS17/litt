import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeterUI } from "./MeterUI";

describe("MeterUI", () => {
    it("is a named progress bar with its value, range and text", () => {
        render(<MeterUI label="Storage space in use" value={40} valueText="4 GB of 10 GB" />);
        const bar = screen.getByRole("progressbar", { name: "Storage space in use" });
        expect(bar).toHaveAttribute("aria-valuenow", "40");
        expect(bar).toHaveAttribute("aria-valuemin", "0");
        expect(bar).toHaveAttribute("aria-valuemax", "100");
        expect(bar).toHaveAttribute("aria-valuetext", "4 GB of 10 GB");
    });

    it("fills as much of the track as the value says", () => {
        const { container } = render(<MeterUI label="Use" value={40} />);
        expect(container.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "40%" });
        expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuetext");
    });

    it("keeps a value outside the range inside it", () => {
        const { container, rerender } = render(<MeterUI label="Use" value={250} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        expect(container.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "100%" });
        rerender(<MeterUI label="Use" value={-3} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        expect(container.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "0%" });
    });

    it("takes another range", () => {
        const { container } = render(<MeterUI label="Use" value={5} min={0} max={20} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "20");
        expect(container.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "25%" });
    });

    it("does not divide by an empty range", () => {
        const { container } = render(<MeterUI label="Use" value={5} min={3} max={3} />);
        expect(container.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "0%" });
    });
});
