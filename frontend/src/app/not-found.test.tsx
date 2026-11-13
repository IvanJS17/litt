import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";

vi.mock("@/app/components/site-logo", () => ({ SiteLogo: () => <div>LiTT logo</div> }));

describe("not-found page", () => {
    it("is drawn in the sign-in frame: the logo, the paper and a phone-height page", () => {
        const { container } = render(<NotFound />);
        expect(screen.getByText("LiTT logo")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
        const frame = container.firstElementChild as HTMLElement;
        expect(frame.className).toContain("min-h-dvh");
        expect(frame.className).toContain("bg-app-background");
        expect(frame.className).not.toContain("min-h-screen");
        expect(frame.className).not.toContain("bg-white");
    });
});
