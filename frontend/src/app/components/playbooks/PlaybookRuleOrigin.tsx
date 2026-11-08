"use client";

// LiTT: where a drafted rule comes from, as plain text. The origin and the
// legal references belong to the server, so nothing here is editable. The
// rule's own words (quotes, answers, references) are the playbook's content
// and are shown as written, never translated.

import { useTranslations } from "next-intl";
import type { PlaybookRule } from "@/app/lib/mikeApi";
import type { PlaybookProvenance } from "./usePlaybookProvenance";

const QUOTE_CLASS =
  "mt-1 border-l-2 border-gray-200 pl-2 text-gray-600 [overflow-wrap:anywhere] whitespace-pre-line";

function questionNumber(id: string) {
  return id.replace(/^q/, "");
}

export function PlaybookRuleOrigin({
  rule,
  provenance,
}: {
  rule: PlaybookRule;
  provenance: PlaybookProvenance;
}) {
  const t = useTranslations("playbooks.origin");
  const { origin } = rule;
  const legalRefs = rule.legalRefs ?? [];
  if (!origin && legalRefs.length === 0) return null;
  const questions = origin?.kind === "answer" ? (origin.questionIds ?? []) : [];
  const sourceName = origin?.sourceId ? provenance.sourceNames[origin.sourceId] : undefined;

  return (
    <div className="space-y-2 text-xs text-gray-500">
      {origin && (
        <div>
          <p className="[overflow-wrap:anywhere]">
            {origin.kind === "answer"
              ? t("answer", {
                  count: questions.length,
                  questions: questions.map(questionNumber).join(", "),
                })
              : origin.kind === "clause"
                ? sourceName
                  ? t("clause", { name: sourceName })
                  : t("clauseUnnamed")
                : t("aiGeneral")}
            {origin.unbacked && (
              <>
                {" · "}
                <strong className="font-medium text-gray-800">{t("unbacked")}</strong>
              </>
            )}
          </p>
          {questions.map((id) =>
            provenance.answers[id] ? (
              <figure key={id} className="mt-1">
                <figcaption>{t("answerLabel", { number: questionNumber(id) })}</figcaption>
                <blockquote className={QUOTE_CLASS}>{provenance.answers[id]}</blockquote>
              </figure>
            ) : null,
          )}
          {origin.kind === "clause" && origin.quote && (
            <figure className="mt-1">
              <figcaption>{t("quoteLabel")}</figcaption>
              <blockquote className={QUOTE_CLASS}>{origin.quote}</blockquote>
            </figure>
          )}
          {origin.note && <p className="mt-1 [overflow-wrap:anywhere]">{origin.note}</p>}
        </div>
      )}
      {legalRefs.length > 0 && (
        <div>
          <p>{t("legalRefs")}</p>
          <ul className="mt-1 space-y-1">
            {legalRefs.map((ref, index) => (
              <li key={`${index}:${ref.text}`} className="[overflow-wrap:anywhere]">
                {ref.text}
                {" · "}
                {ref.verified ? (
                  t("verified")
                ) : (
                  <strong className="font-medium text-gray-800">{t("unverified")}</strong>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
