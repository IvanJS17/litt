/** Only Word files can be compared. The server decides (`compare_not_supported`); this only hides the menu entry. */
export function canCompareFileType(fileType: string | null | undefined): boolean {
    return (fileType ?? "").toLowerCase() === "docx";
}

type Candidate = { id: string; file_type?: string | null };

/**
 * The documents a comparison can be made against: other Word files of the
 * same list. Never the document itself, never a non-Word file.
 */
export function compareCandidates<T extends Candidate>(
    documents: ReadonlyArray<T>,
    selfId: string,
    isHeld: (document: T) => boolean = () => false,
): T[] {
    return documents.filter(
        (document) => document.id !== selfId && canCompareFileType(document.file_type) && !isHeld(document),
    );
}
