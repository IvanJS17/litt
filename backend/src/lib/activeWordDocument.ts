/** The fixed handle under which the document open in Word is offered to the model, cited and read. It names no stored document. */
export const ACTIVE_WORD_DOCUMENT_ID = "active-word-document";

/**
 * Label for read_active_document (live) reads. Distinct from the snapshot's
 * document name on purpose: the pane keys document-read activity rows by
 * filename, so a live re-read sharing the snapshot's label would merge with
 * (and hide behind) the snapshot read in the live transcript while rendering
 * as two rows after a reload. Lives in lib so the stored-message read
 * rules and contextBuilders can recognise it without an import cycle; wordPrompt re-exports it.
 */
export const ACTIVE_WORD_DOCUMENT_LIVE_FILENAME = "Active Word document (live)";
