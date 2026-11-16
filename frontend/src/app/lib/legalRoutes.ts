/**
 * The published legal texts: readable by everyone, signed in or not, and
 * drawn from the build with no session at all.
 */
export function isLegalPath(pathname: string | null | undefined): boolean {
    const path = (pathname ?? "").replace(/\/+$/, "");
    return path === "/terminos" || path === "/privacidad";
}

/**
 * Pages that load without asking who is signed in: the legal texts and the
 * public start page (`/`, app/page.tsx), which decides its button from the
 * session cookie on the server (lib/sessionHint.ts). Leaving one of them for
 * the app is what asks for the session (AuthContext).
 */
export function isSessionlessPath(pathname: string | null | undefined): boolean {
    return pathname === "/" || isLegalPath(pathname);
}
