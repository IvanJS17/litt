import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FullScreenLoader } from "./FullScreenLoader";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const SIDEBAR = '[data-slot="app-shell-skeleton-sidebar"]';

// The pages the visual audit caught on a sidebar-less spinner for 3+ s.
it.each([
    "/workflows/assistant/w1",
    "/playbooks/p1",
    "/settings/models",
    "/organizations/o1/settings/members",
])("loads %s with the sidebar and header in place", (pathname) => {
    nav.pathname = pathname;
    const { container } = render(<FullScreenLoader />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(container.querySelector(SIDEBAR)).not.toBeNull();
    // Server and client paint the same loader for the same path.
    expect(renderToString(<FullScreenLoader />)).toBe(container.innerHTML);
});

it.each(["/signup/check-email", "/onboarding/profile", "/verify-mfa"])(
    "keeps the spinner on %s, which has no sidebar",
    (pathname) => {
        nav.pathname = pathname;
        const { container } = render(<FullScreenLoader />);
        expect(container.querySelector(SIDEBAR)).toBeNull();
        expect(container.querySelector(".animate-spin")).not.toBeNull();
    },
);
