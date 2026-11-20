/**
 * "Sugerir reglas" over ALL the documents of a client (S8c, docs/obligation-rules.md,
 * "Rule suggestions: all documents and questions"). Two steps, both the lawyer's
 * click:
 *
 *  1. `planRuleRead`: which current document versions of the matter have ready
 *     text, grouped as WHOLE documents into calls of at most 120,000 characters
 *     of text each. A document above that is never cut and never sent: it is
 *     listed as skipped. Reads text that is already extracted; no model, no
 *     egress, no OCR, no split.
 *  2. `readRuleBatch`: ONE call of that plan. Same route, key, egress record
 *     (before the call), fixed prompt and the SAME full catalog list as S8a (C5).
 *     What leaves LiTT per call: the fixed prompt with the verified catalog, and
 *     the text of the documents of that call, numbered, never named. Nothing
 *     else: no file name, matter or client, profile, memory, chat, earlier
 *     answers of the lawyer. A rule found again in a later call of the same run
 *     keeps the better citation; the model's questions are saved, never answered.
 *
 * It never writes a rule, an operation or a date; a suggestion is a record to
 * review and turns nothing on.
 */

import crypto from "node:crypto";
import type {
  RuleReadBatchResult,
  RuleReadPlan,
  RuleReadSkipped,
} from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { selectInBatches } from "../../lib/batchedQuery";
import { mapWithConcurrency } from "../../lib/concurrency";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { meteredCompletion } from "../../lib/aiCallUsage";
import { completeText } from "../../lib/llm";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { UserFacingError } from "../../lib/userFacingError";
import { isUuid } from "../../lib/uuid";
import { locateQuote } from "../chat/chat.service";
import {
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_TIMEOUT_MS,
  isRecord,
  readModelArray,
  resolveExtractionRoute,
  sha256,
  SOURCE_TEXT_UNAVAILABLE_CODE,
  VERSION_NOT_IN_MATTER_CODE,
} from "../client-profile/client-profile.service";
import { authorizeMatterMember } from "../matters/matters.service";
import { recordChatEgressOrThrow } from "../user/user.service";
import { OBLIGATION_RULES, RAW_CATALOG } from "./radar.rules.catalog";
import { isUsable, ruleKey, type ObligationRuleDef } from "./radar.rules";
import { loadRuleStates } from "./radar.rules.state";
import { NOT_A_RETAINER_CODE } from "./radar.shared";
import { catalogForSuggestions } from "./radar.suggest";
import {
  buildReadAllPrompt,
  buildReadAllSystemPrompt,
  groupIntoBatches,
  INVALID_RUN_CODE,
  isBetterCitation,
  MAX_BATCH_CHARS,
  MAX_READ_DOCUMENTS,
  NO_DOCUMENTS_CODE,
  opaqueDocumentId,
  planRead,
  READ_ALL_SURFACE,
  READ_BATCH_TOO_LARGE_CODE,
  TOO_MANY_DOCUMENTS_CODE,
} from "./radar.suggest.all.shared";
import { MAX_SUGGESTIONS_PER_MATTER, SUGGESTION_LIMIT_CODE } from "./radar.suggest.load";
import {
  SUGGEST_OUTPUT_INVALID_CODE,
  SUGGEST_PROVIDER_FAILED_CODE,
  SUGGEST_PROVIDER_REFUSED_CODE,
} from "./radar.suggest.shared";
import { refuseTrainee } from "./radar.trainee";

type Actor = { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown };
type Dependencies = { completeText?: typeof completeText };
type Current = { versionId: string; documentId: string; versionNumber: number | null; filename: string | null };

/** The current version of every live document of the project, in a fixed order. */
async function currentVersions(db: Db, projectId: string): Promise<ServiceResult<Current[]>> {
  const { data, error } = await db
    .from("documents")
    .select("id, current_version_id")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .limit(MAX_READ_DOCUMENTS + 1);
  if (error) return internalFailure(error);
  const documents = ((data ?? []) as unknown as { id: string; current_version_id: string | null }[]).filter(
    (row) => row.current_version_id,
  );
  if (documents.length > MAX_READ_DOCUMENTS)
    return failure("unprocessable", `The matter holds more than ${MAX_READ_DOCUMENTS} documents.`, TOO_MANY_DOCUMENTS_CODE);
  const versions = await selectInBatches<{ id: string; document_id: string; version_number: number | null; filename: string | null }>(
    "rule read versions",
    documents.map((row) => row.current_version_id as string),
    (batch) => db.from("document_versions").select("id, document_id, version_number, filename").in("id", batch).is("deleted_at", null),
  );
  const current = versions.map((row) => ({
    versionId: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    filename: row.filename,
  }));
  current.sort((a, b) => (a.filename ?? "").localeCompare(b.filename ?? "") || a.versionId.localeCompare(b.versionId));
  return ok(current);
}

/** Ids of a request body: a non-empty list of distinct uuids, or the failure. */
function readVersionIds(value: unknown): ServiceResult<string[]> {
  if (!Array.isArray(value) || value.length === 0 || !value.every((one) => typeof one === "string" && isUuid(one)))
    return failure("validation", "versionIds must be a non-empty list of ids.", NO_DOCUMENTS_CODE);
  return ok([...new Set(value as string[])]);
}

type Writer = { organizationId: string; projectId: string; matterId: string };

async function authorizeReader(db: Db, actor: Actor): Promise<ServiceResult<Writer>> {
  const access = await authorizeMatterMember(db, { ...actor, write: true });
  if (!access.ok) return access;
  const trainee = await refuseTrainee(db, actor.userId, access.data.organizationId, access.data.projectId);
  if (trainee) return trainee;
  if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
  return ok({ organizationId: access.data.organizationId, projectId: access.data.projectId, matterId: access.data.matterId });
}

/**
 * What reading the documents would do. `body.versionIds` (optional) is the
 * lawyer's selection; without it, every current version of the matter.
 */
export async function planRuleRead(db: Db, actor: Actor & { body: unknown }): Promise<ServiceResult<RuleReadPlan>> {
  try {
    const access = await authorizeReader(db, actor);
    if (!access.ok) return access;
    const current = await currentVersions(db, access.data.projectId);
    if (!current.ok) return current;

    let chosen = current.data;
    const asked = isRecord(actor.body) ? actor.body.versionIds : undefined;
    if (asked !== undefined) {
      const ids = readVersionIds(asked);
      if (!ids.ok) return ids;
      const byId = new Map(current.data.map((one) => [one.versionId, one]));
      if (!ids.data.every((id) => byId.has(id)))
        return failure("validation", "A version is not a current document of this matter.", VERSION_NOT_IN_MATTER_CODE);
      chosen = current.data.filter((one) => ids.data.includes(one.versionId));
    }

    const read = await mapWithConcurrency(chosen, 4, async (one) => {
      const state = await loadVersionTextState(db, one.documentId, one.versionId);
      const text = state?.text ?? null;
      return { ...one, chars: text === null || text.trim() === "" ? null : text.length };
    });
    const skipped: RuleReadSkipped[] = [];
    const candidates: (Current & { chars: number })[] = [];
    for (const one of read) {
      if (one.chars === null)
        skipped.push({ version_id: one.versionId, version_number: one.versionNumber, filename: one.filename, reason: "no_text" });
      else candidates.push({ ...one, chars: one.chars });
    }
    const grouped = groupIntoBatches(candidates);
    for (const one of grouped.tooLong)
      skipped.push({ version_id: one.versionId, version_number: one.versionNumber, filename: one.filename, reason: "too_long" });
    return ok({
      max_chars: MAX_BATCH_CHARS,
      batches: grouped.batches.map((batch) => ({
        chars: batch.reduce((sum, one) => sum + one.chars, 0),
        documents: batch.map((one) => ({
          version_id: one.versionId,
          document_id: one.documentId,
          version_number: one.versionNumber,
          filename: one.filename,
          chars: one.chars,
        })),
      })),
      skipped,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

type Known = { id: string; rule_code: string; rule_version: number; version_id: string | null; run_id: string | null; quote: string | null; page: number | null; flow: string };

/** One call of the plan. */
export async function readRuleBatch(
  db: Db,
  actor: Actor & { body: unknown },
  dependencies: Dependencies = {},
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
  raw: typeof RAW_CATALOG = RAW_CATALOG,
): Promise<ServiceResult<RuleReadBatchResult>> {
  try {
    const access = await authorizeReader(db, actor);
    if (!access.ok) return access;
    const body = isRecord(actor.body) ? actor.body : {};
    const runId = body.runId;
    if (typeof runId !== "string" || !isUuid(runId))
      return failure("validation", "runId must be an id.", INVALID_RUN_CODE);
    const ids = readVersionIds(body.versionIds);
    if (!ids.ok) return ids;
    if (ids.data.length > MAX_READ_DOCUMENTS)
      return failure("unprocessable", `At most ${MAX_READ_DOCUMENTS} documents per call.`, TOO_MANY_DOCUMENTS_CODE);

    const current = await currentVersions(db, access.data.projectId);
    if (!current.ok) return current;
    const byId = new Map(current.data.map((one) => [one.versionId, one]));
    if (!ids.data.every((id) => byId.has(id)))
      return failure("validation", "A version is not a current document of this matter.", VERSION_NOT_IN_MATTER_CODE);

    // Only text that is ready. Nothing here reads a file, runs OCR or splits it.
    const docs: { versionId: string; documentId: string; text: string }[] = [];
    for (const id of ids.data) {
      const one = byId.get(id) as Current;
      const state = await loadVersionTextState(db, one.documentId, id);
      const text = state?.text ?? null;
      if (text === null || text.trim() === "")
        return failure("unprocessable", "The text of a document is not ready, so it cannot be read.", SOURCE_TEXT_UNAVAILABLE_CODE);
      docs.push({ versionId: id, documentId: one.documentId, text });
    }
    // Never cut, per call (C6): refused before any route, record or call.
    if (docs.reduce((sum, one) => sum + one.text.length, 0) > MAX_BATCH_CHARS)
      return failure("unprocessable", `The documents of one call add up to more than ${MAX_BATCH_CHARS} characters.`, READ_BATCH_TOO_LARGE_CODE);

    const { data: existing, error: existingError } = await db
      .from("obligation_rule_suggestions")
      .select("id, rule_code, rule_version, version_id, run_id, quote, page, flow")
      .eq("matter_id", access.data.matterId)
      .limit(MAX_SUGGESTIONS_PER_MATTER);
    if (existingError) return internalFailure(existingError);
    const known = (existing ?? []) as unknown as Known[];
    if (known.length >= MAX_SUGGESTIONS_PER_MATTER)
      return failure("conflict", "The matter holds as many suggestions as it can.", SUGGESTION_LIMIT_CODE);
    const { data: asked, error: askedError } = await db
      .from("obligation_rule_questions")
      .select("rule_code, rule_version")
      .eq("matter_id", access.data.matterId)
      .limit(MAX_SUGGESTIONS_PER_MATTER);
    if (askedError) return internalFailure(askedError);
    const questioned = new Set(((asked ?? []) as unknown as { rule_code: string; rule_version: number }[]).map((row) => `${row.rule_code}@${row.rule_version}`));

    // What this run already holds (earlier calls), unless an earlier call replaced it.
    const runRows = known.filter((row) => row.run_id === runId && row.flow === "catalog_match");
    const replaced = new Set<string>();
    if (runRows.length > 0) {
      const { data: eventData, error: eventError } = await db
        .from("obligation_rule_suggestion_events")
        .select("suggestion_id, action")
        .eq("matter_id", access.data.matterId)
        .in("suggestion_id", runRows.map((row) => row.id))
        .limit(MAX_SUGGESTIONS_PER_MATTER * 2);
      if (eventError) return internalFailure(eventError);
      for (const event of (eventData ?? []) as unknown as { suggestion_id: string; action: string }[])
        if (event.action === "discarded") replaced.add(event.suggestion_id);
    }
    const held = new Map<string, { id: string; quote: string; page: number | null }>();
    for (const row of runRows)
      if (!replaced.has(row.id) && row.quote !== null) held.set(`${row.rule_code}@${row.rule_version}`, { id: row.id, quote: row.quote, page: row.page });
    const seen = new Set(known.filter((row) => row.version_id !== null).map((row) => `${row.rule_code}@${row.rule_version}|${row.version_id}`));
    const suggestedKeys = new Set(known.filter((row) => row.flow === "catalog_match").map((row) => `${row.rule_code}@${row.rule_version}`));

    // The route first, before anything is sent: no key, no call, no other route, no record.
    const routed = await resolveExtractionRoute(db, { userId: actor.userId, orgId: access.data.organizationId });
    if (!routed.ok) return routed;
    const { resolved } = routed.data;
    const states = await loadRuleStates(db, access.data.matterId);
    if (!states.ok) return states;

    // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
    await recordChatEgressOrThrow(db, {
      userId: actor.userId,
      orgId: access.data.organizationId,
      chatId: null,
      projectId: access.data.projectId,
      surface: READ_ALL_SURFACE,
      resolved,
      extra: { matter_id: access.data.matterId, run_id: runId, document_count: String(docs.length) },
    });

    let answer: string;
    try {
      answer = await meteredCompletion(db, {
        surface: READ_ALL_SURFACE, userId: actor.userId, orgId: access.data.organizationId, matterId: access.data.matterId,
        projectId: access.data.projectId, provider: resolved.route.provider, model: resolved.route.model,
      }, dependencies.completeText ?? completeText)({
        model: resolved.route.model,
        systemPrompt: buildReadAllSystemPrompt(catalogForSuggestions(catalog, raw)),
        user: buildReadAllPrompt(
          docs.map((one) => one.text),
          crypto.randomBytes(12).toString("hex"),
        ),
        maxTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        apiKeys: resolved.apiKeys,
        abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (error) {
      // Never the provider's words or request: they can carry the documents.
      reportError(new AppError("rule_suggestions.read_all_call_failed", "[radar] rule suggestion read-all call failed"), {
        tags: { operation: "radar.read_rule_batch", provider: resolved.route.provider },
      });
      if (error instanceof UserFacingError)
        return failure("unprocessable", "The AI provider did not accept the request.", SUGGEST_PROVIDER_REFUSED_CODE);
      return failure("unprocessable", "The AI provider could not answer.", SUGGEST_PROVIDER_FAILED_CODE);
    }

    const array = readModelArray(answer);
    if (!array) return failure("unprocessable", "The model did not answer with the expected list.", SUGGEST_OUTPUT_INVALID_CODE);

    const plan = planRead(array);
    const docIds = docs.map((_, index) => opaqueDocumentId(index));
    const shas = new Map(docs.map((one) => [one.versionId, sha256(one.text)]));
    const out: RuleReadBatchResult = {
      suggested: 0,
      discarded_unknown_rule: 0,
      discarded_already_active: 0,
      discarded_quote_not_found: 0,
      discarded_duplicate: 0,
      discarded_invalid: plan.invalid,
      suggestion_ids: [],
      questions_asked: 0,
      discarded_question_invalid: 0,
      superseded: 0,
    };
    for (const item of plan.suggestions) {
      const chosen = catalog.filter((entry) => entry.code === item.ruleCode && isUsable(entry)).sort((a, b) => b.version - a.version)[0];
      if (!chosen) {
        out.discarded_unknown_rule += 1;
        continue;
      }
      if (states.data.get(ruleKey(chosen))?.active) {
        out.discarded_already_active += 1;
        continue;
      }
      // The quote is in THE document the model names (an opaque id of this call), as the manual path finds it.
      const doc = docs[docIds.indexOf(item.documentId)];
      if (!doc) {
        out.discarded_invalid += 1;
        continue;
      }
      const located = locateQuote(doc.text, item.quote);
      if (!located) {
        out.discarded_quote_not_found += 1;
        continue;
      }
      if ([...located.excerpt].length > 500) {
        out.discarded_invalid += 1;
        continue;
      }
      const key = ruleKey(chosen);
      if (seen.has(`${key}|${doc.versionId}`)) {
        out.discarded_duplicate += 1;
        continue;
      }
      // One suggestion per rule and run: a later call keeps the better citation.
      const earlier = held.get(key);
      if (earlier && !isBetterCitation({ page: item.page, quote: located.excerpt }, earlier)) {
        out.discarded_duplicate += 1;
        continue;
      }
      const { data: saved, error } = await db
        .from("obligation_rule_suggestions")
        .insert({
          flow: "catalog_match",
          org_id: access.data.organizationId,
          matter_id: access.data.matterId,
          project_id: access.data.projectId,
          document_id: doc.documentId,
          version_id: doc.versionId,
          text_sha256: shas.get(doc.versionId),
          start_char: located.start,
          end_char: located.end,
          // The passage as the document words it, never as the model wrote it.
          quote: located.excerpt,
          page: item.page,
          rule_code: chosen.code,
          rule_version: chosen.version,
          ai_reason: item.reason,
          run_id: runId,
          created_by: actor.userId,
        })
        .select("id")
        .single();
      if (error && isRecord(error) && error.code === "23505") {
        seen.add(`${key}|${doc.versionId}`);
        out.discarded_duplicate += 1;
        continue;
      }
      if (error || !saved) return internalFailure(error ?? new Error("suggestion insert returned no row"));
      const savedId = (saved as unknown as { id: string }).id;
      seen.add(`${key}|${doc.versionId}`);
      suggestedKeys.add(key);
      if (earlier) {
        // Insert-only: the replaced one is not edited, it gets a "discarded" event with no actor.
        const { error: eventError } = await db.from("obligation_rule_suggestion_events").insert({
          suggestion_id: earlier.id,
          matter_id: access.data.matterId,
          actor_user_id: null,
          action: "discarded",
          reason: "Replaced by a better citation of the same rule in the same reading.",
        });
        if (eventError) return internalFailure(eventError);
        out.superseded += 1;
        // Replaced within this very call: it was never a suggestion of this call's result.
        if (out.suggestion_ids.includes(earlier.id)) {
          out.suggestion_ids = out.suggestion_ids.filter((id) => id !== earlier.id);
          out.suggested -= 1;
        }
      }
      held.set(key, { id: savedId, quote: located.excerpt, page: item.page });
      out.suggested += 1;
      out.suggestion_ids.push(savedId);
    }

    // Questions: only for a rule that is verified, off, not suggested with a quote and not asked before.
    for (const item of plan.questions) {
      const chosen = catalog.filter((entry) => entry.code === item.ruleCode && isUsable(entry)).sort((a, b) => b.version - a.version)[0];
      const key = chosen ? ruleKey(chosen) : null;
      if (!chosen || !key || states.data.get(key)?.active || suggestedKeys.has(key) || questioned.has(key)) {
        out.discarded_question_invalid += 1;
        continue;
      }
      const { error } = await db.from("obligation_rule_questions").insert({
        org_id: access.data.organizationId,
        matter_id: access.data.matterId,
        project_id: access.data.projectId,
        rule_code: chosen.code,
        rule_version: chosen.version,
        run_id: runId,
        created_by: actor.userId,
      });
      if (error && isRecord(error) && error.code === "23505") {
        questioned.add(key);
        out.discarded_question_invalid += 1;
        continue;
      }
      if (error) return internalFailure(error);
      questioned.add(key);
      out.questions_asked += 1;
    }
    return ok(out);
  } catch (error) {
    return internalFailure(error);
  }
}
