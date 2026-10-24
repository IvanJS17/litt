/**
 * Run work whose failure must not fail the caller — a rollback, a cleanup,
 * a cache refresh — but must not vanish either. `promise.catch(() => {})`
 * is how a storage leak or a half-finished rollback stays invisible for
 * months; this logs it as a warning, grouped per `what`, and resolves to
 * undefined so the caller's control flow is unchanged.
 */
export type BestEffortContext = {
  /** Stable, low-cardinality name of the operation. */
  what: string;
  /** Structured fields describing the operation. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Additional detail to log beside the failure. */
  extra?: Record<string, unknown>;
};

export function bestEffort<T>(
  work: Promise<T>,
  context: BestEffortContext,
): Promise<T | undefined> {
  return work.catch((error: unknown) => {
    console.warn(`[best-effort] ${context.what} failed`, {
      ...(context.tags ?? {}),
      ...(context.extra ?? {}),
      error,
    });
    return undefined;
  });
}
