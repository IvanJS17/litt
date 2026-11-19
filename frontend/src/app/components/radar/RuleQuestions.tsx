"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type { ObligationRule, RuleQuestion } from "@mike/contracts";
import { useObligationWords } from "./obligationText";

/**
 * The closed yes/no questions the AI left for the lawyer (S8c). The AI only said
 * WHICH rule needs one: the sentence is built here from the catalog's own "applies
 * when" text, never from model words. The answer goes to LiTT, never to an AI. A
 * "yes" makes a suggestion that says "according to the answer of {name}"; a "no"
 * is only recorded and is never shown as "the rule does not apply".
 */
export function RuleQuestions({
  questions,
  rules,
  busy,
  answering,
  onAnswer,
}: {
  questions: readonly RuleQuestion[];
  rules: readonly ObligationRule[];
  busy: boolean;
  /** The question being saved, if any. */
  answering: string | null;
  onAnswer: (question: RuleQuestion, answer: "yes" | "no") => void;
}) {
  const t = useTranslations();
  const id = useId();
  const { ruleName } = useObligationWords();
  const wordsOf = useLooseWords();
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <div className="space-y-1">
        <h4 id={`${id}-title`} className="text-sm font-medium text-gray-900">
          {t("radar.rules.suggest.questions.title")}
        </h4>
        <p className="text-xs text-gray-600">{t("radar.rules.suggest.questions.description")}</p>
      </div>
      <ul className="space-y-3">
        {questions.map((question) => {
          const rule = rules.find((one) => one.key === question.rule_key) ?? null;
          const name = rule ? ruleName(rule.name_key, rule.code) : question.rule_code;
          const condition = rule ? wordsOf(rule.applies_when_key, question.applies_when) : question.applies_when;
          const saving = answering === question.id;
          return (
            <li key={question.id}>
              <article aria-labelledby={`${id}-${question.id}`} className="min-w-0 space-y-2 rounded-xl bg-app-surface/60 p-4">
                <p className="text-xs text-gray-500">{t("radar.rules.suggest.questions.ruleLabel", { name })}</p>
                <p id={`${id}-${question.id}`} className="break-words text-sm text-gray-900">
                  {t("radar.rules.suggest.questions.text", { condition })}
                </p>
                <div role="group" aria-label={t("radar.rules.suggest.questions.group", { name })} className="flex flex-wrap items-center gap-2">
                  {(["yes", "no"] as const).map((answer) => (
                    <PillButtonUI
                      key={answer}
                      type="button"
                      tone={answer === "yes" ? "black" : "white"}
                      size="sm"
                      className="pointer-coarse:min-h-11"
                      disabled={busy || answering !== null}
                      aria-busy={saving}
                      onClick={() => onAnswer(question, answer)}
                    >
                      {saving ? t("radar.rules.suggest.questions.saving") : t(`radar.rules.suggest.questions.${answer}`)}
                    </PillButtonUI>
                  ))}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A catalog sentence by its message key (named at run time), or the server's own words. */
function useLooseWords() {
  const t = useTranslations();
  const loose = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  return (key: string, fallback: string) => (loose.has(key) ? loose(key) : fallback);
}
