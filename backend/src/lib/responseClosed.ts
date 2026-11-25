import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { reportError } from "./observability/report";

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
  // A listener that fails is reported, once, wherever it runs: at once here,
  // from the response's own 'close', or from its connection's. It neither
  // stops the others nor reaches the caller or the process.
  const report = () => {
    try {
      listener();
    } catch (error) {
      reportError(error, { tags: { component: "http", operation: "http.close_listener" } });
    }
  };
  if (responseClosed(res)) {
    report();
    return () => undefined;
  }
  const waiting = waitingOn(res.req?.socket);
  const stop = () => {
    res.off("close", run);
    waiting?.delete(run);
  };
  const run = () => {
    stop();
    report();
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
      for (const run of [...created]) run();
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
