import { createHash } from "node:crypto";

/**
 * Caps on the mails anonymous requests make the auth service send. The
 * service has one hourly mail budget for the whole instance, shared with
 * invitations and confirmations, so anonymous callers may use only part of it:
 * a few mails per target address and a fixed number overall per window.
 *
 * The API runs as one process, so the counts here decide for every caller.
 * Counts are kept per window: an address is stored as a digest, an entry is
 * created only for a mail that is let through (so at most `overall` entries
 * exist at a time) and entries leave with their window.
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

export type MailAdmission =
  | { kind: "send" }
  | { kind: "address_full" }
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
  const addresses = new Map<string, { count: number; resetAt: number }>();
  let overall = { count: 0, resetAt: 0 };

  return {
    size: () => addresses.size,
    keys: () => [...addresses.keys()],
    /**
     * Decides for a mail that is about to be sent to `address` and, when it is
     * let through, counts it. An address already at its cap is refused first,
     * and a refusal of either kind counts nothing.
     */
    admit(address: string): MailAdmission {
      const at = now();
      for (const [key, entry] of addresses) if (entry.resetAt <= at) addresses.delete(key);
      if (overall.resetAt <= at) overall = { count: 0, resetAt: 0 };

      const key = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
      const known = addresses.get(key);
      if (known && known.count >= perAddress) return { kind: "address_full" };
      if (overall.count >= options.overall) {
        return {
          kind: "overall_full",
          limit: options.overall,
          retryAfterSeconds: Math.max(1, Math.ceil((overall.resetAt - at) / 1000)),
        };
      }

      if (known) known.count++;
      else addresses.set(key, { count: 1, resetAt: at + windowMs });
      if (overall.count === 0) overall.resetAt = at + windowMs;
      overall.count++;
      return { kind: "send" };
    },
  };
}
