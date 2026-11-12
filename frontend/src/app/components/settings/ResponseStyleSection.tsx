"use client";

import { useEffect, useRef, useState } from "react";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsSelectRow,
  type SettingsSelectOption,
} from "@/app/components/settings/SettingsSelectRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import {
  RESPONSE_STYLE_OPTIONS,
  getResponseStyle,
  updateResponseStyle,
  type ResponseStyle,
  type ResponseStyleField,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";

type OptionCopy = Omit<SettingsSelectOption, "value">;

type ResponseLanguage = ResponseStyle["language"];

/** Every language reads the same way, so only its name is written out. */
function languageOptions(
  t: Translate,
  names: Record<Exclude<ResponseLanguage, "auto">, string>,
): Record<ResponseLanguage, OptionCopy> {
  const options = {
    auto: {
      label: t("settings.responseStyleSection.automatic"),
      description: t("settings.responseStyleSection.littRepliesInTheLanguageYouWriteIn"),
    },
  } as Record<ResponseLanguage, OptionCopy>;
  for (const [code, name] of Object.entries(names)) {
    options[code as ResponseLanguage] = {
      label: name,
      description: t("settings.responseStyleSection.littRepliesInName", { name }),
    };
  }
  return options;
}

// Typed per field, so adding an option to RESPONSE_STYLE_OPTIONS without its
// copy here fails the typecheck.
type StyleSettings = {
  [Field in ResponseStyleField]: {
    label: string;
    options: Record<ResponseStyle[Field], OptionCopy>;
  };
};

function responseStyleSettings(t: Translate): StyleSettings {
  return {
  verbosity: {
    label: t("settings.responseStyleSection.verbosity"),
    options: {
      concise: {
        label: t("settings.responseStyleSection.concise"),
        description: t("settings.responseStyleSection.shortDirectAnswersThatLeadWith"),
      },
      balanced: {
        label: t("settings.responseStyleSection.balanced"),
        description: t("settings.responseStyleSection.enoughExplanationToFollowTheReasoning"),
      },
      detailed: {
        label: t("settings.responseStyleSection.detailed"),
        description: t("settings.responseStyleSection.fullerReasoningExceptionsAndPracticalNext"),
      },
    },
  },
  formatting: {
    label: t("settings.responseStyleSection.headersAndLists"),
    options: {
      balanced: {
        label: t("settings.responseStyleSection.balanced"),
        description: t("settings.responseStyleSection.littPicksTheLayoutThatSuits"),
      },
      less: {
        label: t("settings.responseStyleSection.less"),
        description: t("settings.responseStyleSection.mostlyProseWithHeadingsAndLists"),
      },
      more: {
        label: t("settings.responseStyleSection.more"),
        description: t("settings.responseStyleSection.headingsBulletPointsAndTablesFor"),
      },
    },
  },
  tone: {
    label: t("settings.responseStyleSection.tone"),
    options: {
      formal: {
        label: t("settings.responseStyleSection.formalAndLegal"),
        description: t("settings.responseStyleSection.aPreciseClientReadyLegalRegister"),
      },
      balanced: {
        label: t("settings.responseStyleSection.balanced"),
        description: t("settings.responseStyleSection.littsUsualProfessionalTone"),
      },
      plain: {
        label: t("settings.responseStyleSection.plainAndSimple"),
        description:
          t("settings.responseStyleSection.shortSentencesAndEverydayWordsWith"),
      },
    },
  },
  language: {
    label: t("common.language.label"),
    options: languageOptions(t, {
      "en-US": t("settings.responseStyleSection.englishUs"),
      "en-GB": t("settings.responseStyleSection.englishUk"),
      ar: t("settings.responseStyleSection.arabic"),
      "zh-Hans": t("settings.responseStyleSection.chineseSimplified"),
      "zh-Hant": t("settings.responseStyleSection.chineseTraditional"),
      cs: t("settings.responseStyleSection.czech"),
      da: t("settings.responseStyleSection.danish"),
      nl: t("settings.responseStyleSection.dutch"),
      fi: t("settings.responseStyleSection.finnish"),
      fr: t("settings.responseStyleSection.french"),
      de: t("settings.responseStyleSection.german"),
      el: t("settings.responseStyleSection.greek"),
      he: t("settings.responseStyleSection.hebrew"),
      hi: t("settings.responseStyleSection.hindi"),
      id: t("settings.responseStyleSection.indonesian"),
      it: t("settings.responseStyleSection.italian"),
      ja: t("settings.responseStyleSection.japanese"),
      ko: t("settings.responseStyleSection.korean"),
      ms: t("settings.responseStyleSection.malay"),
      nb: t("settings.responseStyleSection.norwegian"),
      pl: t("settings.responseStyleSection.polish"),
      "pt-BR": t("settings.responseStyleSection.portugueseBrazil"),
      "pt-PT": t("settings.responseStyleSection.portuguesePortugal"),
      ru: t("settings.responseStyleSection.russian"),
      es: t("settings.responseStyleSection.spanish"),
      sv: t("settings.responseStyleSection.swedish"),
      th: t("settings.responseStyleSection.thai"),
      tr: t("settings.responseStyleSection.turkish"),
      uk: t("settings.responseStyleSection.ukrainian"),
      vi: t("settings.responseStyleSection.vietnamese"),
    }),
  },
  };
}

const FIELDS = Object.keys(RESPONSE_STYLE_OPTIONS) as ResponseStyleField[];

export function ResponseStyleSection() {
  const t = useTranslations();
  const SETTINGS = responseStyleSettings(t);
  const [style, setStyle] = useState<ResponseStyle | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saveErrors, setSaveErrors] = useState<
    Partial<Record<ResponseStyleField, string>>
  >({});
  // Per setting, only the newest choice may settle the UI; an older save
  // that resolves late must not overwrite it.
  const latestRequestRef = useRef<Record<ResponseStyleField, number>>({
    verbosity: 0,
    formatting: 0,
    tone: 0,
    language: 0,
  });

  useEffect(() => {
    const controller = new AbortController();
    getResponseStyle(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setStyle(loaded);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [loadVersion]);

  const choose = async <Field extends ResponseStyleField>(
    field: Field,
    next: ResponseStyle[Field],
  ) => {
    if (!style || style[field] === next) return;
    const previous = style[field];
    const request = ++latestRequestRef.current[field];
    const settle = (value: ResponseStyle[Field]) =>
      setStyle((current) => (current ? { ...current, [field]: value } : current));
    settle(next);
    setSaveErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const saved = await updateResponseStyle({ [field]: next });
      if (request !== latestRequestRef.current[field]) return;
      settle(saved[field]);
    } catch (error) {
      if (request !== latestRequestRef.current[field]) return;
      settle(previous);
      setSaveErrors((current) => ({
        ...current,
        [field]: userFacingApiError(
          error,
          t("settings.responseStyleSection.thisSettingCouldNotBeSaved"),
        ),
      }));
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="response-style-heading">
      <SettingsHeading id="response-style-heading">{t("settings.responseStyleSection.responseStyle")}</SettingsHeading>
      <SettingsDescription>
        {t("settings.responseStyleSection.chooseHowLittShapesItsAnswers")}
      </SettingsDescription>
      <GlassCardUI>
        {loadError ? (
          <SettingsRow>
            <p className="text-sm text-red-600" role="alert">
              {t("settings.responseStyleSection.couldNotLoadYourResponseStyle")}
            </p>
            <PillButtonUI
              tone="white"
              size="sm"
              onClick={() => {
                setLoadError(false);
                setLoadVersion((current) => current + 1);
              }}
            >
              {t("common.retry")}
            </PillButtonUI>
          </SettingsRow>
        ) : (
          FIELDS.map((field) => (
            <SettingsSelectRow
              key={field}
              id={`response-${field}`}
              label={SETTINGS[field].label}
              options={RESPONSE_STYLE_OPTIONS[field].map((option) => ({
                value: option,
                ...(SETTINGS[field].options as Record<string, OptionCopy>)[
                  option
                ],
              }))}
              value={style ? style[field] : null}
              error={saveErrors[field] ?? null}
              onChange={(next) =>
                void choose(field, next as ResponseStyle[typeof field])
              }
            />
          ))
        )}
      </GlassCardUI>
    </section>
  );
}
