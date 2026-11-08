"use client";

// The header's New playbook menu. LiTT: the workspace's models come first,
// each a starting point; then "With questions", import and scratch.

import { useTranslations } from "next-intl";
import { BookCopy, ListChecks, PenLine, Plus, Upload } from "lucide-react";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  HeaderButtonUI,
} from "@mike/ui";
import type { Playbook } from "@/app/lib/mikeApi";

/** Ready playbooks marked as models, most recently updated first. */
export function playbookModels(playbooks: Playbook[]): Playbook[] {
  return playbooks
    .filter((playbook) => playbook.isModel && playbook.status === "ready")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function NewPlaybookMenu({
  disabled,
  models,
  onModel,
  onQuestions,
  onImport,
  onBlank,
}: {
  disabled: boolean;
  models: Playbook[];
  onModel: (playbook: Playbook) => void;
  onQuestions: () => void;
  onImport: () => void;
  onBlank: () => void;
}) {
  const t = useTranslations("playbooks.newMenu");
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <HeaderButtonUI
          iconOnly
          disabled={disabled}
          title={t("trigger")}
          aria-label={t("trigger")}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </HeaderButtonUI>
      </DropdownTrigger>
      <DropdownContent align="end" className="max-w-80">
        {models.length > 0 && (
          <>
            <DropdownLabel>{t("models")}</DropdownLabel>
            {models.map((model) => (
              <DropdownItem key={model.id} onSelect={() => onModel(model)}>
                <BookCopy aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{model.name}</span>
              </DropdownItem>
            ))}
            <DropdownSeparator />
          </>
        )}
        <DropdownItem onSelect={onQuestions}>
          <ListChecks aria-hidden="true" className="h-4 w-4" />
          {t("withQuestions")}
        </DropdownItem>
        <DropdownItem onSelect={onImport}>
          <Upload aria-hidden="true" className="h-4 w-4" />
          {t("import")}
        </DropdownItem>
        <DropdownItem onSelect={onBlank}>
          <PenLine aria-hidden="true" className="h-4 w-4" />
          {t("blank")}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
