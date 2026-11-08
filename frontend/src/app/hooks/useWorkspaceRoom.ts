"use client";

import { type RefObject, useLayoutEffect, useState } from "react";
import {
    type WorkspaceRoom,
    workspaceRoom,
} from "@/app/lib/workspacePanelWidths";

/**
 * How many workspace panels fit side by side in `ref`'s element, kept up to
 * date as it resizes. `null` until the element has a width; below the `md`
 * breakpoint it starts as `"single"`, which the CSS already shows.
 */
export function useWorkspaceRoom(
    ref: RefObject<HTMLElement | null>,
): WorkspaceRoom | null {
    const [room, setRoom] = useState<WorkspaceRoom | null>(() =>
        typeof window !== "undefined" && window.innerWidth < 768
            ? "single"
            : null,
    );

    // Measured in a layout effect so the first paint already shows the
    // right layout (a tablet used to flash three panels, then one).
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const measure = () => {
            if (element.clientWidth > 0)
                setRoom(workspaceRoom(element.clientWidth));
        };

        measure();
        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", measure);
            return () => window.removeEventListener("resize", measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return room;
}
