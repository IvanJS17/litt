/**
 * Reads what the report needs from the modules that own it (requests, client
 * profile, radar) and hands it to the pure builder. Only an owner or editor of
 * a private retainer matter generates a report; anyone else gets the 404 of the
 * rest of the matter's routes (or a 403 for a member who may only read).
 */

import type { RetainerReport, RetainerReportDays, RetainerReportLocale } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { loadFacts } from "../client-profile/client-profile.service";
import { authorizeMatterMember, type MatterAccess } from "../matters/matters.service";
import { getMatterRadar } from "../radar/radar.service";
import { listMatterRequests } from "../requests/requests.service";
import { buildReport } from "./retainer-report.build";
import { todayInMexicoCity } from "./retainer-report.shared";

export type ReportActor = {
  userId: string;
  userEmail?: string | null;
  projectId: unknown;
  matterId: unknown;
  /** Injected by tests; the real clock otherwise. */
  now?: Date;
};

const NOT_FOUND = "Not found";

/** The caller as an owner or editor of a private retainer matter, or the failure. */
export async function authorizeReportWriter(db: Db, actor: ReportActor): Promise<ServiceResult<MatterAccess>> {
  const access = await authorizeMatterMember(db, { ...actor, write: true });
  if (!access.ok) return access;
  if (!access.data.isRetainer) return failure("not_found", NOT_FOUND);
  return access;
}

export async function getRetainerReport(
  db: Db,
  actor: ReportActor & { days: RetainerReportDays; locale: RetainerReportLocale },
): Promise<ServiceResult<RetainerReport>> {
  try {
    const access = await authorizeReportWriter(db, actor);
    if (!access.ok) return access;
    const now = actor.now ?? new Date();

    const { data: matter, error } = await db.from("matters").select("name").eq("id", access.data.matterId).maybeSingle();
    if (error) return internalFailure(error);

    const requests = await listMatterRequests(db, actor);
    if (!requests.ok) return requests;
    const facts = await loadFacts(db, access.data);
    if (!facts.ok) return facts;
    const radar = await getMatterRadar(db, { ...actor, now });
    if (!radar.ok) return radar;

    return ok(
      buildReport({
        today: todayInMexicoCity(now),
        days: actor.days,
        locale: actor.locale,
        matterName: (matter as { name?: string | null } | null)?.name ?? null,
        requests: requests.data.requests,
        types: requests.data.types,
        facts: facts.data,
        radarItems: radar.data.items,
      }),
    );
  } catch (error) {
    return internalFailure(error);
  }
}
