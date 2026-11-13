"use client";

import { useEffect, useState } from "react";

/** How long the fade that marks a change of workspace takes. */
export const WORKSPACE_FADE_MS = 150;

/**
 * True for 150 ms after the open workspace changes from one to another
 * (firm ↔ personal), so what names it and what it shows can fade in with
 * `.workspace-fade` (globals.css). Not for the first load, when the workspace
 * goes from unknown to known.
 */
export function useWorkspaceFade(workspaceId: string | null): boolean {
    const [shown, setShown] = useState(workspaceId);
    const [fading, setFading] = useState(false);
    if (shown !== workspaceId) {
        setShown(workspaceId);
        if (shown !== null && workspaceId !== null) setFading(true);
    }
    useEffect(() => {
        if (!fading) return;
        const timer = window.setTimeout(() => setFading(false), WORKSPACE_FADE_MS);
        return () => window.clearTimeout(timer);
    }, [fading]);
    return fading;
}
