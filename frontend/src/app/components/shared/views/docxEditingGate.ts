/**
 * LiTT gate for in-browser DOCX editing (ledger §16.3 "DOCX viewer and
 * editor", disposition `gate`).
 *
 * The viewer is adopted; editing and autosave stay off until it is proven
 * that a save never replaces a version an AI execution, a review or an
 * approved artifact relies on (otherwise saves must create a new version).
 * Until then every DOCX surface opens read-only, whatever the caller's
 * access allows. An operator turns it on only with
 * NEXT_PUBLIC_LITT_DOCX_EDITING=enabled, after that check.
 */
export function docxEditingEnabled(): boolean {
    return process.env.NEXT_PUBLIC_LITT_DOCX_EDITING === "enabled";
}
