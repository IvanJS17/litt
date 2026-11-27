import { createHash } from "node:crypto";

/**
 * Caps on the mails anonymous requests make the auth service send. The
 * service has one hourly mail budget for the whole instance, shared with
 * invitations and confirmations, so anonymous callers may use only part of it:
 * a few mails per target address and a fixed number overall, in any span of
 * one hour.
 *
 * The API runs as one process, so the counts here decide for every caller; a
 * restart starts them again. The times of the mails let through within the
 * last hour are kept, overall and per address, and counted. An address is
 * stored as a digest, an entry is created only for a mail that is let through
 * (so at most `overall` entries exist at a time) and leaves with its last time.
 * A mail is counted when it is requested from the auth service, never for a
 * request the route drops for its own reasons.
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
  const addresses = new Map<string, number[]>();
  const overall: number[] = [];

  /** Drops the times that left the span; a time counts while it is under one window old. */
  function forget(times: number[], at: number): void {
    let gone = 0;
    while (gone < times.length && at - times[gone] >= windowMs) gone++;
    if (gone > 0) times.splice(0, gone);
  }

  function decide(address: string) {
    const at = now();
    for (const [key, times] of addresses) {
      forget(times, at);
      if (times.length === 0) addresses.delete(key);
    }
    forget(overall, at);

    const key = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
    const known = addresses.get(key);
    let admission: MailAdmission = { kind: "send" };
    if (known && known.length >= perAddress) admission = { kind: "address_full" };
    else if (overall.length >= options.overall) {
      admission = {
        kind: "overall_full",
        limit: options.overall,
        retryAfterSeconds: Math.max(1, Math.ceil((overall[0] + windowMs - at) / 1000)),
      };
    }
    return { admission, key, known, at };
  }

  return {
    size: () => addresses.size,
    keys: () => [...addresses.keys()],
    /**
     * Asks whether a mail to `address` could be requested now, and counts
     * nothing. For the routes that must answer before they know whether they
     * will send; the count that decides is `admit`, at the send.
     */
    check(address: string): MailAdmission {
      return decide(address).admission;
    },
    /**
     * Decides for a mail that is being requested from the auth service right
     * now and, when it is let through, counts it. An address already at its
     * cap is refused first, and a refusal of either kind counts nothing.
     */
    admit(address: string): MailAdmission {
      const { admission, key, known, at } = decide(address);
      if (admission.kind !== "send") return admission;
      if (known) known.push(at);
      else addresses.set(key, [at]);
      overall.push(at);
      return admission;
    },
  };
}

/** The one instance the auth routes share. */
export const anonymousMailCap = createAnonymousMailCap({
  overall: mailOverallCap(process.env.AUTH_ANONYMOUS_MAIL_HOURLY_CAP),
});
