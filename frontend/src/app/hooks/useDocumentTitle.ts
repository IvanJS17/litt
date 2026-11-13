"use client";

import { useEffect } from "react";
import { titleFor } from "@/app/lib/documentTitle";

/**
 * Names the tab after something the screen only learns once it has loaded (the
 * chat's title, the project's name): "Contract review · LiTT". Static screens
 * use `pageTitle` in their layout instead. Does nothing without a name, so the
 * screen keeps the title its route gave it; leaving puts that title back.
 */
export function useDocumentTitle(name: string | null | undefined): void {
    useEffect(() => {
        const trimmed = name?.trim();
        if (!trimmed) return;
        const previous = document.title;
        document.title = titleFor(trimmed);
        return () => {
            document.title = previous;
        };
    }, [name]);
}
