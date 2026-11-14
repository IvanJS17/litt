import { PIXEL_TEXT_CLASS } from "@mike/ui";

/**
 * Small "V3" marker showing which version of a document is on screen.
 *
 * Deliberately unadorned — no border, no fill — so it sits quietly beside a
 * filename instead of competing with it, and reads the same on every surface
 * the app puts it on. Deciding *when* a version is worth showing stays with
 * the caller — a listing shows every version, the document tabs only bother
 * past V1 — while everything below the number is decided here.
 *
 * A version is one of the short details set in the pixel face, at its fixed
 * 11 px, the same beside a dense tab and a heading-sized filename.
 */
export function VersionChip({ n }: { n: number | null | undefined }) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
    return (
        <span
            className={`shrink-0 inline-flex items-center text-gray-500 ${PIXEL_TEXT_CLASS}`}
        >
            V{n}
        </span>
    );
}
