import type { Response } from "express";

/**
 * A signal that aborts when the response closes. A response that had already
 * closed when this is called (its client left while an earlier middleware was
 * waiting) gives a signal that is already aborted: its 'close' is not emitted
 * a second time, so a listener added now would never run.
 */
export function abortOnClose(res: Response): AbortSignal {
  const closed = new AbortController();
  if (res.destroyed) closed.abort();
  else res.once("close", () => closed.abort());
  return closed.signal;
}
