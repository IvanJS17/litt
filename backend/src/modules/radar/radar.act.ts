/**
 * A lawyer's reaction to a radar item: acknowledge it (seen), dismiss it (not a
 * deadline to track; a reason is required) or mark it done. Each is an
 * insert-only event; nothing is edited or deleted. The event is written before
 * anything answers success: it is the record of who decided and when.
 */

import type { RadarItem } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { authorizeMatterMember } from "../matters/matters.service";
import { todayInMexicoCity } from "./radar.dates";
import { parseItemKey } from "./radar.derive";
import { loadRadarItems } from "./radar.items";
import {
  INVALID_ACTION_CODE,
  ITEM_CLOSED_CODE,
  NOT_A_RETAINER_CODE,
  REASON_MAX,
  REASON_REQUIRED_CODE,
  type RadarActionName,
} from "./radar.shared";

const NOT_FOUND = "Not found";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function actOnRadarItem(
  db: Db,
  actor: {
    userId: string;
    userEmail?: string | null;
    projectId: unknown;
    matterId: unknown;
    itemKey: unknown;
    body: unknown;
    now?: Date;
  },
  action: RadarActionName,
): Promise<ServiceResult<RadarItem>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    const key = parseItemKey(actor.itemKey);
    if (!key) return failure("not_found", NOT_FOUND);

    let reason: string | null = null;
    if (actor.body != null && !isRecord(actor.body))
      return failure("validation", "A request body must be an object.", INVALID_ACTION_CODE);
    const rawReason = isRecord(actor.body) ? actor.body.reason : undefined;
    if (rawReason != null) {
      if (typeof rawReason !== "string" || [...rawReason.trim()].length > REASON_MAX)
        return failure("validation", `reason must be text of at most ${REASON_MAX} characters.`, INVALID_ACTION_CODE);
      reason = rawReason.trim() || null;
    }
    if (action === "dismiss" && !reason)
      return failure("validation", "Dismissing an item needs a reason.", REASON_REQUIRED_CODE);

    const today = todayInMexicoCity(actor.now ?? new Date());
    const before = await loadRadarItems(db, access.data, today);
    if (!before.ok) return before;
    const item = before.data.find((entry) => entry.key === `${key.factId}:${key.type}`);
    if (!item) return failure("not_found", NOT_FOUND);
    const alive = item.state === "open" || (item.state === "acknowledged" && action !== "ack");
    if (!alive) return failure("conflict", "That item was already handled.", ITEM_CLOSED_CODE);

    const { error } = await db.from("matter_radar_item_events").insert({
      matter_id: access.data.matterId,
      fact_id: item.fact_id,
      item_type: item.type,
      action,
      due_on: item.due_on,
      reason,
      actor_user_id: actor.userId,
    });
    // Two actions at once: the database refuses the second.
    if (error && isRecord(error) && error.code === "23514")
      return failure("conflict", "That item was already handled.", ITEM_CLOSED_CODE);
    if (error) return internalFailure(error);

    const after = await loadRadarItems(db, access.data, today);
    if (!after.ok) return after;
    const updated = after.data.find((entry) => entry.key === item.key);
    return updated ? ok(updated) : failure("not_found", NOT_FOUND);
  } catch (error) {
    return internalFailure(error);
  }
}
