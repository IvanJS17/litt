import React from "react";
import { PillButtonUI as PillButton } from "@mike/ui";
import { useTranslations } from "use-intl";

/**
 * What the pane shows when a render error escapes every component. This only
 * has to leave the user a way back that does not involve restarting Word.
 */
export function PaneErrorFallback({
  resetError,
}: {
  resetError: () => void;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="text-sm font-medium text-foreground">{t("word.somethingWentWrong")}</p>
      <p className="text-xs text-muted-foreground">
        {t("word.theAddInHitAnUnexpected")}
      </p>
      <PillButton type="button" tone="black" size="normal" onClick={resetError}>
        {t("word.tryAgain")}
      </PillButton>
    </div>
  );
}
