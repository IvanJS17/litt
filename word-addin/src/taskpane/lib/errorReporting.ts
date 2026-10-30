/**
 * Failure reporting seam for the Word add-in. LiTT sends no telemetry to
 * third parties, so nothing here leaves the pane: call sites keep naming the
 * operation and the Office step that failed, the failure is marked as
 * handled so `notify` does not treat it twice, and the call site's own
 * console line is the only record.
 */

export type ReportLevel = "fatal" | "error" | "warning";

/** Static operation label authored at the call site; no registration required. */
export type AddinOperation = string;

export type ReportContext = {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  level?: ReportLevel;
  fingerprint?: string[];
};

const reported = new WeakSet<object>();

function markReported(error: unknown): void {
  if (error && typeof error === "object") reported.add(error);
}

/** True when `error` already went through one of the report helpers. */
export function isReported(error: unknown): boolean {
  return !!error && typeof error === "object" && reported.has(error);
}

/** Mark a failure as handled. Always returns null: there is no event id. */
export function reportError(
  error: unknown,
  _context: ReportContext = {},
): string | null {
  markReported(error);
  return null;
}

/** An Office.js failure while reading, anchoring, resolving or revealing an edit. */
export function reportWordFailure(
  error: unknown,
  _context: {
    stage?: string;
    operation?: AddinOperation;
    level?: ReportLevel;
    extra?: Record<string, unknown>;
  },
): string | null {
  markReported(error);
  return null;
}

/** A backend 5xx seen from the pane. */
export function reportApiFailure(failure: {
  path: string;
  status: number;
  code?: string | null;
  requestId?: string | null;
  method?: string;
  operation?: AddinOperation;
  error?: unknown;
}): string | null {
  markReported(failure.error);
  return null;
}

/** The request never reached the server. */
export function reportNetworkFailure(
  error: unknown,
  _request: { method: string; url: string; operation?: AddinOperation },
): string | null {
  markReported(error);
  return null;
}

/** No reporting identity exists locally. */
export function setReportingUser(_user: { id: string } | null): void {}
