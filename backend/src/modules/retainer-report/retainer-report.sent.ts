/**
 * "Marked as sent": the lawyer's own record that they sent the report. LiTT
 * sends nothing. Each mark is one insert-only row (who, when, which period, an
 * optional note); the row is written before anything answers success, because
 * the row is the record. Every member of the matter reads the history.
 */

import type { RetainerReportDays, RetainerReportSent, RetainerReportSentList } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { authorizeMatterMember } from "../matters/matters.service";
import type { ReportActor } from "./retainer-report.read";
import {
  INVALID_REPORT_CODE,
  isRecord,
  MAX_SENT_LISTED,
  NOT_A_RETAINER_CODE,
  parseNote,
  periodFor,
  todayInMexicoCity,
} from "./retainer-report.shared";

const COLUMNS = "id, period_start, period_end, period_days, note, actor_user_id, created_at";

type Row = {
  id: string;
  period_start: string;
  period_end: string;
  period_days: RetainerReportDays;
  note: string | null;
  actor_user_id: string | null;
  created_at: string;
};

const toSent = (row: Row, names: Map<string, string | null>): RetainerReportSent => ({
  id: row.id,
  period_start: row.period_start,
  period_end: row.period_end,
  period_days: row.period_days,
  note: row.note,
  sent_by: row.actor_user_id,
  sent_by_name: row.actor_user_id ? (names.get(row.actor_user_id) ?? null) : null,
  created_at: row.created_at,
});

async function namesOf(db: Db, rows: readonly Row[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const profiles = await loadCreatorProfiles(db, ids.map((user_id) => ({ user_id })));
  for (const id of ids) {
    const profile = profiles.get(id);
    names.set(id, profile?.display_name ?? profile?.email ?? null);
  }
  return names;
}

/** The sent history of a matter, newest first, for any active member. */
export async function listReportsSent(
  db: Db,
  actor: Omit<ReportActor, "now">,
): Promise<ServiceResult<RetainerReportSentList>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    const { isRetainer, canWrite, matterId } = access.data;
    if (!isRetainer) return ok({ retainer: false, can_write: false, sent: [] });
    const { data, error } = await db
      .from("matter_report_sent_events")
      .select(COLUMNS)
      .eq("matter_id", matterId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_SENT_LISTED);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as Row[];
    const names = await namesOf(db, rows);
    return ok({ retainer: true, can_write: canWrite, sent: rows.map((row) => toSent(row, names)) });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Records that the report of the last `days` days was sent. Owner or editor. */
export async function markReportSent(
  db: Db,
  actor: ReportActor & { days: RetainerReportDays | undefined; body: unknown },
): Promise<ServiceResult<RetainerReportSent>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    if (actor.days === undefined) return failure("not_found", "Not found");
    if (actor.body != null && !isRecord(actor.body))
      return failure("validation", "A request body must be an object.", INVALID_REPORT_CODE);
    const note = parseNote(isRecord(actor.body) ? actor.body.note : undefined);
    if (!note.ok) return failure("validation", "note must be text of at most 500 characters.", INVALID_REPORT_CODE);

    const period = periodFor(todayInMexicoCity(actor.now ?? new Date()), actor.days);
    const { data, error } = await db
      .from("matter_report_sent_events")
      .insert({
        matter_id: access.data.matterId,
        period_start: period.start,
        period_end: period.end,
        period_days: period.days,
        note: note.note,
        actor_user_id: actor.userId,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) return internalFailure(error);
    const row = data as unknown as Row;
    return ok(toSent(row, await namesOf(db, [row])));
  } catch (error) {
    return internalFailure(error);
  }
}
