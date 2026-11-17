/**
 * The lawyer's decision on a fact: confirm or reject. A fact counts as
 * confirmed only after a `confirmed` event exists, and that event is written
 * before anything answers success: unlike a history note, a lost decision row
 * is a failure, because the row is the proof of who decided and when. The
 * event carries the SHA-256 of the cited text the lawyer's decision stood on.
 */

import type { ProfileFact } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { authorizeMatterMember } from "../matters/matters.service";
import { isFactId, loadFacts, NOT_FOUND, type Actor } from "./client-profile.facts";
import {
  cleanText,
  FACT_ALREADY_DECIDED_CODE,
  FACT_STALE_CODE,
  INVALID_FACT_CODE,
  isRecord,
  NOT_A_RETAINER_CODE,
  REASON_MAX,
} from "./client-profile.shared";

type Decision = "confirmed" | "rejected";

async function decide(
  db: Db,
  actor: Actor & { factId: unknown; body: unknown },
  action: Decision,
): Promise<ServiceResult<ProfileFact>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer)
      return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    if (!isFactId(actor.factId)) return failure("not_found", NOT_FOUND);

    let reason: string | null = null;
    if (actor.body != null) {
      if (!isRecord(actor.body)) return failure("validation", "A request body must be an object.", INVALID_FACT_CODE);
      if (actor.body.reason != null && actor.body.reason !== "") {
        reason = cleanText(actor.body.reason, REASON_MAX);
        if (!reason) return failure("validation", `reason must be 1 to ${REASON_MAX} characters.`, INVALID_FACT_CODE);
      }
    }

    const found = await loadFacts(db, access.data, actor.factId);
    if (!found.ok) return found;
    const fact = found.data[0];
    if (!fact) return failure("not_found", NOT_FOUND);

    if (fact.status === "rejected" || (action === "confirmed" && fact.status !== "pending"))
      return failure("conflict", "That fact was already decided.", FACT_ALREADY_DECIDED_CODE);
    // What is confirmed is what the lawyer can still read in the document.
    if (action === "confirmed" && fact.stale_reason)
      return failure("conflict", "The cited text changed or is gone; capture the fact again.", FACT_STALE_CODE);

    const { error } = await db.from("matter_profile_fact_events").insert({
      fact_id: fact.id,
      matter_id: access.data.matterId,
      actor_user_id: actor.userId,
      action,
      // Confirmed against exactly the text the fact was captured from.
      text_sha256: action === "confirmed" ? fact.source.text_sha256 : null,
      reason,
    });
    if (error && isRecord(error) && error.code === "23514")
      return failure("conflict", "That fact was already decided.", FACT_ALREADY_DECIDED_CODE);
    if (error) return internalFailure(error);

    const after = await loadFacts(db, access.data, fact.id);
    if (!after.ok) return after;
    return after.data[0] ? ok(after.data[0]) : failure("not_found", NOT_FOUND);
  } catch (error) {
    return internalFailure(error);
  }
}

export const confirmProfileFact = (db: Db, actor: Actor & { factId: unknown; body: unknown }) =>
  decide(db, actor, "confirmed");
export const rejectProfileFact = (db: Db, actor: Actor & { factId: unknown; body: unknown }) =>
  decide(db, actor, "rejected");
