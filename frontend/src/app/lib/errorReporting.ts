/**
 * Failure reporting seam for the web app. LiTT sends no telemetry to third
 * parties, so nothing here leaves the browser: upstream's call sites keep
 * naming the operation that failed, the failure is marked as handled so a
 * screen does not treat it twice, and the call site's own console line is
 * the only record. User-facing text still comes from `userFacingError`.
 */

/** Static, source-authored label of the user-level flow that failed. */
export type Operation = string;

export type ReportLevel = "fatal" | "error" | "warning";

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
    context: ReportContext = {},
): string | null {
    void context; // Labels stay in the browser; nothing is sent.
    markReported(error);
    return null;
}

/** A failure another runtime already handled; screens must not report it again. */
export function markErrorHandled(error: unknown): void {
    markReported(error);
}

/** A backend 5xx seen from the browser. */
export function reportApiFailure(failure: {
    path: string;
    status: number;
    code?: string | null;
    requestId?: string | null;
    method?: string;
    operation?: Operation;
    error?: unknown;
}): string | null {
    markReported(failure.error);
    return null;
}

/** Fetch failed without an HTTP response. */
export function reportNetworkFailure(
    error: unknown,
    request: { method: string; url: string; operation?: Operation },
): string | null {
    void request; // Nothing is sent.
    markReported(error);
    return null;
}

/** Nothing is tracked locally; returns the release callback callers expect. */
export function trackPendingRequest(): () => void {
    return () => {};
}

/** No reporting identity exists locally. */
export function setReportingUser(user: { id: string } | null): void {
    void user;
}
