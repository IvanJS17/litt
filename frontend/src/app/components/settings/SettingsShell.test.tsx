import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { settingsTabButtonClassName } from "@/app/(pages)/settings/settingsStyles";
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

    it("draws the group titles in ink and the page-title serif, on the desktop bar and the phone list", () => {
        mockPathname = "/settings/menu";
        render(
            <SettingsShell
                title="Settings"
                navLabel="Settings sections"
                rootHref="/settings"
                tabs={[{ id: "account", label: "Account", href: "/settings" }]}
                groups={[{ id: "a", label: "My account", tabIds: ["account"] }]}
                mobileHome={{ href: "/settings/menu", backLabel: "Settings" }}
            >
                <p>page</p>
            </SettingsShell>,
        );
        const titles = screen.getAllByRole("heading", { name: "My account" });
        expect(titles).toHaveLength(2);
        for (const title of titles) {
            expect(title).toHaveClass("font-serif", "text-gray-900");
            expect(title.className).not.toContain("text-xs");
            expect(title.className).not.toContain("text-gray-500");
        }
    });

    it("draws who the section applies to as labels under its help text", () => {
        mockPathname = "/settings";
        render(
            <SettingsShell
                title="Settings"
                navLabel="Settings sections"
                rootHref="/settings"
                tabs={[
                    {
                        id: "account",
                        label: "Account",
                        href: "/settings",
                        help: "Check your profile.",
                        audience: [{ icon: "user", label: "Only for you" }],
                    },
                ]}
            >
                <p>page</p>
            </SettingsShell>,
        );
        const help = document.querySelector('[data-slot="settings-tab-help"]')!;
        expect(help).toHaveTextContent("Check your profile.");
        expect(help.textContent).not.toContain("Only for you");
        expect(screen.getByText("Only for you")).toBeVisible();
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
        };
        const groups = [
            { id: "a", label: "Account group", tabIds: ["account", "memory"] },
            { id: "k", label: "Keys group", tabIds: ["byok"] },
        ];
        const renderShell = () =>
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs} groups={groups} mobileHome={mobileHome} search={<input aria-label="Search settings" />}>
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
    describe("groups on a desktop", () => {
        const tabs = [
            { id: "account", label: "Account", href: "/settings", help: "Check your profile." },
            { id: "memory", label: "Memory", href: "/settings/memory" },
            { id: "byok", label: "Keys", href: "/settings/byok" },
        ];
        const groups = [
            { id: "a", label: "Account group", tabIds: ["account", "memory"] },
            { id: "k", label: "Keys group", tabIds: ["byok"] },
        ];

        it("heads each group down the side and keeps every tab in its group", () => {
            mockPathname = "/settings";
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs} groups={groups}>
                    <p>page</p>
                </SettingsShell>,
            );
            const side = screen.getByRole("navigation", { name: "Settings sections" });
            const lists = within(side).getAllByRole("list", { name: /group$/ });
            expect(lists.map((list) => list.textContent)).toEqual(["AccountMemory", "Keys"]);
            expect(within(side).getByRole("heading", { name: "Keys group" })).toBeInTheDocument();
        });

        it("says what the open section is for, above the page, and a banner above all", () => {
            mockPathname = "/settings";
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs} groups={groups} banner={<span>Other home</span>}>
                    <p>page</p>
                </SettingsShell>,
            );
            expect(screen.getByText("Check your profile.")).toBeInTheDocument();
            expect(screen.getByText("Other home")).toBeInTheDocument();
        });

        it("keeps the help to the section's own page, not its detail pages", () => {
            mockPathname = "/settings/memory/detail";
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs} groups={groups}>
                    <p>page</p>
                </SettingsShell>,
            );
            expect(screen.queryByText("Check your profile.")).toBeNull();
        });
    });
    describe("the bar stays in view while the open section scrolls", () => {
        const tabs = [
            { id: "account", label: "Account", href: "/settings" },
            { id: "memory", label: "Memory", href: "/settings/memory" },
        ];

        it("is sticky from 820 px, no taller than the scroll area, and scrolls by itself", () => {
            mockPathname = "/settings";
            render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs}>
                    <p>page</p>
                </SettingsShell>,
            );
            const bar = screen.getByRole("navigation", { name: "Settings sections" });
            expect(bar).toHaveAttribute("data-slot", "settings-bar");
            for (const name of [
                "sticky",
                "top-3",
                "max-h-[calc(100cqh-1.5rem)]",
                "overflow-y-auto",
                "overscroll-contain",
            ]) {
                expect(bar.className).toContain(`@min-[820px]/settings:${name}`);
            }
            // The height is measured against the scroll area, not the window.
            expect(bar.className).not.toContain("dvh");
            expect(bar.closest(".\\[container-type\\:size\\]")).not.toBeNull();
            // Nothing changes on a phone: the bar is still hidden by `mobileHome`.
        });

        it("brings the open section into view on arriving and on changing section, only", () => {
            const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
            mockPathname = "/settings/memory";
            const { rerender } = render(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs}>
                    <p>page</p>
                </SettingsShell>,
            );
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
            expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("button", { name: "Memory" }));
            // Re-rendering on the same route leaves a scrolled bar alone.
            rerender(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs}>
                    <p>other page</p>
                </SettingsShell>,
            );
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            mockPathname = "/settings";
            rerender(
                <SettingsShell title="Settings" navLabel="Settings sections" rootHref="/settings" tabs={tabs}>
                    <p>page</p>
                </SettingsShell>,
            );
            expect(scrollIntoView).toHaveBeenCalledTimes(2);
            expect(scrollIntoView.mock.contexts[1]).toBe(screen.getByRole("button", { name: "Account" }));
            scrollIntoView.mockRestore();
        });
    });

    describe("the amber ring is for the keyboard", () => {
        it("draws it on focus-visible only, never on focus, for the open section and the others", () => {
            for (const active of [true, false]) {
                const classes = settingsTabButtonClassName(active).split(/\s+/);
                expect(classes).toContain("focus-visible:ring-2");
                expect(classes).toContain("focus-visible:ring-focus");
                // The pointer guard of globals.css clears the ring after a click.
                expect(classes).toContain("keyboard-focus-ring");
                expect(classes.filter((name) => /^focus:(ring|outline-(?!none))/.test(name))).toEqual([]);
            }
        });

        it("marks the open section as selected, with no ring or outline of its own", () => {
            const open = settingsTabButtonClassName(true);
            expect(open).toContain("bg-gray-100");
            expect(open.split(/\s+/).filter((name) => /^(ring|outline)-/.test(name))).toEqual([]);
        });
    });
});
