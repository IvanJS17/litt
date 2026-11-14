import { cn } from "@/app/lib/utils";

export const settingsGlassIconButtonClassName =
    "justify-center rounded-lg bg-transparent px-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * One section of the bar. The amber ring is for the keyboard only: it is a
 * `focus-visible` ring (never `focus`), drawn inset so the bar's own scroll
 * does not clip it, and `keyboard-focus-ring` (globals.css) clears it when
 * the last input was a pointer, because some browsers match `:focus-visible`
 * on a button after a click. The open section is drawn as selected, never
 * as a ring.
 */
export function settingsTabButtonClassName(active: boolean) {
    return cn(
        "keyboard-focus-ring flex h-9 w-full items-center rounded-lg px-3 text-left text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
        active
            ? "bg-gray-100 text-gray-900"
            : "text-gray-500 hover:bg-interactive-soft hover:text-gray-900",
    );
}
