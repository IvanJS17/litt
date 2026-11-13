import { BACKEND_REPORTING_OWNER } from "../lib/reportedUpstreamCodes";
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import {
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_MESSAGE,
  failureAlreadyReported,
  sendInternalError,
} from "../lib/httpError";
import { safeRequestPath } from "../lib/safeRequestPath";
import { findPersonalWorkspaceDisabled } from "../lib/managedAccounts";

type ErrorBody = {
  code?: unknown;
  detail?: unknown;
  request_id?: unknown;
};

export function protectInternalErrorResponses(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown) => {
    if (res.statusCode < 500) return originalJson(body);

    const requestId =
      typeof res.locals.requestId === "string" ? res.locals.requestId : null;
    const publicBody = {
      code: INTERNAL_ERROR_CODE,
      detail: INTERNAL_ERROR_MESSAGE,
      reporting_owner: BACKEND_REPORTING_OWNER,
      ...(requestId ? { request_id: requestId } : {}),
    };
    const errorBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as ErrorBody)
        : null;
    const hasUnexpectedFields =
      errorBody &&
      Object.keys(errorBody).some(
        (key) => !["code", "detail", "request_id", "reporting_owner"].includes(key),
      );
    // sendInternalError already reported this failure and wrote a fixed
    // public body (internal_error, or an intentional 503 such as
    // schema_out_of_date / upstream_unavailable that the client acts on).
    // Pass it through untouched: replacing the code would hide the one thing
    // the client can use, and a second report is a duplicate line.
    if (
      failureAlreadyReported(res) &&
      errorBody &&
      !hasUnexpectedFields &&
      typeof errorBody.code === "string" &&
      typeof errorBody.detail === "string"
    ) {
      return originalJson({ ...errorBody, reporting_owner: BACKEND_REPORTING_OWNER });
    }
    if (
      errorBody?.code === INTERNAL_ERROR_CODE &&
      errorBody.detail === INTERNAL_ERROR_MESSAGE &&
      !hasUnexpectedFields
    ) {
      return originalJson(publicBody);
    }

    // A handler wrote its own 5xx body instead of going through
    // sendInternalError: still a server failure, still logged. The detail is
    // the developer's message (never shown to the client), so it is the best
    // label we have.
    console.error("[http/sanitized-internal-error]", {
      requestId,
      method: req.method,
      path: safeRequestPath(req.originalUrl),
      status: res.statusCode,
      error: errorBody?.detail ?? body,
    });

    return originalJson(publicBody);
  }) as Response["json"];

  next();
}

/**
 * Final Express error boundary. Route handlers should still return intentional
 * 4xx responses themselves, but an unexpected thrown/rejected error must never
 * fall through to Express's HTML error response (which can include a stack in
 * development).
 */
export const handleUnhandledError: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const bodyParserError = error as { status?: unknown; type?: unknown };
  const requestId =
    typeof res.locals.requestId === "string" ? res.locals.requestId : null;
  if (
    bodyParserError.status === 400 &&
    bodyParserError.type === "entity.parse.failed"
  ) {
    res.status(400).json({
      code: "invalid_json",
      detail: "Request body must contain valid JSON.",
      ...(requestId ? { request_id: requestId } : {}),
    });
    return;
  }
  if (
    bodyParserError.status === 413 &&
    bodyParserError.type === "entity.too.large"
  ) {
    res.status(413).json({
      code: "request_too_large",
      detail: "The request body is too large.",
      ...(requestId ? { request_id: requestId } : {}),
    });
    return;
  }

  // A managed account (lib/managedAccounts.ts) reached for personal content.
  const personalDisabled = findPersonalWorkspaceDisabled(error);
  if (personalDisabled) {
    res.status(403).json({
      code: personalDisabled.code,
      detail: personalDisabled.message,
      ...(requestId ? { request_id: requestId } : {}),
    });
    return;
  }

  sendInternalError(res, error);
};
