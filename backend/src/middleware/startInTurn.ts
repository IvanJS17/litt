import type { NextFunction, Request, Response } from "express";

/**
 * A request starts when its response can be sent. One that arrives while the
 * answer to an earlier request on the same connection is still going out (the
 * client sent them together) waits here for its turn, so it does no work and
 * holds nothing for a response that cannot be sent yet. If the client leaves
 * first, it never starts.
 */
export function startInTurn(_req: Request, res: Response, next: NextFunction): void {
  if (res.socket) return void next();
  res.once("socket", () => next());
}
