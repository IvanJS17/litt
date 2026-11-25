/**
 * What Donna's triage used this month: the cap (one constant per firm) and the
 * firm's usage view. Counts, tokens and cost only: never a title, a document or
 * a private matter's name.
 */

import type { DonnaUsage } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { manager } from "./requests.types";
import { DONNA_MONTHLY_RUN_CAP, monthWindow } from "./requests.triage.shared";

const MAX_RUNS_READ = 20_000;

/** Places the firm's runs took in the calendar month of `now` (automatic and manual): the number the cap compares. */
export async function countMonthRuns(db: Db, orgId: string, now: Date = new Date()): Promise<ServiceResult<number>> {
  const window = monthWindow(now);
  const { count, error } = await db
    .from("matter_request_triage_reservations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("created_at", window.start)
    .lt("created_at", window.end);
  if (error) return internalFailure(error);
  return ok(count ?? 0);
}

type RunRow = {
  project_id: string;
  classify_error: string | null;
  generative_status: string;
  jev_input_tokens: number | null;
  jev_output_tokens: number | null;
  jev_cost_usd: number | string | null;
};

/** The firm's usage this month. Owner or admin of the firm. */
export async function getDonnaUsage(
  db: Db,
  actor: { userId: string; userEmail?: string | null; orgId: unknown },
  now: Date = new Date(),
): Promise<ServiceResult<DonnaUsage>> {
  try {
    const who = await manager(db, actor);
    if (!who.ok) return who;
    const window = monthWindow(now);
    const { data, error } = await db
      .from("matter_request_triage_runs")
      .select("project_id, classify_error, generative_status, jev_input_tokens, jev_output_tokens, jev_cost_usd")
      .eq("org_id", who.data.orgId)
      .gte("created_at", window.start)
      .lt("created_at", window.end)
      .order("created_at", { ascending: true })
      .limit(MAX_RUNS_READ);
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as RunRow[];
    const jev = { runs: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    let byok = 0;
    const perProject = new Map<string, number>();
    for (const row of rows) {
      // A run asks Jev unless the platform has no key; the BYOK route only when the firm has one.
      if (row.classify_error !== "no_key") jev.runs += 1;
      jev.input_tokens += row.jev_input_tokens ?? 0;
      jev.output_tokens += row.jev_output_tokens ?? 0;
      jev.cost_usd += Number(row.jev_cost_usd ?? 0);
      if (row.generative_status !== "no_key") byok += 1;
      perProject.set(row.project_id, (perProject.get(row.project_id) ?? 0) + 1);
    }
    // The month's count is the places taken; a place whose run failed before it was
    // written has no row here, so it adds nothing to the tokens, cost or per-project figures.
    const usedResult = await countMonthRuns(db, who.data.orgId, now);
    if (!usedResult.ok) return usedResult;
    const used = usedResult.data;
    return ok({
      month: window.label,
      limit: DONNA_MONTHLY_RUN_CAP,
      used,
      remaining: Math.max(0, DONNA_MONTHLY_RUN_CAP - used),
      engines: {
        jev: { ...jev, cost_usd: Math.round(jev.cost_usd * 1e6) / 1e6 },
        byok: { runs: byok },
      },
      // Opaque labels, ordered by volume: a private matter's project name is not the firm's to read.
      projects: [...perProject.values()].sort((a, b) => b - a).map((runs, index) => ({ label: `Proyecto ${index + 1}`, runs })),
    });
  } catch (error) {
    return internalFailure(error);
  }
}
