import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { FullScreenLoader } from "./FullScreenLoader";

// The loader is a server component in the app; a test has no request config,
// so the server render gets the same en-US provider the client render does.
const serverRender = (ui: React.ReactNode) =>
    renderToString(
        <IntlClientProvider locale="en-US" messages={enUS}>
            {ui}
        </IntlClientProvider>,
    );

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
    expect(serverRender(<FullScreenLoader />)).toBe(container.innerHTML);
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

it("loads Settings with the sidebar and the settings frame (a column of sections) in grey lines", () => {
    nav.pathname = "/settings/security";
    const { container } = render(<FullScreenLoader />);
    expect(container.querySelector(SIDEBAR)).not.toBeNull();
    const frame = container.querySelector('[data-slot="settings-shell-skeleton"]');
    expect(frame).not.toBeNull();
    // One live region, not one inside another.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(frame?.querySelectorAll("li").length).toBeGreaterThan(8);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(serverRender(<FullScreenLoader />)).toBe(container.innerHTML);
});
