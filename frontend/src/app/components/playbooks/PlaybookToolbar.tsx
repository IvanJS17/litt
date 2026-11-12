"use client";

import { Plus, Upload } from "lucide-react";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import { TabPillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

// A playbook's details are edited from a dialog, as in other features.
export const PLAYBOOK_VIEWS = ["rules", "references", "runs", "corrections"] as const;
export type PlaybookView = (typeof PLAYBOOK_VIEWS)[number];


export function PlaybookToolbar({
  disabled,
  canEdit,
  view,
  onViewChange,
  onAddRule,
  onUpload,
  onNewRun,
  runDisabled = false,
  correctionsLabel,
}: {
  disabled: boolean;
  canEdit: boolean;
  view: PlaybookView;
  onViewChange: (view: PlaybookView) => void;
  onAddRule: () => void;
  /** Adds a reference document; shown on References. */
  onUpload: () => void;
  /** Opens the new-run form; shown on Runs. */
  onNewRun: () => void;
  /** LiTT: a draft cannot be run until it is marked ready. */
  runDisabled?: boolean;
  /**
   * LiTT training: the label of the Corrections view, offered only to an
   * editor who supervises someone; absent, there is no such view.
   */
  correctionsLabel?: string;
}) {
  const t = useTranslations();
  const views: { id: Exclude<PlaybookView, "corrections">; label: string }[] = [
    { id: "rules", label: t("playbooks.rules") },
    { id: "references", label: t("playbooks.references") },
    { id: "runs", label: t("playbooks.runs") },
  ];
  return (
    <nav aria-label={t("playbooks.playbookToolbar")} className="shrink-0">
      <TableToolbar
        leading={
          <div className="flex w-full flex-wrap items-center justify-between gap-1.5">
            <div
              role="group"
              aria-label={t("playbooks.playbookView")}
              className="flex flex-wrap items-center gap-1.5"
            >
              {views.map((entry) => (
                <TabPillButtonUI
                  key={entry.id}
                  active={view === entry.id}
                  onClick={() => onViewChange(entry.id)}
                >
                  {entry.label}
                </TabPillButtonUI>
              ))}
              {correctionsLabel && (
                <TabPillButtonUI
                  active={view === "corrections"}
                  onClick={() => onViewChange("corrections")}
                >
                  {correctionsLabel}
                </TabPillButtonUI>
              )}
            </div>
            {view === "rules" && (
              <TabPillButtonUI
                disabled={disabled || !canEdit}
                onClick={onAddRule}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                {t("playbooks.newRule")}
              </TabPillButtonUI>
            )}
            {view === "runs" && (
              <TabPillButtonUI disabled={disabled || runDisabled} onClick={onNewRun}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                {t("playbooks.newRun")}
              </TabPillButtonUI>
            )}
            {view === "references" && (
              <TabPillButtonUI
                disabled={disabled || !canEdit}
                onClick={onUpload}
              >
                <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                {t("playbooks.upload")}
              </TabPillButtonUI>
            )}
          </div>
        }
      />
    </nav>
  );
}
