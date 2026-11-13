/**
 * The published legal texts: readable by everyone, signed in or not, and
 * drawn from the build with no session at all.
 */
export function isLegalPath(pathname: string | null | undefined): boolean {
    const path = (pathname ?? "").replace(/\/+$/, "");
    return path === "/terminos" || path === "/privacidad";
}
