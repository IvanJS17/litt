/**
 * AI suggestions of which catalog obligation rules apply to a retainer client
 * (S8a, docs/obligation-rules.md, "Rule suggestions"). On the lawyer's click
 * the model of the space reads ONE version's text and says which rules of the
 * catalog may apply, each with a literal quote the code must find in that text.
 * A suggestion is a record to review: accepting it turns NOTHING on (turning a
 * rule on is the existing activation, with a confirmed date the lawyer picks),
 * and no date, operation or rule text ever comes from the model.
 *
 * What leaves LiTT, per click: the fixed prompt with the list of verified
 * catalog rules (the same list in every matter: never filtered by what the
 * client has turned on) and the version's text, and nothing else (no file name,
 * matter or client name, account, profile, instructions, memory, chat, other
 * documents). It goes from the server, to the provider of the route the project
 * chat would use in this space, with that route's key; there is no other route
 * and no silent fallback. It never goes to TypeSafe, LandingAI, a web search or
 * Jev, and the button never starts OCR or a split.
 */

import crypto from "node:crypto";
import type {
  ProfilePerson,
  RuleSuggestion,
  RuleSuggestionBatchResult,
  RuleSuggestionRun,
  RuleSuggestions,
} from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { completeText } from "../../lib/llm";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { UserFacingError } from "../../lib/userFacingError";
import { isUuid } from "../../lib/uuid";
import { locateQuote } from "../chat/chat.service";
import {
  buildExtractionPrompt,
  cleanText,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_TIMEOUT_MS,
  findLiveVersion,
  getExtractionRoute,
  isRecord,
  MAX_EXTRACT_TEXT_CHARS,
  readModelArray,
  resolveExtractionRoute,
  sha256,
  SOURCE_TEXT_UNAVAILABLE_CODE,
  sourceVersions,
  VERSION_NOT_IN_MATTER_CODE,
} from "../client-profile/client-profile.service";
import { authorizeMatterMember } from "../matters/matters.service";
import { recordChatEgressOrThrow } from "../user/user.service";
import { namePeople } from "./radar.people";
import { loadOpenQuestions } from "./radar.questions";
import { loadSuggestions, MAX_SUGGESTIONS_PER_MATTER, SUGGESTION_LIMIT_CODE } from "./radar.suggest.load";
import { OBLIGATION_RULES, RAW_CATALOG } from "./radar.rules.catalog";
import { isUsable, ruleKey, type ObligationRuleDef } from "./radar.rules";
import { loadRuleStates } from "./radar.rules.state";
import { NOT_A_RETAINER_CODE } from "./radar.shared";
import { isTraineeIn, refuseTrainee } from "./radar.trainee";
import {
  buildSuggestSystemPrompt,
  INVALID_SUGGESTION_CODE,
  planSuggestions,
  SUGGEST_OUTPUT_INVALID_CODE,
  SUGGEST_PROVIDER_FAILED_CODE,
  SUGGEST_PROVIDER_REFUSED_CODE,
  SUGGEST_SURFACE,
  SUGGEST_TEXT_TOO_LARGE_CODE,
  SUGGESTION_ALREADY_DECIDED_CODE,
  SUGGESTION_BATCH_MAX,
  SUGGESTION_DECISION_REASON_MAX,
  SUGGESTION_OBSOLETE_CODE,
  type CatalogEntryForPrompt,
} from "./radar.suggest.shared";

const NOT_FOUND = "Not found";

type Actor = { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown };
type Dependencies = { completeText?: typeof completeText };

/**
 * Every verified rule of the catalog, with the three things the model is told
 * (code, name, when it applies: legal's own Spanish words). Not a function of
 * the matter: the list is the same wherever it is asked.
 */
export function catalogForSuggestions(
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
  raw: typeof RAW_CATALOG = RAW_CATALOG,
): CatalogEntryForPrompt[] {
  const entries: CatalogEntryForPrompt[] = [];
  for (const rule of catalog) {
    if (!isUsable(rule)) continue;
    const words = raw.reglas.find((entry) => entry.codigo === rule.code);
    if (words) entries.push({ code: rule.code, name: words.nombre, appliesWhen: words.aplica });
  }
  return entries;
}

/** Whether the button can be offered: the route the chat would use here, for an owner or editor of a retainer matter. */
export const getSuggestionRoute = getExtractionRoute;

export async function getRuleSuggestions(
  db: Db,
  actor: Actor,
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
  raw: typeof RAW_CATALOG = RAW_CATALOG,
): Promise<ServiceResult<RuleSuggestions>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    if (!access.data.isRetainer) return ok({ retainer: false, can_write: false, suggestions: [], versions: [], questions: [], people: [] });
    const suggestions = await loadSuggestions(db, access.data, catalog);
    if (!suggestions.ok) return suggestions;
    // A person in training reads the results but neither requests nor decides.
    const canWrite =
      access.data.canWrite && !(await isTraineeIn(db, actor.userId, access.data.organizationId, access.data.projectId));
    const versions = canWrite ? await sourceVersions(db, access.data.projectId) : ok([]);
    if (!versions.ok) return versions;
    const people: ProfilePerson[] = await namePeople(
      db,
      suggestions.data.flatMap((suggestion) => [suggestion.created_by, suggestion.decided_by]),
    );
    const questions = canWrite ? await loadOpenQuestions(db, access.data, suggestions.data, catalog, raw) : ok([]);
    if (!questions.ok) return questions;
    return ok({ retainer: true, can_write: canWrite, suggestions: suggestions.data, versions: versions.data, questions: questions.data, people });
  } catch (error) {
    return internalFailure(error);
  }
}

export async function suggestRules(
  db: Db,
  actor: Actor & { versionId: unknown },
  dependencies: Dependencies = {},
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
  raw: typeof RAW_CATALOG = RAW_CATALOG,
): Promise<ServiceResult<RuleSuggestionRun>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    const trainee = await refuseTrainee(db, actor.userId, access.data.organizationId, access.data.projectId);
    if (trainee) return trainee;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    const versionId = actor.versionId;
    if (typeof versionId !== "string" || !isUuid(versionId)) return failure("not_found", NOT_FOUND);

    const version = await findLiveVersion(db, access.data.projectId, versionId);
    if (!version.ok) return version;
    if (!version.data)
      return failure("validation", "The version is not a document of this matter.", VERSION_NOT_IN_MATTER_CODE);

    // Only the text that is ready. Nothing here reads a file, runs OCR or splits it.
    const state = await loadVersionTextState(db, version.data.document_id, versionId);
    const text = state?.text ?? null;
    if (text === null || text.trim() === "")
      return failure("unprocessable", "The text of that version is not ready, so it cannot be read.", SOURCE_TEXT_UNAVAILABLE_CODE);
    // Never cut: a document read in part would look read in full. Refused before any route or record.
    if (text.length > MAX_EXTRACT_TEXT_CHARS)
      return failure(
        "unprocessable",
        `The text of that version is longer than ${MAX_EXTRACT_TEXT_CHARS} characters.`,
        SUGGEST_TEXT_TOO_LARGE_CODE,
      );

    const { data: existing, error: existingError } = await db
      .from("obligation_rule_suggestions")
      .select("rule_code, rule_version, version_id")
      .eq("matter_id", access.data.matterId)
      .limit(MAX_SUGGESTIONS_PER_MATTER);
    if (existingError) return internalFailure(existingError);
    const known = (existing ?? []) as unknown as { rule_code: string; rule_version: number; version_id: string }[];
    if (known.length >= MAX_SUGGESTIONS_PER_MATTER)
      return failure("conflict", "The matter holds as many suggestions as it can.", SUGGESTION_LIMIT_CODE);
    const seen = new Set(known.filter((row) => row.version_id === versionId).map((row) => `${row.rule_code}@${row.rule_version}`));

    // The route first, before anything is sent: no key, no call, no other route, no record.
    const routed = await resolveExtractionRoute(db, { userId: actor.userId, orgId: access.data.organizationId });
    if (!routed.ok) return routed;
    const { resolved } = routed.data;

    // Which rules are on decides what is DISCARDED afterwards, never what is sent.
    const states = await loadRuleStates(db, access.data.matterId);
    if (!states.ok) return states;

    // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
    await recordChatEgressOrThrow(db, {
      userId: actor.userId,
      orgId: access.data.organizationId,
      chatId: null,
      projectId: access.data.projectId,
      surface: SUGGEST_SURFACE,
      resolved,
      extra: { matter_id: access.data.matterId, version_id: versionId },
    });

    let answer: string;
    try {
      answer = await (dependencies.completeText ?? completeText)({
        model: resolved.route.model,
        systemPrompt: buildSuggestSystemPrompt(catalogForSuggestions(catalog, raw)),
        user: buildExtractionPrompt(text, crypto.randomBytes(12).toString("hex")),
        maxTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        apiKeys: resolved.apiKeys,
        abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (error) {
      // Never the provider's words or request: they can carry the document.
      reportError(new AppError("rule_suggestions.call_failed", "[radar] rule suggestion call failed"), {
        tags: { operation: "radar.suggest_rules", provider: resolved.route.provider },
      });
      if (error instanceof UserFacingError)
        return failure("unprocessable", "The AI provider did not accept the request.", SUGGEST_PROVIDER_REFUSED_CODE);
      // 422 and not 503: the gateway rewrites every 5xx, and this code is the client's to read.
      return failure("unprocessable", "The AI provider could not answer.", SUGGEST_PROVIDER_FAILED_CODE);
    }

    const array = readModelArray(answer);
    if (!array)
      return failure("unprocessable", "The model did not answer with the expected list.", SUGGEST_OUTPUT_INVALID_CODE);

    const plan = planSuggestions(array);
    const textSha = sha256(text);
    const out: RuleSuggestionRun = {
      suggested: 0,
      discarded_unknown_rule: 0,
      discarded_already_active: 0,
      discarded_quote_not_found: 0,
      discarded_duplicate: 0,
      discarded_invalid: plan.invalid,
      suggestion_ids: [],
    };
    for (const item of plan.items) {
      // 1. A rule of the catalog, verified (and sound) in this release.
      const chosen = catalog.filter((entry) => entry.code === item.ruleCode && isUsable(entry)).sort((a, b) => b.version - a.version)[0];
      if (!chosen) {
        out.discarded_unknown_rule += 1;
        continue;
      }
      // 2. Not already on in this matter.
      if (states.data.get(ruleKey(chosen))?.active) {
        out.discarded_already_active += 1;
        continue;
      }
      // 3. The quote is in the version's text, as the manual path finds it.
      const located = locateQuote(text, item.quote);
      if (!located) {
        out.discarded_quote_not_found += 1;
        continue;
      }
      if ([...located.excerpt].length > 500) {
        out.discarded_invalid += 1;
        continue;
      }
      // 4 and 5. One suggestion per rule and version of the document, decided or not.
      const key = ruleKey(chosen);
      if (seen.has(key)) {
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
          document_id: version.data.document_id,
          version_id: versionId,
          text_sha256: textSha,
          start_char: located.start,
          end_char: located.end,
          // The passage as the document words it, never as the model wrote it.
          quote: located.excerpt,
          page: item.page,
          rule_code: chosen.code,
          rule_version: chosen.version,
          ai_reason: item.reason,
          created_by: actor.userId,
        })
        .select("id")
        .single();
      if (error && isRecord(error) && error.code === "23505") {
        seen.add(key);
        out.discarded_duplicate += 1;
        continue;
      }
      if (error || !saved) return internalFailure(error ?? new Error("suggestion insert returned no row"));
      seen.add(key);
      out.suggested += 1;
      out.suggestion_ids.push((saved as unknown as { id: string }).id);
    }
    return ok(out);
  } catch (error) {
    return internalFailure(error);
  }
}

type Decision = "accepted" | "discarded";

async function decide(
  db: Db,
  actor: Actor & { suggestionId: unknown; body: unknown },
  action: Decision,
  catalog: readonly ObligationRuleDef[],
): Promise<ServiceResult<RuleSuggestion>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    const trainee = await refuseTrainee(db, actor.userId, access.data.organizationId, access.data.projectId);
    if (trainee) return trainee;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    if (typeof actor.suggestionId !== "string" || !isUuid(actor.suggestionId)) return failure("not_found", NOT_FOUND);

    let reason: string | null = null;
    if (actor.body != null) {
      if (!isRecord(actor.body)) return failure("validation", "A request body must be an object.", INVALID_SUGGESTION_CODE);
      if (actor.body.reason != null && actor.body.reason !== "") {
        reason = cleanText(actor.body.reason, SUGGESTION_DECISION_REASON_MAX);
        if (!reason)
          return failure("validation", `reason must be 1 to ${SUGGESTION_DECISION_REASON_MAX} characters.`, INVALID_SUGGESTION_CODE);
      }
    }

    const found = await loadSuggestions(db, access.data, catalog, actor.suggestionId);
    if (!found.ok) return found;
    const suggestion = found.data[0];
    if (!suggestion) return failure("not_found", NOT_FOUND);

    if (suggestion.status === "discarded" || (action === "accepted" && suggestion.status !== "pending"))
      return failure("conflict", "That suggestion was already decided.", SUGGESTION_ALREADY_DECIDED_CODE);
    // What is accepted is what the lawyer can still read in the document, for a rule still in the catalog.
    if (action === "accepted" && suggestion.stale_reason)
      return failure("conflict", "The cited text or the rule changed; ask for suggestions again.", SUGGESTION_OBSOLETE_CODE);

    const { error } = await db.from("obligation_rule_suggestion_events").insert({
      suggestion_id: suggestion.id,
      matter_id: access.data.matterId,
      actor_user_id: actor.userId,
      action,
      reason,
    });
    if (error && isRecord(error) && error.code === "23514")
      return failure("conflict", "That suggestion was already decided.", SUGGESTION_ALREADY_DECIDED_CODE);
    if (error) return internalFailure(error);

    const after = await loadSuggestions(db, access.data, catalog, suggestion.id);
    if (!after.ok) return after;
    return after.data[0] ? ok(after.data[0]) : failure("not_found", NOT_FOUND);
  } catch (error) {
    return internalFailure(error);
  }
}

export const acceptRuleSuggestion = (
  db: Db,
  actor: Actor & { suggestionId: unknown; body: unknown },
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
) => decide(db, actor, "accepted", catalog);
export const discardRuleSuggestion = (
  db: Db,
  actor: Actor & { suggestionId: unknown; body: unknown },
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
) => decide(db, actor, "discarded", catalog);

/**
 * Several decisions at once. There is no bulk write: each id goes through the
 * very same `decide` as the single routes (permission, retainer, obsolescence,
 * conflict, its own event), one after the other, so a partial result is normal.
 * Permission is checked once first, so a reader or a stranger gets the
 * whole-request answer (403/404) and not a list of refusals. Accepting in bulk
 * only records the decisions: no rule is turned on.
 */
export async function decideRuleSuggestions(
  db: Db,
  actor: Actor & { body: unknown },
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<RuleSuggestionBatchResult>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    const trainee = await refuseTrainee(db, actor.userId, access.data.organizationId, access.data.projectId);
    if (trainee) return trainee;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);

    const body = actor.body;
    if (!isRecord(body) || (body.action !== "accept" && body.action !== "discard"))
      return failure("validation", "action must be accept or discard.", INVALID_SUGGESTION_CODE);
    const ids = body.suggestionIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string"))
      return failure("validation", "suggestionIds must be a list of ids.", INVALID_SUGGESTION_CODE);
    if (ids.length > SUGGESTION_BATCH_MAX)
      return failure("validation", `At most ${SUGGESTION_BATCH_MAX} suggestions per request.`, INVALID_SUGGESTION_CODE);
    if (body.reason != null && body.reason !== "" && !cleanText(body.reason, SUGGESTION_DECISION_REASON_MAX))
      return failure("validation", `reason must be 1 to ${SUGGESTION_DECISION_REASON_MAX} characters.`, INVALID_SUGGESTION_CODE);

    const action: Decision = body.action === "accept" ? "accepted" : "discarded";
    const results: RuleSuggestionBatchResult["results"] = [];
    for (const suggestionId of [...new Set(ids as string[])]) {
      const one = await decide(db, { ...actor, suggestionId, body: { reason: body.reason } }, action, catalog);
      if (one.ok) results.push({ suggestion_id: suggestionId, outcome: "ok" });
      else if (one.kind === "conflict" || one.kind === "not_found" || one.kind === "forbidden")
        results.push({ suggestion_id: suggestionId, outcome: one.kind, ...(one.code ? { code: one.code } : {}) });
      else results.push({ suggestion_id: suggestionId, outcome: "error" });
    }
    return ok({ results });
  } catch (error) {
    return internalFailure(error);
  }
}
