import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// LiTT training (docs/training.md, "One mold of criterion"): the panel under
// an answer that lists the firm's criteria the assistant consulted, exactly
// as stored, with author and date. The attribution is the server's, not the
// model's. Rendered by the web chats and the Word add-in; the host passes
// every text, so the panel carries no language of its own. A criterion is a
// position a person of the firm wrote: the panel says so and never presents
// it as law. Meaning is carried by text, never by colour alone.

/** One criterion as the server emitted it (FirmCriterionSnapshot). */
export interface FirmCriterionView {
  id: string;
  kind: "criterio" | "voto_particular";
  practice: string | null;
  topic: string;
  position: string;
  author_name: string | null;
  playbook_id: string | null;
  rule_id: string | null;
  created_at: string;
}

/** The consultation as the server emitted it (FirmCriteriaEvent). */
export interface FirmCriteriaConsultation {
  criteria: readonly FirmCriterionView[];
  truncated: boolean;
  error?: string;
}

export interface FirmCriteriaConsultedLabels {
  /** The panel's title, given the number of criteria. */
  summary: (count: number) => string;
  /** What the panel is: positions of people of the firm, not law. */
  note: string;
  /** Said when the firm had written nothing on the subject. */
  empty: string;
  /** Said when the consultation failed. */
  failed: string;
  /** Said when more criteria matched than the turn carries. */
  more: string;
  /** The kind of a criterion, as a label. */
  kind: (kind: FirmCriterionView["kind"]) => string;
  /** The line under a criterion: who wrote it and when. */
  byline: (criterion: FirmCriterionView) => string;
  /** The practice area, when the criterion has one. */
  practice: (practice: string) => string;
  /** A dissenting opinion names the rule it disagrees with. */
  rule: (ruleId: string) => string;
}

export function FirmCriteriaConsultedUI({
  consultation,
  labels,
  className,
}: {
  consultation: FirmCriteriaConsultation;
  labels: FirmCriteriaConsultedLabels;
  className?: string;
}) {
  const { criteria } = consultation;
  return (
    <details
      data-testid="firm-criteria-consulted"
      className={twMerge(
        clsx(
          "group min-w-0 rounded-lg border border-gray-200 bg-surface-sheet px-4 py-3 text-left",
          className,
        ),
      )}
    >
      <summary className="cursor-pointer rounded text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {labels.summary(criteria.length)}
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-3">
        <p className="text-xs text-gray-500">{labels.note}</p>
        {consultation.error ? (
          <p role="status" className="text-sm text-gray-700">
            {labels.failed}
          </p>
        ) : criteria.length === 0 ? (
          <p role="status" className="text-sm text-gray-700">
            {labels.empty}
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {criteria.map((criterion) => (
              <li
                key={criterion.id}
                className="min-w-0 border-t border-gray-200 pt-3 first:border-t-0 first:pt-0"
              >
                <h4 className="break-words text-sm font-medium text-gray-800">
                  {criterion.topic}
                </h4>
                <p className="mt-0.5 break-words text-xs text-gray-600">
                  {labels.kind(criterion.kind)}
                  {criterion.practice ? ` · ${labels.practice(criterion.practice)}` : ""}
                  {criterion.rule_id ? ` · ${labels.rule(criterion.rule_id)}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
                  {criterion.position}
                </p>
                <p className="mt-1 break-words text-xs text-gray-600">
                  {labels.byline(criterion)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {consultation.truncated && !consultation.error && (
          <p className="text-xs text-gray-500">{labels.more}</p>
        )}
      </div>
    </details>
  );
}
