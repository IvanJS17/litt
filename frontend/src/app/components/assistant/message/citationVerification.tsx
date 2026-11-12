import { CircleAlert } from "lucide-react";
import type { Citation, DocumentCitationQuote } from "../../shared/types";
import { PillButtonUI } from "@mike/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/popover";
import { useTranslations } from "next-intl";
import type { AppTranslate } from "@/i18n/Translate";

export type CitationVerificationDisplayState = "verified" | "unverified";

const UNVERIFIED_PRESENTATION = {
  labelKey: "assistant.citationVerification.couldNotVerifyQuote",
  descriptionKey: "assistant.citationVerification.quoteCouldNotBeMatched",
  pillClassName:
    "!bg-red-100/85 !text-red-800 hover:!bg-red-200/80 hover:!text-red-800 dark:!bg-red-950 dark:!text-white dark:hover:!bg-red-900 dark:hover:!text-white",
} as const;

export function citationVerificationState(
  citation: Citation,
): CitationVerificationDisplayState {
  return citation.verified === false ? "unverified" : "verified";
}

export function quoteVerificationState(
  quote: Pick<DocumentCitationQuote, "verification">,
): CitationVerificationDisplayState {
  return quote.verification?.verified === false ? "unverified" : "verified";
}

export function citationVerificationPillClassName(citation: Citation): string {
  return citationVerificationState(citation) === "unverified"
    ? UNVERIFIED_PRESENTATION.pillClassName
    : "";
}

export function citationVerificationDescription(
  citation: Citation,
  t: AppTranslate,
): string | null {
  const state = citationVerificationState(citation);
  return state === "unverified" ? t(UNVERIFIED_PRESENTATION.descriptionKey) : null;
}

export function citationVerificationAriaLabel(
  citation: Citation,
  t: AppTranslate,
): string {
  return t("assistant.citationVerification.citationRef", {
    ref: citation.ref,
    unverified: String(citationVerificationState(citation) === "unverified"),
  });
}

export function CitationVerificationBadge({
  state,
}: {
  state: CitationVerificationDisplayState;
}) {
  const t = useTranslations();
  if (state !== "unverified") return null;

  const presentation = UNVERIFIED_PRESENTATION;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PillButtonUI
          tone="white"
          size="xs"
          className="w-fit gap-1 font-sans !text-red-600 hover:!text-red-700"
        >
          <CircleAlert className="h-3 w-3" aria-hidden="true" />
          {t(presentation.labelKey)}
        </PillButtonUI>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[220] w-72"
      >
        <span className="block text-xs font-medium text-gray-900">
          {t("assistant.citationVerification.quoteNotFoundInDocument")}
        </span>
        <span className="mt-1 block text-xs font-normal leading-5 text-gray-600">
          {t("assistant.citationVerification.theLanguageModelProducedAQuote")}
        </span>
      </PopoverContent>
    </Popover>
  );
}
