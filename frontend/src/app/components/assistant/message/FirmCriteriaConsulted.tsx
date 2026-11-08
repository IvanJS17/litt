"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { FirmCriteriaConsultedUI, type FirmCriteriaConsultedLabels } from "@mike/ui";
import type { AssistantEvent } from "../../shared/types";
import { practiceOptionLabel } from "../../training/trainingShared";

// The panel under an answer with the firm's criteria the assistant consulted
// (docs/training.md, "One mold of criterion"). The server emits the criteria
// as stored, with author and date, so the attribution is not the model's.

type FirmCriteriaEvent = Extract<AssistantEvent, { type: "firm_criteria" }>;

export function FirmCriteriaConsulted({ events }: { events: readonly AssistantEvent[] }) {
  const t = useTranslations("training.firmCriteria.consulted");
  const labels = useMemo<FirmCriteriaConsultedLabels>(
    () => ({
      summary: (count) => t("summary", { count }),
      note: t("note"),
      empty: t("empty"),
      failed: t("failed"),
      more: t("more"),
      kind: (kind) => (kind === "voto_particular" ? t("kind.voto_particular") : t("kind.criterio")),
      byline: (criterion) =>
        criterion.author_name
          ? t("byline", { author: criterion.author_name, date: new Date(criterion.created_at) })
          : t("bylineDeleted", { date: new Date(criterion.created_at) }),
      practice: (practice) => t("practice", { practice: practiceOptionLabel(practice) }),
      rule: () => t("rule"),
    }),
    [t],
  );
  const consulted = events.filter((event): event is FirmCriteriaEvent => event.type === "firm_criteria");
  if (consulted.length === 0) return null;
  return (
    <div className="mt-3 flex min-w-0 flex-col gap-2">
      {consulted.map((event) => (
        <FirmCriteriaConsultedUI key={event.call_id} consultation={event} labels={labels} />
      ))}
    </div>
  );
}
