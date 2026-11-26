/**
 * Reads the triage card of a request: the latest run, what it proposed, and
 * what the lawyer decided about each item. Everyone who can read the request
 * reads the card; only an owner or editor who is not in training decides.
 */

import type { TriageCard, TriageDecision, TriageItem, TriageRun } from "@mike/contracts";
import { resolveTrainingStage } from "../../lib/training";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { authorizeMatterMember } from "../matters/matters.service";
import { ACCESS_COLUMNS, type AccessRow, openableBy } from "./requests.playbookAccess";
import { donnaEnabled, isTriagePending, playbooksForType } from "./requests.triage.run";
import { countMonthRuns } from "./requests.triage.usage";
import { DONNA_MONTHLY_RUN_CAP } from "./requests.triage.shared";

type Actor = { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown; requestId: unknown };

const NOT_FOUND = "Not found";

/**
 * People in training see the card and cannot decide on it, as with rule
 * suggestions (radar.trainee.ts): "in training" is the training module's one
 * definition, a stage for the person in the organization and project.
 */
export async function isTraineeIn(db: Db, userId: string, orgId: string, projectId: string): Promise<boolean> {
  return (await resolveTrainingStage(db, userId, { orgId, projectId })) !== null;
}
/** A request created this recently, with the switch on and no run yet, is still being analysed. */
const FRESH_MS = 3 * 60_000;

type RunRow = {
  id: string;
  trigger: "auto" | "manual";
  created_at: string;
  classify_status: TriageRun["classify_status"];
  generative_status: TriageRun["generative_status"];
  docs_total: number;
  docs_read: number;
  docs_partial: number;
  unread_version_ids: string[] | null;
  quotes_rejected: number;
};
type ItemRow = {
  id: string;
  kind: TriageItem["kind"];
  position: number;
  value_type_id: string | null;
  value_enum: string | null;
  value_user_id: string | null;
  confidence: number | string | null;
  low_confidence: boolean;
  forced_by_alarm: boolean;
  draft_text: string | null;
  draft_purpose: string | null;
  playbook_id: string | null;
  version_id: string | null;
};
type DecisionRow = TriageDecision & { item_id: string };

const RUN_COLUMNS =
  "id, trigger, created_at, classify_status, generative_status, docs_total, docs_read, docs_partial, unread_version_ids, quotes_rejected";
const ITEM_COLUMNS =
  "id, kind, position, value_type_id, value_enum, value_user_id, confidence, low_confidence, forced_by_alarm, draft_text, draft_purpose, playbook_id, version_id";
const DECISION_COLUMNS =
  "item_id, action, actor_user_id, created_at, edited_type_id, edited_enum, edited_user_id, edited_text, edited_purpose";

const KIND_ORDER: Record<string, number> = { type: 0, complexity: 1, urgency: 2, candidate: 3, strategy: 4, question: 5, document: 6 };

export async function latestRun(db: Db, requestId: string): Promise<ServiceResult<RunRow | null>> {
  const { data, error } = await db
    .from("matter_request_triage_runs")
    .select(RUN_COLUMNS)
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) return internalFailure(error);
  return ok(((data ?? []) as unknown as RunRow[])[0] ?? null);
}

/** Builds the card for a request the caller can already read. */
export async function buildCard(
  db: Db,
  input: {
    userId: string;
    orgId: string;
    projectId: string;
    matterId: string;
    request: { id: string; type_id: string; created_at: string };
    canWrite: boolean;
  },
): Promise<ServiceResult<TriageCard>> {
  const [enabled, used, runResult, trainee] = await Promise.all([
    donnaEnabled(db, input.projectId),
    countMonthRuns(db, input.orgId),
    latestRun(db, input.request.id),
    isTraineeIn(db, input.userId, input.orgId, input.projectId),
  ]);
  if (!enabled.ok) return enabled;
  if (!used.ok) return used;
  if (!runResult.ok) return runResult;
  const run = runResult.data;
  const usage = { used: used.data, limit: DONNA_MONTHLY_RUN_CAP };
  const canDecide = input.canWrite && !trainee;
  const fresh = Date.now() - new Date(input.request.created_at).getTime() < FRESH_MS;
  const pending =
    isTriagePending(input.request.id) || (run === null && enabled.data && used.data < DONNA_MONTHLY_RUN_CAP && fresh);
  if (!run) {
    const playbooks = await playbooksForType(db, input.orgId, input.request.type_id, input.userId);
    if (!playbooks.ok) return playbooks;
    return ok({ enabled: enabled.data, can_decide: canDecide, pending, usage, run: null, items: [], playbooks: playbooks.data });
  }

  const [itemsRead, unread] = await Promise.all([
    db.from("matter_request_triage_items").select(ITEM_COLUMNS).eq("run_id", run.id).limit(200),
    (run.unread_version_ids ?? []).length > 0
      ? db.from("document_versions").select("id, filename").in("id", run.unread_version_ids ?? [])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsRead.error) return internalFailure(itemsRead.error);
  if (unread.error) return internalFailure(unread.error);
  const rows = ((itemsRead.data ?? []) as unknown as ItemRow[]).sort(
    (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.position - b.position,
  );
  const decisionsRead = rows.length
    ? await db
        .from("matter_request_triage_decisions")
        .select(DECISION_COLUMNS)
        .eq("request_id", input.request.id)
        .in("item_id", rows.map((row) => row.id))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1000)
    : { data: [], error: null };
  if (decisionsRead.error) return internalFailure(decisionsRead.error);
  // The latest decision of an item is its state.
  const decisions = new Map<string, TriageDecision>();
  for (const { item_id, ...decision } of (decisionsRead.data ?? []) as unknown as DecisionRow[])
    decisions.set(item_id, decision);

  const playbookIds = [...new Set(rows.map((row) => row.playbook_id).filter((id): id is string => !!id))];
  const named = new Map<string, string>();
  if (playbookIds.length > 0) {
    const { data, error } = await db.from("playbooks").select(ACCESS_COLUMNS).eq("org_id", input.orgId).in("id", playbookIds);
    if (error) return internalFailure(error);
    try {
      for (const row of await openableBy(db, input.userId, input.orgId, (data ?? []) as unknown as AccessRow[])) named.set(row.id, row.name);
    } catch (caught) {
      return internalFailure(caught);
    }
  }
  const candidateIds = rows.filter((row) => row.value_user_id).map((row) => ({ user_id: row.value_user_id as string }));
  const profiles = candidateIds.length > 0 ? await loadCreatorProfiles(db, candidateIds) : new Map();

  const items: TriageItem[] = rows.map((row) => {
    const profile = row.value_user_id ? profiles.get(row.value_user_id) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      position: row.position,
      type_id: row.value_type_id,
      enum_value: row.value_enum,
      user_id: row.value_user_id,
      user_label: profile?.display_name ?? profile?.email ?? null,
      text: row.draft_text,
      purpose: row.draft_purpose,
      playbook: row.playbook_id && named.has(row.playbook_id) ? { id: row.playbook_id, name: named.get(row.playbook_id) as string } : null,
      confidence: row.confidence === null ? null : Number(row.confidence),
      low_confidence: row.low_confidence,
      forced_by_alarm: row.forced_by_alarm,
      cited: row.version_id !== null,
      decision: decisions.get(row.id) ?? null,
    };
  });

  const suggestedType = items.find((item) => item.kind === "type")?.type_id ?? input.request.type_id;
  const playbooks = await playbooksForType(db, input.orgId, suggestedType, input.userId);
  if (!playbooks.ok) return playbooks;
  const names = new Map(((unread.data ?? []) as unknown as { id: string; filename: string | null }[]).map((row) => [row.id, row.filename]));
  return ok({
    enabled: enabled.data,
    can_decide: canDecide,
    pending,
    usage,
    run: {
      id: run.id,
      trigger: run.trigger,
      created_at: run.created_at,
      classify_status: run.classify_status,
      generative_status: run.generative_status,
      docs_total: run.docs_total,
      docs_read: run.docs_read,
      docs_partial: run.docs_partial,
      unread: (run.unread_version_ids ?? []).map((id) => ({ version_id: id, filename: names.get(id) ?? null })),
      quotes_rejected: run.quotes_rejected,
    },
    items,
    playbooks: playbooks.data,
  });
}

/** `GET …/requests/:requestId/triage`. */
export async function getTriageCard(db: Db, actor: Actor): Promise<ServiceResult<TriageCard>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    if (!access.data.isRetainer) return failure("not_found", NOT_FOUND);
    if (typeof actor.requestId !== "string" || !isUuid(actor.requestId)) return failure("not_found", NOT_FOUND);
    const { data, error } = await db
      .from("matter_requests")
      .select("id, type_id, created_at")
      .eq("id", actor.requestId)
      .eq("matter_id", access.data.matterId)
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", NOT_FOUND);
    return buildCard(db, {
      userId: actor.userId,
      orgId: access.data.organizationId,
      projectId: access.data.projectId,
      matterId: access.data.matterId,
      request: data as unknown as { id: string; type_id: string; created_at: string },
      canWrite: access.data.canWrite,
    });
  } catch (error) {
    return internalFailure(error);
  }
}
