/**
 * The insert-only record of a request. One row per change; the detail names
 * fields, states, ids and numbers, never the text of a title.
 */

import type { MatterRequestEvent } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { toEvent, type EventRow } from "./requests.shared";

export async function recordRequestEvent(
  db: Db,
  event: {
    requestId: string;
    matterId: string;
    actorUserId: string;
    action: MatterRequestEvent["action"];
    detail: Record<string, unknown>;
  },
): Promise<ServiceResult<null>> {
  const { error } = await db.from("matter_request_events").insert({
    request_id: event.requestId,
    matter_id: event.matterId,
    actor_user_id: event.actorUserId,
    action: event.action,
    detail: event.detail,
  });
  return error ? internalFailure(error) : ok(null);
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
