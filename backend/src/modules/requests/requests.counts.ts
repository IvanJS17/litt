/**
 * Firm-wide COUNTS of the requests of the firm's retainer matters, for the
 * firm's owners and admins (docs/matter-requests.md, "Firm counts").
 *
 * An owner or admin who is not on a private matter's team never reads its
 * requests (they get the 404 of every other request route). This is the one
 * thing they see: numbers, a day count and an opaque ordinal per matter. The
 * database function `matter_request_counts` returns no text of a request and
 * no matter name, and checks the caller itself; this service checks too, and
 * writes an audit event for every read BEFORE it hands the numbers over: if
 * the event cannot be written the read fails.
 */

import type { MatterRequestCounts, MatterRequestCountsPeriod } from "@mike/contracts";
import { insertAuditEvent } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { INVALID_REQUEST_CODE, isRecord } from "./requests.shared";
import { teamMember } from "./requests.types";

type Actor = {
  userId: string;
  userEmail?: string | null;
  orgId: unknown;
  period?: unknown;
  date?: unknown;
  /** Injected by tests; the real clock otherwise. */
  now?: Date;
};

export const COUNTS_AUDIT_ACTION = "request_counts.read";
const FIRM_TIME_ZONE = "America/Mexico_City";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's calendar date in the firm's time zone. */
export function todayInFirmZone(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FIRM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** First and last day of the month or quarter holding `date`, or null when `date` is not a real date. */
export function periodBounds(
  period: MatterRequestCountsPeriod,
  date: string,
): { start: string; end: string } | null {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    return null;
  const first = period === "month" ? month : Math.floor((month - 1) / 3) * 3 + 1;
  const last = period === "month" ? month : first + 2;
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return { start: `${year}-${pad(first)}-01`, end: `${year}-${pad(last)}-${pad(lastDay)}` };
}

function invalid(detail: string) {
  return failure("validation", detail, INVALID_REQUEST_CODE);
}

export async function getFirmRequestCounts(
  db: Db,
  actor: Actor,
): Promise<ServiceResult<MatterRequestCounts>> {
  const who = await teamMember(db, actor);
  if (!who.ok) return who;
  if (!who.data.admin)
    return failure("forbidden", "Only an owner or admin reads the firm's request counts.", "org_admin_required");

  const period = actor.period ?? "month";
  if (period !== "month" && period !== "quarter") return invalid("period must be month or quarter");
  const date = actor.date ?? todayInFirmZone(actor.now ?? new Date());
  const bounds = typeof date === "string" ? periodBounds(period, date) : null;
  if (!bounds) return invalid("date must be a valid YYYY-MM-DD date");

  const { data, error } = await db.rpc("matter_request_counts", {
    p_org_id: who.data.orgId,
    p_user_id: actor.userId,
    p_start: bounds.start,
    p_end: bounds.end,
  });
  if (error) return internalFailure(error);
  if (!isRecord(data) || !isRecord(data.totals)) return internalFailure(new Error("Malformed request counts"));

  try {
    await insertAuditEvent(db, {
      userId: actor.userId,
      userEmail: actor.userEmail ?? null,
      orgId: who.data.orgId,
      action: COUNTS_AUDIT_ACTION,
      surface: "organization",
      detail: { org_id: who.data.orgId, period, period_start: bounds.start, period_end: bounds.end },
    });
  } catch (auditError) {
    return internalFailure(auditError);
  }
  return ok({ ...(data as unknown as Omit<MatterRequestCounts, "period">), period });
}
