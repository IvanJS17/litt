import React from "react";
import { useTranslations } from "use-intl";
import {
  FirmCriteriaConsultedUI,
  type FirmCriteriaConsultedLabels,
} from "@mike/ui";
import type { WordAssistantEvent } from "../../types";
import { isWordFirmCriteriaEvent } from "../../lib/wordChatEvents";

/**
 * Under an answer in Word: the firm's criteria the assistant consulted,
 * exactly as the server stored them, with author and date (docs/training.md,
 * "One mold of criterion"). The catalog is the web app's
 * (`training.firmCriteria.consulted`). Nothing for a turn that consulted none.
 */
export function FirmCriteriaPanel({
  events,
}: {
  events: readonly WordAssistantEvent[];
}): React.ReactElement | null {
  const t = useTranslations("training.firmCriteria.consulted");
  const labels = React.useMemo<FirmCriteriaConsultedLabels>(
    () => ({
      summary: (count) => t("summary", { count }),
      note: t("note"),
      empty: t("empty"),
      failed: t("failed"),
      more: t("more"),
      kind: (kind) =>
        kind === "voto_particular" ? t("kind.voto_particular") : t("kind.criterio"),
      byline: (criterion) =>
        criterion.author_name
          ? t("byline", {
              author: criterion.author_name,
              date: new Date(criterion.created_at),
            })
          : t("bylineDeleted", { date: new Date(criterion.created_at) }),
      // The stored practice area is normalized (lower case); Word has no
      // list of the options the web app capitalizes it from.
      practice: (practice) => t("practice", { practice }),
      rule: () => t("rule"),
    }),
    [t],
  );
  const consulted = events.filter(isWordFirmCriteriaEvent);
  if (consulted.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {consulted.map((event) => (
        <FirmCriteriaConsultedUI
          key={event.call_id}
          consultation={event}
          labels={labels}
        />
      ))}
    </div>
  );
}
