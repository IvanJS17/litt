/**
 * Reading the rule suggestions of a matter with their decisions and whether each
 * one still stands (S8a, S8c). Read, never stored: the state is computed on every
 * read from the events, the source version and this release's catalog.
 */

import type { RuleSuggestion, RuleSuggestionStaleReason } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { readSources, sourceStateFor } from "../client-profile/client-profile.service";
import { findRule, isUsable, type ObligationRuleDef } from "./radar.rules";

/** Suggestions of one matter read at most; a matter that reaches it cannot ask for more. */
export const MAX_SUGGESTIONS_PER_MATTER = 2000;
export const SUGGESTION_LIMIT_CODE = "rule_suggestion_limit";

export type SuggestionRow = {
  id: string;
  flow: "catalog_match" | "lawyer_answer";
  matter_id: string;
  /** Null for a "lawyer_answer" suggestion: its evidence is the lawyer's answer, not a document. */
  document_id: string | null;
  version_id: string | null;
  text_sha256: string | null;
  start_char: number | null;
  end_char: number | null;
  quote: string | null;
  question_id: string | null;
  run_id: string | null;
  page: number | null;
  rule_code: string;
  rule_version: number;
  ai_reason: string | null;
  created_by: string | null;
  created_at: string;
};
export const SUGGESTION_COLUMNS =
  "id, flow, matter_id, document_id, version_id, text_sha256, start_char, end_char, quote, question_id, run_id, page, rule_code, rule_version, ai_reason, created_by, created_at";

export type EventRow = { id: string; suggestion_id: string; actor_user_id: string | null; action: "accepted" | "discarded"; created_at: string };

export const statusOf = (events: readonly Pick<EventRow, "action">[]): "pending" | "accepted" | "discarded" =>
  events.some((event) => event.action === "discarded") ? "discarded" : events.some((event) => event.action === "accepted") ? "accepted" : "pending";

/** The reason a suggestion no longer stands, from its source and from the catalog of this release. */
function staleReasonOf(
  row: Pick<SuggestionRow, "rule_code" | "rule_version">,
  sourceReason: RuleSuggestionStaleReason | null,
  catalog: readonly ObligationRuleDef[],
): RuleSuggestionStaleReason | null {
  if (sourceReason) return sourceReason;
  const rule = findRule(catalog, `${row.rule_code}@${row.rule_version}`);
  if (!rule) return "rule_changed";
  return isUsable(rule) ? null : "rule_unverified";
}

/** The suggestions of a matter with their decisions and whether each still stands. Read, never stored. */
export async function loadSuggestions(
  db: Db,
  access: { matterId: string; projectId: string },
  catalog: readonly ObligationRuleDef[],
  only?: string,
): Promise<ServiceResult<RuleSuggestion[]>> {
  let query = db.from("obligation_rule_suggestions").select(SUGGESTION_COLUMNS).eq("matter_id", access.matterId);
  if (only) query = query.eq("id", only);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_SUGGESTIONS_PER_MATTER);
  if (error) return internalFailure(error);
  const rows = (data ?? []) as unknown as SuggestionRow[];
  if (rows.length === 0) return ok([]);

  let eventQuery = db
    .from("obligation_rule_suggestion_events")
    .select("id, suggestion_id, actor_user_id, action, created_at")
    .eq("matter_id", access.matterId);
  if (only) eventQuery = eventQuery.eq("suggestion_id", only);
  const { data: eventData, error: eventError } = await eventQuery.order("created_at", { ascending: true }).limit(MAX_SUGGESTIONS_PER_MATTER * 2);
  if (eventError) return internalFailure(eventError);
  const bySuggestion = new Map<string, EventRow[]>();
  for (const event of (eventData ?? []) as unknown as EventRow[])
    bySuggestion.set(event.suggestion_id, [...(bySuggestion.get(event.suggestion_id) ?? []), event]);

  // A discarded suggestion is never obsolete, so its source is not read.
  // An answer-based suggestion has no source to read.
  const open = rows.filter(
    (row): row is SuggestionRow & { document_id: string; version_id: string; text_sha256: string } =>
      row.version_id !== null && row.document_id !== null && row.text_sha256 !== null && statusOf(bySuggestion.get(row.id) ?? []) !== "discarded",
  );
  const sources = await readSources(db, access.projectId, open);
  if (!sources.ok) return sources;

  return ok(
    rows.map((row): RuleSuggestion => {
      const events = bySuggestion.get(row.id) ?? [];
      const status = statusOf(events);
      const documentRow = row.version_id !== null && row.text_sha256 !== null ? { version_id: row.version_id, text_sha256: row.text_sha256 } : null;
      const source = documentRow
        ? (sourceStateFor(documentRow, sources.data) ?? {
            versionNumber: null,
            filename: null,
            staleReason: "version_missing" as const,
            currentSha: null,
          })
        : null;
      const stale = status === "discarded" ? null : staleReasonOf(row, source?.staleReason ?? null, catalog);
      const decision = [...events].reverse()[0];
      return {
        id: row.id,
        matter_id: row.matter_id,
        rule_key: `${row.rule_code}@${row.rule_version}`,
        rule_code: row.rule_code,
        rule_version: row.rule_version,
        evidence: row.flow === "lawyer_answer" ? "lawyer_answer" : "document",
        quote: row.quote,
        reason: row.ai_reason,
        page: row.page,
        question_id: row.question_id,
        source:
          source && row.document_id !== null && row.version_id !== null && row.start_char !== null && row.end_char !== null && row.text_sha256 !== null
            ? {
                document_id: row.document_id,
                version_id: row.version_id,
                version_number: source.versionNumber,
                filename: source.filename,
                start_char: row.start_char,
                end_char: row.end_char,
                text_sha256: row.text_sha256,
              }
            : null,
        status,
        stale_reason: stale,
        effective_status: stale && status !== "discarded" ? "obsolete" : status,
        created_by: row.created_by,
        created_at: row.created_at,
        decided_by: decision?.actor_user_id ?? null,
        decided_at: decision?.created_at ?? null,
      };
    }),
  );
}

