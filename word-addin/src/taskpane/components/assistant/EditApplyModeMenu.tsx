import React, { useState } from "react";
import { Check, Eye, Pen } from "lucide-react";
import type { WordEditApplyMode } from "../../lib/wordChatSettings";
import {
  COMPOSER_GHOST_BUTTON_CLASS,
  COMPOSER_GHOST_WORD_SIZE_CLASS,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@mike/ui";
import { useTranslations } from "use-intl";
import { cn } from "../../../shared/lib/utils";

interface ApplyModeOption {
  mode: WordEditApplyMode;
  label: string;
  description: string;
  Icon: typeof Eye;
}

/** The two modes, worded in the interface language. */
function applyModeOptions(t: ReturnType<typeof useTranslations>): {
  review: ApplyModeOption;
  direct: ApplyModeOption;
} {
  return {
    review: {
      mode: "approval",
      label: t("word.applyModeReview"),
      description: t("word.applyModeReviewDescription"),
      Icon: Eye,
    },
    direct: {
      mode: "direct",
      label: t("word.applyModeEdit"),
      description: t("word.applyModeEditDescription"),
      Icon: Pen,
    },
  };
}

/**
 * Composer control choosing how streamed edits reach the document: a compact
 * pill showing the active mode that opens a two-option menu (title +
 * consequence per option), in the style of the model picker beside it.
 */
export function EditApplyModeMenu({
  mode,
  onModeChange,
}: {
  mode: WordEditApplyMode;
  onModeChange: (mode: WordEditApplyMode) => void;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const options = applyModeOptions(t);
  const active = mode === "direct" ? options.direct : options.review;

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={t("word.chooseHowEditsAreApplied")}
          title={t("word.chooseHowEditsAreApplied")}
          data-testid="edit-apply-toggle"
          className={cn(
            COMPOSER_GHOST_BUTTON_CLASS,
            COMPOSER_GHOST_WORD_SIZE_CLASS,
            "gap-1",
          )}
        >
          <active.Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{active.label}</span>
        </button>
      </DropdownTrigger>
      <DropdownContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-24px)]"
      >
        {[options.review, options.direct].map((option) => (
          <DropdownItem
            key={option.mode}
            onSelect={() => onModeChange(option.mode)}
            selected={option.mode === mode}
            className="flex-col items-stretch gap-0.5 py-2"
          >
            <span className="flex items-center gap-2">
              <option.Icon className="h-3.5 w-3.5 shrink-0 text-gray-500" />
              <span className="flex-1 text-xs font-medium text-gray-800">
                {option.label}
              </span>
              {option.mode === mode && (
                <Check className="h-3.5 w-3.5 shrink-0 text-gray-600" />
              )}
            </span>
            <span className="pl-[22px] text-xs text-gray-500">
              {option.description}
            </span>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
