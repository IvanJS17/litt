import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { APP_SHELL_SEGMENTS, isAppShellRoute } from "./appShellRoutes";

it("lists exactly the route directories of the sidebar layout", () => {
    const pagesDir = path.resolve(__dirname, "../(pages)");
    const routes = readdirSync(pagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    expect([...APP_SHELL_SEGMENTS].sort()).toEqual(routes);
});

it("matches whole first segments only", () => {
    expect(isAppShellRoute("/settings/models")).toBe(true);
    expect(isAppShellRoute("/organizations/o1/settings/members")).toBe(true);
    expect(isAppShellRoute("/settingsx")).toBe(false);
    expect(isAppShellRoute("/onboarding/profile")).toBe(false);
    expect(isAppShellRoute("/signup/check-email")).toBe(false);
    expect(isAppShellRoute("/")).toBe(false);
    expect(isAppShellRoute(null)).toBe(false);
});
