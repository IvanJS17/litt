// The mark a turn carries when the user pressed Stop.
//
// The server stores `{ type: "stopped" }`, not a sentence, so every client
// shows it in its own language. Answers stopped before that carry the old
// stored sentence as a content event; `isStoppedEvent` recognises it too, so
// history reads the same either way.

/** The sentence earlier versions stored in place of the mark. */
export const LEGACY_STOPPED_TEXT = "Cancelled by user.";

export function isStoppedEvent(event: { type: string; text?: unknown }): boolean {
    return (
        event.type === "stopped" ||
        (event.type === "content" && typeof event.text === "string" && event.text.trim() === LEGACY_STOPPED_TEXT)
    );
}
