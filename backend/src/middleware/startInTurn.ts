import { AsyncResource } from "node:async_hooks";
import type { Socket } from "node:net";
import type { NextFunction, Request, Response } from "express";

/** Requests one connection may have waiting for their turn. */
const MAX_WAITING_PER_CONNECTION = 32;

const waitingByConnection = new WeakMap<Socket, number>();

/**
 * A request starts when its response can be sent. One that arrives while the
 * answer to an earlier request on the same connection is still going out (the
 * client sent them together) waits here for its turn, so it does no work and
 * holds nothing for a response that cannot be sent yet. If the client leaves
 * first, it never starts.
 *
 * Nothing is written for a waiting request, so nothing slows down a client
 * that keeps sending them: a connection with more waiting than the limit is
 * closed.
 */
export function startInTurn(req: Request, res: Response, next: NextFunction): void {
  if (res.socket) return void next();
  const connection = req.socket;
  const waiting = (waitingByConnection.get(connection) ?? 0) + 1;
  if (waiting > MAX_WAITING_PER_CONNECTION) return void connection.destroy();
  waitingByConnection.set(connection, waiting);
  // Its turn comes while the earlier response is finishing: it starts in the
  // context it arrived in, not in that of the request ahead of it.
  res.once(
    "socket",
    AsyncResource.bind(() => {
      waitingByConnection.set(connection, (waitingByConnection.get(connection) ?? 1) - 1);
      next();
    }),
  );
}
