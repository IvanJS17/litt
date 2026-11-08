"use client";

import { type RefObject, useLayoutEffect, useState } from "react";
import {
    type WorkspaceRoom,
    workspaceRoom,
} from "@/app/lib/workspacePanelWidths";

/**
 * How many workspace panels fit side by side in `ref`'s element, kept up to
 * date as it resizes. `null` until the element has a width, which is also
 * what the server renders: starting from `window.innerWidth` instead would
 * not match the server's markup on a phone. While it is `null` the CSS alone
 * keeps a phone to one panel, and the layout effect below replaces it before
 * the first paint. `explorerCollapsed` is measured in: a folded explorer
 * leaves more room.
 */
export function useWorkspaceRoom(
    ref: RefObject<HTMLElement | null>,
    explorerCollapsed = false,
): WorkspaceRoom | null {
    const [room, setRoom] = useState<WorkspaceRoom | null>(null);

    // Measured in a layout effect so the first paint already shows the
    // right layout (a tablet used to flash three panels, then one).
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const measure = () => {
            if (element.clientWidth > 0)
                setRoom(workspaceRoom(element.clientWidth, explorerCollapsed));
        };

        measure();
        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", measure);
            return () => window.removeEventListener("resize", measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, explorerCollapsed]);

    return room;
}
