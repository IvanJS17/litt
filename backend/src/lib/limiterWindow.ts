// The longest window a limiter's reset timer can hold (a 32-bit signed
// millisecond count, about 24.8 days); a longer setting is cut to it.
export const MAX_LIMITER_WINDOW_MS = 2_147_483_647;

/** A limiter window of that many minutes, in milliseconds, never above the ceiling. */
export function minutes(value: number): number {
  return Math.min(value * 60 * 1000, MAX_LIMITER_WINDOW_MS);
}

/** A limiter window of that many hours, in milliseconds, never above the ceiling. */
export function hours(value: number): number {
  return minutes(value * 60);
}
