import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";

/**
 * Whether nobody can receive this response any more: it has closed, or its
 * connection has. A response whose client left while an earlier middleware was
 * waiting has already closed when its handler starts.
 */
export function responseClosed(res: ServerResponse): boolean {
  return res.destroyed || res.req?.socket?.destroyed === true;
}

/**
 * Runs `listener` once, when the response closes or its connection does, and
 * returns a function that stops waiting for either. When that was already so
 * the listener runs at once: a 'close' that has been emitted is not emitted
 * again.
 *
 * The connection is watched as well because a response that waits behind an
 * earlier one on the same connection is not given that connection, and so
 * does not emit 'close', when the client leaves. A connection carries one
 * listener for this, however many of its responses are waited for.
 */
export function onResponseClosed(res: ServerResponse, listener: () => void): () => void {
  if (responseClosed(res)) {
    listener();
    return () => undefined;
  }
  const waiting = waitingOn(res.req?.socket);
  const stop = () => {
    res.off("close", run);
    waiting?.delete(run);
  };
  const run = () => {
    stop();
    listener();
  };
  res.once("close", run);
  waiting?.add(run);
  return stop;
}

const waitingByConnection = new WeakMap<Socket, Set<() => void>>();

/** What waits for this connection to close; its one 'close' listener runs all of it. */
function waitingOn(socket: Socket | undefined): Set<() => void> | undefined {
  if (!socket) return undefined;
  let waiting = waitingByConnection.get(socket);
  if (!waiting) {
    const created = new Set<() => void>();
    waiting = created;
    waitingByConnection.set(socket, created);
    socket.once("close", () => {
      // One that fails does not keep the rest from running; it is thrown after them.
      const failures: unknown[] = [];
      for (const run of [...created]) {
        try {
          run();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
    });
  }
  return waiting;
}

/**
 * A signal that aborts when nobody can receive the response any more; already
 * aborted when that was so before this was called.
 */
export function abortOnClose(res: ServerResponse): AbortSignal {
  const closed = new AbortController();
  onResponseClosed(res, () => closed.abort());
  return closed.signal;
}
