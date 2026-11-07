/**
 * First path segments of the pages that render inside the app shell (the
 * sidebar layout in `app/(pages)/`). appShellRoutes.test.ts keeps this list
 * equal to that directory.
 */
export const APP_SHELL_SEGMENTS = [
    "assistant",
    "history",
    "ide",
    "library",
    "organizations",
    "playbooks",
    "projects",
    "settings",
    "tabular-reviews",
    "workflows",
] as const;

/** Does this path render inside the sidebar layout once it loads? */
export function isAppShellRoute(pathname: string | null | undefined): boolean {
    const segment = pathname?.split("/")[1];
    return (
        !!segment &&
        (APP_SHELL_SEGMENTS as readonly string[]).includes(segment)
    );
}
