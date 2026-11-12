import { useTranslations } from "use-intl";
import React, { type ReactNode } from "react";
import { EditCardsSectionUI } from "@mike/ui";
import { EDIT_SECTION_SURFACE } from "./messageStyles";

interface EditCardsSectionProps {
  summary: string;
  actions?: ReactNode;
  actionsLabel?: string;
  children: ReactNode;
}

export function EditCardsSection({
  summary,
  actions,
  actionsLabel,
  children,
}: EditCardsSectionProps): React.ReactElement {
  const t = useTranslations();
  return (
    <EditCardsSectionUI
      summary={summary}
      actions={actions}
      actionsLabel={actionsLabel ?? t("word.trackedChangeActions")}
      className={`${EDIT_SECTION_SURFACE} overflow-hidden`}
    >
      {children}
    </EditCardsSectionUI>
  );
}
