/**
 * The closed yes/no questions of "Sugerir reglas" (S8c, docs/obligation-rules.md,
 * "Rule suggestions: all documents and questions"). The AI may ask one about a
 * catalog rule whose applicability depends on a fact the documents do not
 * state; the lawyer answers here.
 *
 * THE ANSWER NEVER LEAVES LiTT. This file imports no model, no egress record and
 * no route: a "yes" saves a suggestion whose evidence is the lawyer's own answer
 * (no quote, no document), a "no" only records itself. Both are insert-only, and
 * neither turns a rule on: accepting the suggestion opens the existing turn-on
 * form, where the lawyer confirms a date.
 */

import type { RuleQuestion, RuleQuestionAnswerResult, RuleSuggestion } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { isRecord } from "../client-profile/client-profile.service";
import { authorizeMatterMember } from "../matters/matters.service";
import { OBLIGATION_RULES, RAW_CATALOG } from "./radar.rules.catalog";
import { findRule, isUsable, type ObligationRuleDef } from "./radar.rules";
import { NOT_A_RETAINER_CODE } from "./radar.shared";
import { loadSuggestions } from "./radar.suggest.load";
import { INVALID_ANSWER_CODE, QUESTION_ALREADY_ANSWERED_CODE } from "./radar.suggest.all.shared";
import { SUGGESTION_OBSOLETE_CODE } from "./radar.suggest.shared";
import { refuseTrainee } from "./radar.trainee";

const NOT_FOUND = "Not found";
export const MAX_QUESTIONS_PER_MATTER = 500;

export type QuestionRow = {
  id: string;
  matter_id: string;
  rule_code: string;
  rule_version: number;
  created_at: string;
};
export const QUESTION_COLUMNS = "id, matter_id, rule_code, rule_version, created_at";

type Access = { matterId: string; projectId: string };
type Actor = { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown };

/**
 * The questions still waiting for the lawyer: not answered, about a rule that is
 * still in the catalog and verified, and for which no document has suggested
 * the rule meanwhile (a question about a rule a quote already supports is moot).
 */
export async function loadOpenQuestions(
  db: Db,
  access: Access,
  suggestions: readonly RuleSuggestion[],
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
  raw: typeof RAW_CATALOG = RAW_CATALOG,
): Promise<ServiceResult<RuleQuestion[]>> {
  const { data, error } = await db
    .from("obligation_rule_questions")
    .select(QUESTION_COLUMNS)
    .eq("matter_id", access.matterId)
    .order("created_at", { ascending: false })
    .limit(MAX_QUESTIONS_PER_MATTER);
  if (error) return internalFailure(error);
  const rows = (data ?? []) as unknown as QuestionRow[];
  if (rows.length === 0) return ok([]);
  const { data: answerData, error: answerError } = await db
    .from("obligation_rule_question_answers")
    .select("question_id")
    .eq("matter_id", access.matterId)
    .limit(MAX_QUESTIONS_PER_MATTER);
  if (answerError) return internalFailure(answerError);
  const answered = new Set(((answerData ?? []) as unknown as { question_id: string }[]).map((row) => row.question_id));
  const supported = new Set(
    suggestions.filter((one) => one.evidence === "document" && one.effective_status !== "discarded").map((one) => one.rule_key),
  );
  const open: RuleQuestion[] = [];
  for (const row of rows) {
    const key = `${row.rule_code}@${row.rule_version}`;
    const rule = findRule(catalog, key);
    const words = raw.reglas.find((entry) => entry.codigo === row.rule_code);
    if (answered.has(row.id) || supported.has(key) || !rule || !isUsable(rule) || !words) continue;
    open.push({
      id: row.id,
      matter_id: row.matter_id,
      rule_key: key,
      rule_code: row.rule_code,
      rule_version: row.rule_version,
      applies_when: words.aplica,
      created_at: row.created_at,
    });
  }
  return ok(open);
}

/**
 * The lawyer answers a question. "yes" saves ONE pending suggestion for the rule
 * (evidence `lawyer_answer`) and then the answer; "no" saves the answer only.
 * The suggestion goes first so that a failure in between leaves a harmless
 * pending suggestion and an open question, and the same answer again finishes it.
 */
export async function answerRuleQuestion(
  db: Db,
  actor: Actor & { questionId: unknown; body: unknown },
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<RuleQuestionAnswerResult>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    const trainee = await refuseTrainee(db, actor.userId, access.data.organizationId, access.data.projectId);
    if (trainee) return trainee;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    if (typeof actor.questionId !== "string" || !isUuid(actor.questionId)) return failure("not_found", NOT_FOUND);
    const answer = isRecord(actor.body) ? actor.body.answer : null;
    if (answer !== "yes" && answer !== "no") return failure("validation", "answer must be yes or no.", INVALID_ANSWER_CODE);

    const { data, error } = await db
      .from("obligation_rule_questions")
      .select(QUESTION_COLUMNS)
      .eq("id", actor.questionId)
      .eq("matter_id", access.data.matterId)
      .maybeSingle();
    if (error) return internalFailure(error);
    const question = data as unknown as QuestionRow | null;
    if (!question) return failure("not_found", NOT_FOUND);

    const { data: done, error: doneError } = await db
      .from("obligation_rule_question_answers")
      .select("id")
      .eq("question_id", question.id)
      .limit(1);
    if (doneError) return internalFailure(doneError);
    if ((done ?? []).length > 0) return failure("conflict", "That question was already answered.", QUESTION_ALREADY_ANSWERED_CODE);

    let suggestionId: string | null = null;
    if (answer === "yes") {
      const rule = findRule(catalog, `${question.rule_code}@${question.rule_version}`);
      if (!rule || !isUsable(rule))
        return failure("conflict", "The rule changed; ask for suggestions again.", SUGGESTION_OBSOLETE_CODE);
      const saved = await db
        .from("obligation_rule_suggestions")
        .insert({
          flow: "lawyer_answer",
          org_id: access.data.organizationId,
          matter_id: access.data.matterId,
          project_id: access.data.projectId,
          question_id: question.id,
          rule_code: question.rule_code,
          rule_version: question.rule_version,
          // No model words: the evidence is the lawyer's answer (the creator is who answered).
          created_by: actor.userId,
        })
        .select("id")
        .single();
      if (saved.error && isRecord(saved.error) && saved.error.code === "23505") {
        // A first try that stopped half way: the suggestion exists, the answer is what is missing.
        const again = await db.from("obligation_rule_suggestions").select("id").eq("question_id", question.id).maybeSingle();
        if (again.error || !again.data) return internalFailure(again.error ?? new Error("suggestion not found after conflict"));
        suggestionId = (again.data as unknown as { id: string }).id;
      } else if (saved.error || !saved.data) {
        return internalFailure(saved.error ?? new Error("suggestion insert returned no row"));
      } else suggestionId = (saved.data as unknown as { id: string }).id;
    }

    const written = await db.from("obligation_rule_question_answers").insert({
      question_id: question.id,
      matter_id: access.data.matterId,
      actor_user_id: actor.userId,
      answer,
    });
    if (written.error && isRecord(written.error) && written.error.code === "23505")
      return failure("conflict", "That question was already answered.", QUESTION_ALREADY_ANSWERED_CODE);
    if (written.error) return internalFailure(written.error);

    let suggestion: RuleSuggestion | null = null;
    if (suggestionId) {
      const loaded = await loadSuggestions(db, access.data, catalog, suggestionId);
      if (!loaded.ok) return loaded;
      suggestion = loaded.data[0] ?? null;
    }
    return ok({ question_id: question.id, answer, suggestion });
  } catch (error) {
    return internalFailure(error);
  }
}
