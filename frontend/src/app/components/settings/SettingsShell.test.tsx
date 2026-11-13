import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsShell } from "./SettingsShell";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => "/settings",
}));

describe("SettingsShell", () => {
    it("lets the title and the search wrap, the search taking the full width on a phone", () => {
        render(
            <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={[]} search={<input aria-label="Search settings" />}>
                <p>page</p>
            </SettingsShell>,
        );
        const header = screen.getByRole("heading", { name: "Settings" }).parentElement!;
        expect(header.className).toContain("flex-wrap");
        expect(header.className).toContain("md:flex-nowrap");
        const box = screen.getByLabelText("Search settings").parentElement!;
        expect(box.className).toContain("w-full");
        // The cap applies from md up only.
        expect(box.className).not.toMatch(/(^|\s)max-w-\[18rem\]/);
        expect(box.className).toContain("md:max-w-[18rem]");
    });
});
