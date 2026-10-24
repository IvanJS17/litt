import type { Response } from "express";
import { safeRequestPath } from "./safeRequestPath";

export const INTERNAL_ERROR_CODE = "internal_error";
export const RATE_LIMITED_CODE = "rate_limited";

/** Body for a 429 from an application rate limiter. */
export function rateLimitedBody(detail: string): {
  code: typeof RATE_LIMITED_CODE;
  detail: string;
} {
  return { code: RATE_LIMITED_CODE, detail };
}
export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

export const SCHEMA_OUT_OF_DATE_CODE = "schema_out_of_date";
export const SCHEMA_OUT_OF_DATE_MESSAGE =
  "The server's database needs an update before this can load. " +
  "Please contact your administrator.";

// Codes that mean "the database schema is behind this build": the code asked
// for a function, table or column the database does not have. On a
// self-hosted install that is almost always migrations that were never
// applied (or PostgREST's schema cache not reloaded after they were), not a
// transient fault, so retrying cannot help and the operator, not the user,
// has to act. Deliberately narrow: 42883 (also raised for operator/type
// mismatches) and 42703 (a column typo in a query) can be code bugs and stay
// ordinary 500s.
const SCHEMA_OUT_OF_DATE_CODES = new Set([
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found in the schema cache
  "PGRST205", // table not found in the schema cache
  "42P01", // undefined_table
]);

/**
 * The schema-drift code in an error's cause chain, if any. Reads only the
 * structured `code` of each link (a supabase-js error object, or the Error
 * asReportableError wrapped around one), never message text.
 */
export function schemaOutOfDateCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    try {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && SCHEMA_OUT_OF_DATE_CODES.has(code)) {
        return code;
      }
      current = (current as { cause?: unknown }).cause;
    } catch {
      return null;
    }
  }
  return null;
}

// SQLSTATE (42P01), PostgREST (PGRST205) and errno-style (ECONNREFUSED)
// codes are fixed vocabulary, safe to put in a message. Anything else a
// dependency calls `code` could be free text, so it is left out.
const SAFE_CODE = /^[A-Za-z0-9_]{2,40}$/;

/**
 * Turn a thrown or returned non-Error (a supabase-js `{ code, message,
 * details, hint }`, a string, a storage SDK's plain object) into an Error
 * that is worth reporting:
 *
 * - it has a stack, taken where this is called (or above `boundary`, which
 *   drops the helper frames so the top frame is the code that failed);
 * - the original value is its `cause`, so structured fields such as the
 *   PostgREST/SQLSTATE `code` stay machine-readable for the diagnostic
 *   classifier (lib/errorTags.ts), which extracts an allowlisted
 *   `failure_code` from the chain;
 * - its message is fixed text plus, at most, that code. The dependency's own
 *   `message`/`details`/`hint` can quote table names or row values, so they
 *   are never copied into the message; they remain reachable through `cause`
 *   in the server log only.
 */
export function asReportableError(
  value: unknown,
  boundary?: (...args: never[]) => unknown,
): Error {
  if (value instanceof Error) return value;
  let code: unknown;
  try {
    code =
      value && typeof value === "object"
        ? (value as { code?: unknown }).code
        : undefined;
  } catch {
    code = undefined;
  }
  const error = new Error(
    typeof code === "string" && SAFE_CODE.test(code)
      ? `Dependency failure (${code})`
      : "Dependency failure (non-Error value)",
    { cause: value },
  );
  if (boundary) Error.captureStackTrace?.(error, boundary);
  return error;
}

export function sendInternalError(
  res: Response,
  error: unknown,
  status = 500,
): Response {
  const requestId =
    typeof res.locals.requestId === "string" ? res.locals.requestId : null;
  // A caller that passes a raw non-Error would otherwise have the reporter
  // stringify it — `message`, `details` and all — into a stackless Error.
  error = asReportableError(error, sendInternalError);
  // A schema behind the code is an install problem, not a bug in this
  // request: answer 503 with a code the client can recognise instead of an
  // opaque 500, and tell the operator what to do in the server log. The log
  // line below still carries the cause, so a skipped migration stays visible.
  const schemaCode = schemaOutOfDateCode(error);
  if (schemaCode && status === 500) status = 503;

  if (schemaCode) {
    // console.warn, not console.error: the operator has to act on this, but
    // the request itself is logged at error level below.
    console.warn(
      `[http/schema-out-of-date] The database is missing an object this build needs (${schemaCode}). ` +
        "Apply the SQL files in backend/migrations/ that are newer than this database, " +
        "then reload the PostgREST schema cache (NOTIFY pgrst, 'reload schema'). " +
        "See docs/deployment.md.",
    );
  }
  console.error("[http/internal-error]", {
    requestId,
    method: res.req?.method,
    path: safeRequestPath(res.req?.originalUrl),
    error: error,
  });

  return res.status(status).json({
    code: schemaCode ? SCHEMA_OUT_OF_DATE_CODE : INTERNAL_ERROR_CODE,
    detail: schemaCode ? SCHEMA_OUT_OF_DATE_MESSAGE : INTERNAL_ERROR_MESSAGE,
    ...(requestId ? { request_id: requestId } : {}),
  });
}
