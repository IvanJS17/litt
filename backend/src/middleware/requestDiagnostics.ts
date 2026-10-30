import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import {
  tagCurrentRequest,
  withDiagnosticScope,
} from "../lib/observability/report";

/** Establish diagnostics before body parsing, auth or domain routing can fail. */
export const requestDiagnostics: RequestHandler = (req, res, next) => {
  // Async work started by next() retains only this request's scope.
  withDiagnosticScope(() => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    tagCurrentRequest(requestId, req);
    next();
  });
};
