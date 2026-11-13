import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsShell } from "./SettingsShell";

let mockPathname = "/settings";
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => mockPathname,
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

    describe("mobileHome", () => {
        const tabs = [
            { id: "account", label: "Account", href: "/settings" },
            { id: "memory", label: "Memory", href: "/settings/memory" },
            { id: "byok", label: "Keys", href: "/settings/byok" },
            { id: "extra", label: "Extra", href: "/settings/extra" },
        ];
        const mobileHome = {
            href: "/settings/menu",
            backLabel: "Settings",
            groups: [
                { id: "a", label: "Account group", tabIds: ["account", "memory"] },
                { id: "k", label: "Keys group", tabIds: ["byok"] },
            ],
        };
        const renderShell = () =>
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs} mobileHome={mobileHome} search={<input aria-label="Search settings" />}>
                    <p>page</p>
                </SettingsShell>,
            );

        it("lists the sections in groups on the phone home, ungrouped ones last, and hides the page", () => {
            mockPathname = "/settings/menu";
            renderShell();
            const list = document.querySelector('[data-slot="settings-phone-list"]')!;
            expect(list.className).toContain("md:hidden");
            const groups = Array.from(list.querySelectorAll("section")).map((section) => section.textContent);
            expect(groups).toEqual(["Account groupAccountMemory", "Keys groupKeys", "Extra"]);
            expect(list.querySelector('a[href="/settings/memory"]')).not.toBeNull();
            expect(screen.getByText("page").parentElement!.className).toContain("max-md:hidden");
            expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
        });

        it("shows a back button to the list, and no title or search, in a section on the phone", () => {
            mockPathname = "/settings/memory";
            renderShell();
            expect(document.querySelector('[data-slot="settings-phone-list"]')).toBeNull();
            const back = screen.getByRole("link", { name: "Settings" });
            expect(back).toHaveAttribute("href", "/settings/menu");
            expect(back.parentElement!.className).toContain("md:hidden");
            expect(screen.getByRole("heading", { name: "Settings" }).parentElement!.className).toContain("max-md:hidden");
            expect(screen.getByText("page").parentElement!.className).not.toContain("max-md:hidden");
        });

        it("keeps the tab strip for md and up only", () => {
            mockPathname = "/settings";
            renderShell();
            expect(screen.getAllByRole("navigation", { hidden: true }).at(-1)!.className).toContain("max-md:hidden");
        });
    });
});
