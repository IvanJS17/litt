/**
 * The end of a connected application's connection, as a turn's tools see it.
 * Its own error, not an abort-shaped one: the model adapter turns an
 * abort-looking error back into an ordinary failure when nobody aborted the
 * caller's signal, and this one must reach the engine as it is so the turn
 * ends as a stopped turn.
 */
export class ConnectionEndedError extends Error {
  constructor() {
    super("The connection that started this turn has ended.");
    this.name = "ConnectionEndedError";
  }
}

/** True when the error, or anything in its cause chain, is the end of the connection. */
export function isConnectionEnded(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    if (current instanceof ConnectionEndedError) return true;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
