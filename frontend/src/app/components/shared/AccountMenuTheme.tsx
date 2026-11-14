"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { DropdownItem, DropdownSeparator, ThemeSegmentedUI } from "@mike/ui";
import { useThemeChoice } from "@/app/hooks/useThemeChoice";

/**
 * The theme in the account menu: Claro, Oscuro or Automático, one click away
 * (the other home is Settings > Appearance; both save the same field). It
 * sits after the workspace and before Settings. Choosing does not close the
 * menu, so the change is seen while the menu is still there. With Automático
 * it also says what the device gave: "now: dark".
 *
 * A menu item holds the group, so the menu's own arrow keys reach it: focus
 * on the item goes to the chosen option, Left and Right change it, and Up and
 * Down walk on to the next item like anywhere else in the menu.
 */
export function AccountMenuTheme() {
    const t = useTranslations();
    const { theme, resolved, saving, choose } = useThemeChoice();
    const groupRef = useRef<HTMLDivElement>(null);
    if (!theme) return null;

    const name = t("shared.appSidebar.theme");
    return (
        <>
            <DropdownItem
                aria-label={name}
                data-slot="account-menu-theme"
                // Choosing is not leaving: the menu stays open.
                onSelect={(event) => event.preventDefault()}
                onFocus={(event) => {
                    if (event.target === event.currentTarget) {
                        groupRef.current
                            ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
                            ?.focus();
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    if (event.target === event.currentTarget) return;
                    const items = Array.from(
                        event.currentTarget
                            .closest<HTMLElement>('[role="menu"]')
                            ?.querySelectorAll<HTMLElement>(
                                '[role^="menuitem"]:not([data-disabled])',
                            ) ?? [],
                    );
                    const at = items.indexOf(event.currentTarget);
                    const to = items[at + (event.key === "ArrowDown" ? 1 : -1)];
                    if (!to) return;
                    event.preventDefault();
                    event.stopPropagation();
                    to.focus();
                }}
                className="block h-auto cursor-default rounded-md px-2 py-1.5 [&>*]:pointer-events-auto"
            >
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold text-gray-900">{name}</span>
                    {theme === "system" ? (
                        <span className="text-gray-500">
                            {resolved === "dark"
                                ? t("shared.appSidebar.themeNowDark")
                                : t("shared.appSidebar.themeNowLight")}
                        </span>
                    ) : null}
                </div>
                <div ref={groupRef}>
                    <ThemeSegmentedUI
                        variant="menu"
                        arrows="horizontal"
                        label={name}
                        value={theme}
                        busy={saving}
                        labels={{
                            light: t("shared.appSidebar.themeLight"),
                            dark: t("shared.appSidebar.themeDark"),
                            system: t("shared.appSidebar.themeAuto"),
                            systemAria: t("shared.appSidebar.themeAutoLabel"),
                        }}
                        onChange={(next) => void choose(next)}
                    />
                </div>
            </DropdownItem>
            <DropdownSeparator className="my-1" />
        </>
    );
}
