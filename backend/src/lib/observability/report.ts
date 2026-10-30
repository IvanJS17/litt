// Local failure reporting for every backend runtime: the API process, the
// in-process worker thread, the standalone worker process and one-shot jobs.
//
// LiTT sends no telemetry to third parties. Upstream's call sites name the
// flow (`setOperation`), the stage (`markStage`) and the failure kind; here
// that identity becomes one sanitized line in the server log. Only
// allowlisted labels and technical codes are written (./diagnostics.ts):
// never error messages, request data, `extra` payloads or stack text. The
// call site keeps its own console line for the full local detail.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  diagnosticErrorTags,
  diagnosticRoute,
  diagnosticTags,
  isDiagnosticLabel,
  type Operation,
  type Stage,
} from "./diagnostics";

export type ReportLevel = "fatal" | "error" | "warning";

export type ReportContext = {
  /** Low-cardinality labels; only allowlisted keys and values are logged. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Free-form context. Never logged: it may carry document or user data. */
  extra?: Record<string, unknown>;
  level?: ReportLevel;
  /** Kept for upstream call sites; grouping is not used locally. */
  fingerprint?: string[];
};

type DiagnosticScope = {
  tags: Record<string, unknown>;
  stages: string[];
};

const MAX_STAGES = 20;
const scopes = new AsyncLocalStorage<DiagnosticScope>();

/**
 * Run work in its own diagnostic scope, so a flow's operation and stages stay
 * with the request or job that set them even when several run concurrently.
 */
export function withDiagnosticScope<T>(work: () => T): T {
  return scopes.run({ tags: {}, stages: [] }, work);
}

/** Name the flow the current request or job belongs to. */
export function setOperation(operation: Operation): void {
  const scope = scopes.getStore();
  if (scope && isDiagnosticLabel(operation)) scope.tags.operation = operation;
}

/** Record that the current request or job reached a source-authored stage. */
export function markStage(stage: Stage): void {
  const scope = scopes.getStore();
  if (!scope || !isDiagnosticLabel(stage)) return;
  scope.stages.push(stage);
  if (scope.stages.length > MAX_STAGES) scope.stages.shift();
}

/** Baseline identity for a request: its id and the matched route pattern. */
export function tagCurrentRequest(
  requestId: string,
  request?: { method: string; originalUrl: string },
): void {
  const scope = scopes.getStore();
  if (!scope) return;
  scope.tags.request_id = requestId;
  if (request) {
    scope.tags.component = "http";
    scope.tags.operation = "http.request";
    scope.tags.http_method = request.method;
    scope.tags.http_route = diagnosticRoute(request.originalUrl);
  }
}

/** Kept for upstream call sites; the user id is not written to the report line. */
export function setCurrentUser(_userId: string | null): void {}

/**
 * The Express route PATTERN a request matched, with its mount point:
 * `/projects/:projectId`, not `/projects/8f1c…`. A request that matched no
 * route has no pattern; the concrete path minus its query is the fallback.
 */
export function requestRoutePattern(
  req:
    | {
        baseUrl?: string;
        route?: { path?: unknown };
        originalUrl?: string;
      }
    | undefined,
): string | undefined {
  if (!req) return undefined;
  const base = req.baseUrl ?? "";
  const path = req.route?.path;
  if (typeof path === "string") {
    return path === "/" && base ? base : `${base}${path}`;
  }
  const concrete = req.originalUrl?.split("?")[0];
  return concrete ? `${concrete}` : base || undefined;
}

const reportedErrors = new WeakSet<object>();

/** True when `error` already went through reportError. */
export function isReported(error: unknown): boolean {
  return !!error && typeof error === "object" && reportedErrors.has(error);
}

function writeReport(
  level: ReportLevel,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify(fields);
  if (level === "warning") console.warn("[report]", line);
  else console.error("[report]", line);
}

function reportFields(
  context: ReportContext,
  error?: unknown,
): Record<string, unknown> {
  const scope = scopes.getStore();
  return {
    level: context.level ?? "error",
    ...diagnosticTags(scope?.tags),
    ...diagnosticTags(context.tags),
    ...(error === undefined ? {} : diagnosticErrorTags(error)),
    ...(scope?.stages.length ? { stages: [...scope.stages] } : {}),
  };
}

/**
 * Write one sanitized report line for a failure. Always returns null: there
 * is no external event id.
 */
export function reportError(
  error: unknown,
  context: ReportContext = {},
): string | null {
  if (error && typeof error === "object") reportedErrors.add(error);
  writeReport(context.level ?? "error", reportFields(context, error));
  return null;
}

/** A report without an Error object; the message must be source-authored. */
export function reportMessage(
  message: string,
  context: ReportContext = {},
): string | null {
  const fields = reportFields(context);
  if (isDiagnosticLabel(message)) fields.message = message;
  writeReport(context.level ?? "error", fields);
  return null;
}

/** Nothing is queued locally; kept so exit paths read the same as upstream. */
export async function flushReports(_timeoutMs = 2_000): Promise<void> {}

/**
 * Run work whose failure must not fail the caller — a rollback, a cleanup,
 * a cache refresh — but must not vanish either. `promise.catch(() => {})`
 * is how a storage leak or a half-finished rollback stays invisible for
 * months; this reports it as a warning, grouped per `what`, logs the local
 * detail, and resolves to undefined so the caller's control flow is unchanged.
 */
export function bestEffort<T>(
  work: Promise<T>,
  context: {
    /** Stable, low-cardinality name of the operation. */
    what: string;
    tags?: ReportContext["tags"];
    extra?: ReportContext["extra"];
  },
): Promise<T | undefined> {
  return work.catch((error: unknown) => {
    reportError(error, {
      level: "warning",
      tags: { component: "best-effort", ...context.tags, what: context.what },
      extra: context.extra,
    });
    console.warn(`[best-effort] ${context.what} failed`, {
      ...(context.tags ?? {}),
      ...(context.extra ?? {}),
      error,
    });
    return undefined;
  });
}
