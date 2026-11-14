"use client";

import * as React from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { THEMES, type Theme } from "@mike/client";

/**
 * The one control for the theme preference: Claro, Oscuro or Automático.
 * It sits in two places (the account menu and Settings > Appearance), saves
 * the same field, and looks the same in both except for its size.
 *
 * A `radiogroup` with one tab stop: the arrow keys move between the three
 * and choose as they go (Home and End jump to the ends). The text comes in as
 * props, because the web app and the Word add-in each translate it.
 */
export type ThemeSegmentedLabels = {
    light: string;
    dark: string;
    /** The visible word for Automático ("Auto" in the menu). */
    system: string;
    /** The accessible name of Automático when the visible word is shorter. */
    systemAria?: string;
};

export type ThemeSegmentedProps = {
    value: Theme;
    onChange: (theme: Theme) => void;
    labels: ThemeSegmentedLabels;
    /** The group's accessible name ("Tema"). */
    label: string;
    /**
     * `menu`: 28 px buttons (44 px on a phone) with an icon, for the account
     * menu. `settings`: the text-size control's look, words only.
     */
    variant?: "menu" | "settings";
    /**
     * `all` also moves with Up and Down. A menu leaves them to the menu, so
     * the arrows can still walk out of the group.
     */
    arrows?: "all" | "horizontal";
    busy?: boolean;
    className?: string;
};

const ICONS: Record<Theme, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>> = {
    light: Sun,
    dark: Moon,
    system: Contrast,
};

const GROUP_CLASS: Record<NonNullable<ThemeSegmentedProps["variant"]>, string> = {
    menu: "flex w-full gap-0.5 rounded-lg bg-interactive-soft p-0.5",
    settings:
        "flex w-full shrink-0 gap-1 rounded-lg border border-gray-200 p-1 sm:w-auto",
};

const BUTTON_CLASS: Record<NonNullable<ThemeSegmentedProps["variant"]>, string> = {
    menu: "inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus pointer-coarse:h-11 pointer-coarse:text-sm",
    settings:
        "min-h-9 flex-1 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus sm:flex-none",
};

const SELECTED_CLASS = "bg-interactive text-interactive-foreground";
const IDLE_CLASS = "text-gray-700 hover:bg-app-surface-hover";

export function ThemeSegmentedUI({
    value,
    onChange,
    labels,
    label,
    variant = "settings",
    arrows = "all",
    busy = false,
    className,
}: ThemeSegmentedProps) {
    const buttons = React.useRef<Partial<Record<Theme, HTMLButtonElement | null>>>({});

    const move = (to: Theme) => {
        onChange(to);
        buttons.current[to]?.focus();
    };

    const onKeyDown = (event: React.KeyboardEvent): void => {
        const at = THEMES.indexOf(value);
        const forward =
            event.key === "ArrowRight" || (arrows === "all" && event.key === "ArrowDown");
        const backward =
            event.key === "ArrowLeft" || (arrows === "all" && event.key === "ArrowUp");
        let to: Theme | undefined;
        if (forward) to = THEMES[(at + 1) % THEMES.length];
        else if (backward) to = THEMES[(at - 1 + THEMES.length) % THEMES.length];
        else if (event.key === "Home") to = THEMES[0];
        else if (event.key === "End") to = THEMES[THEMES.length - 1];
        if (!to) return;
        event.preventDefault();
        // The menu's own arrow keys must not also move its highlight.
        event.stopPropagation();
        move(to);
    };

    const text = (theme: Theme): string =>
        theme === "system" ? labels.system : labels[theme];

    return (
        <div
            role="radiogroup"
            aria-label={label}
            aria-busy={busy || undefined}
            data-slot="theme-segmented"
            data-variant={variant}
            className={twMerge(clsx(GROUP_CLASS[variant], className))}
            onKeyDown={onKeyDown}
        >
            {THEMES.map((theme) => {
                const selected = theme === value;
                const Icon = ICONS[theme];
                return (
                    <button
                        key={theme}
                        ref={(node) => {
                            buttons.current[theme] = node;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={theme === "system" ? labels.systemAria : undefined}
                        tabIndex={selected ? 0 : -1}
                        data-theme-option={theme}
                        onClick={() => {
                            if (!selected) onChange(theme);
                        }}
                        className={twMerge(
                            clsx(BUTTON_CLASS[variant], selected ? SELECTED_CLASS : IDLE_CLASS),
                        )}
                    >
                        {variant === "menu" ? (
                            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                        ) : null}
                        <span className="min-w-0 truncate">{text(theme)}</span>
                    </button>
                );
            })}
        </div>
    );
}
