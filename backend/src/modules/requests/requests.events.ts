/**
 * The insert-only record of a request. One row per change; the detail names
 * fields, states, ids and numbers, never the text of a title.
 */

import type { MatterRequestEvent } from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { toEvent, type EventRow } from "./requests.shared";

/**
 * Records one change after it was applied. Like `recordAudit`, a lost row is
 * reported and never undoes or hides the change: a failure here would answer
 * 500 for a change that already happened, and the retry would read as a
 * version conflict.
 */
export async function recordRequestEvent(
  db: Db,
  event: {
    requestId: string;
    matterId: string;
    actorUserId: string;
    action: MatterRequestEvent["action"];
    detail: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("matter_request_events").insert({
    request_id: event.requestId,
    matter_id: event.matterId,
    actor_user_id: event.actorUserId,
    action: event.action,
    detail: event.detail,
  });
  if (error)
    reportError(new AppError("requests.event_write_failed", "[requests] event insert failed", { cause: error }), {
      tags: { operation: "requests.event" },
      extra: { action: event.action },
    });
}

export async function loadRequestEvents(
  db: Db,
  requestId: string,
): Promise<ServiceResult<MatterRequestEvent[]>> {
  const { data, error } = await db
    .from("matter_request_events")
    .select("id, actor_user_id, action, detail, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);
  if (error) return internalFailure(error);
  return ok(((data ?? []) as unknown as EventRow[]).map(toEvent));
}
