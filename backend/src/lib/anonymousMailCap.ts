import { createHash } from "node:crypto";

/**
 * Caps on the requests anonymous callers make that may have the auth service
 * send a mail. The service has one hourly mail budget for the whole instance,
 * shared with invitations and confirmations, so anonymous callers may use only
 * part of it: a few requests per target address, for each kind of request, and
 * a fixed number overall, in any span of one hour.
 *
 * Whether a request is counted depends only on what the caller already knows:
 * the route, the mode and the address typed. It never depends on who the
 * address belongs to or on what the auth service answers, so the counts say
 * nothing about either. Each route calls `admit` once, after the origin check
 * and the validation of the body, before anything is looked up.
 *
 * The API runs as one process, so the counts here decide for every caller; a
 * restart starts them again. The instance count is decided before anything
 * about the address, so an answer never tells more than the caller's own
 * requests. The times of the requests counted within the last hour are kept, overall and per address and kind. An address is stored
 * as a digest, an entry is created only for a request that is counted (so at
 * most `overall` entries exist at a time) and leaves with its last time.
 */
export const ANONYMOUS_MAIL_WINDOW_MS = 60 * 60 * 1000;
export const MAIL_PER_ADDRESS_MAX = 3;
export const MAIL_OVERALL_DEFAULT = 15;
const MAIL_OVERALL_LIMIT = 1000;

/** A plain whole number from 1 to 1000; anything else is the default. */
export function mailOverallCap(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return MAIL_OVERALL_DEFAULT;
  const value = Number(raw);
  return value >= 1 && value <= MAIL_OVERALL_LIMIT ? value : MAIL_OVERALL_DEFAULT;
}

export type MailKind = "reset" | "signup";

export type MailAdmission =
  | { kind: "send" }
  | { kind: "address_full" }
  | { kind: "repeat" }
  | { kind: "overall_full"; limit: number; retryAfterSeconds: number };

export function createAnonymousMailCap(options: {
  overall: number;
  perAddress?: number;
  windowMs?: number;
  now?: () => number;
}) {
  const perAddress = options.perAddress ?? MAIL_PER_ADDRESS_MAX;
  const windowMs = options.windowMs ?? ANONYMOUS_MAIL_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  // Keyed by the kind of request and the digest of the address.
  const addresses = new Map<string, number[]>();
  const overall: number[] = [];

  /** Drops the times that left the span; a time counts while it is under one window old. */
  function forget(times: number[], at: number): void {
    let gone = 0;
    while (gone < times.length && at - times[gone] >= windowMs) gone++;
    if (gone > 0) times.splice(0, gone);
  }

  return {
    size: () => addresses.size,
    keys: () => [...addresses.keys()],
    /**
     * Decides for one request of `kind` for `address` and, unless it is
     * refused, counts it. A refusal counts nothing. The order is: the
     * instance count (`overall_full`), then a repeat, then the address count
     * (`address_full`), then `send`. With `repeatWithinMs`, a
     * request for an address whose last counted request of this kind is
     * younger than that is a `repeat`: nothing is counted and the route does
     * nothing more for it.
     */
    admit(kind: MailKind, address: string, repeat: { repeatWithinMs?: number } = {}): MailAdmission {
      const at = now();
      for (const [entry, times] of addresses) {
        forget(times, at);
        if (times.length === 0) addresses.delete(entry);
      }
      forget(overall, at);

      // The instance count is decided first, so that while it is reached every
      // request gets the same refusal, whatever was counted for its address.
      if (overall.length >= options.overall) {
        return {
          kind: "overall_full",
          limit: options.overall,
          retryAfterSeconds: Math.max(1, Math.ceil((overall[0] + windowMs - at) / 1000)),
        };
      }
      const digest = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
      const key = `${kind}:${digest}`;
      const known = addresses.get(key);
      if (
        repeat.repeatWithinMs !== undefined &&
        known &&
        at - known[known.length - 1] < repeat.repeatWithinMs
      ) {
        return { kind: "repeat" };
      }
      if (known && known.length >= perAddress) return { kind: "address_full" };
      if (known) known.push(at);
      else addresses.set(key, [at]);
      overall.push(at);
      return { kind: "send" };
    },
  };
}

/** The one instance the auth routes share. */
export const anonymousMailCap = createAnonymousMailCap({
  overall: mailOverallCap(process.env.AUTH_ANONYMOUS_MAIL_HOURLY_CAP),
});
