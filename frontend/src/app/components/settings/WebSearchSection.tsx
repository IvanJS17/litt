"use client";

import { useEffect, useRef, useState } from "react";
import { ApiKeyField } from "@/app/components/settings/ApiKeyField";
import { GlassCardUI, PillButtonUI, ToggleSwitchUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsSelectRow,
  type SettingsSelectOption,
} from "@/app/components/settings/SettingsSelectRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { useKeyScope, usePersonalKeysScope } from "@/app/components/settings/KeyScope";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useAssignLatest } from "@/app/hooks/useLatestRef";
import { isProviderAvailable } from "@/app/lib/modelAvailability";
import {
  getWebSearchSettings,
  updateWebSearchSettings,
  WEB_SEARCH_BACKENDS,
  type WebSearchBackend,
  type WebSearchSettings,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";

function searchServices(
  t: Translate,
): Record<
  WebSearchBackend,
  { label: string; description: string; keyLabel: string }
> {
  return {
  brave: {
    label: "Brave Search",
    description: t("settings.webSearchSection.littSearchesWithBraveSearch"),
    keyLabel: t("settings.modelProviders.apiKey", { name: "Brave Search" }),
  },
  tavily: {
    label: "Tavily",
    description: t("settings.webSearchSection.tavilySearchesAndReadsPages"),
    keyLabel: t("settings.modelProviders.apiKey", { name: "Tavily" }),
  },
  deepseek: {
    label: "DeepSeek Search",
    description: t("settings.webSearchSection.deepseekSearchesAndReadsPages"),
    keyLabel: t("settings.modelProviders.apiKey", { name: "DeepSeek" }),
  },
  };
}

function searchServiceOptions(t: Translate): SettingsSelectOption[] {
  const services = searchServices(t);
  return WEB_SEARCH_BACKENDS.map((backend) => {
    const { label, description } = services[backend];
    return { value: backend, label, description };
  });
}

type Field = keyof WebSearchSettings;

type Family = Exclude<Field, "enabled">;

type ProviderFamily = {
  family: "claude" | "openai";
  label: string;
  provider: { label: string; description: string };
};

function providerFamilyTable(t: Translate): ProviderFamily[] {
  return [
  {
    family: "claude",
    label: t("settings.webSearchSection.modelsOfFamily", { name: "Claude" }),
    provider: {
      label: "Anthropic Search",
      description: t("settings.webSearchSection.anthropicRunsTheSearch"),
    },
  },
  {
    family: "openai",
    label: t("settings.webSearchSection.modelsOfFamily", { name: "OpenAI" }),
    provider: {
      label: "OpenAI Search",
      description: t("settings.webSearchSection.openaiRunsTheSearch"),
    },
  },
  ];
}

function offOption(t: Translate) {
  return {
    value: "off",
    label: t("settings.webSearchSection.off"),
    description: t("settings.webSearchSection.theseModelsWontSearchTheWeb"),
  };
}

function saveAction(
  t: Translate,
  field: Field,
  next: WebSearchSettings[Field],
): string {
  if (field === "enabled") {
    return next
      ? t("settings.webSearchSection.actions.turnOnWebSearch")
      : t("settings.webSearchSection.actions.turnOffWebSearch");
  }
  const family = providerFamilyTable(t).find((entry) => entry.family === field);
  return t("settings.webSearchSection.actions.changeWebSearchFor", {
    name: family?.label ?? t("settings.webSearchSection.actions.otherModels"),
  });
}

export function WebSearchSection() {
  const t = useTranslations();
  const SEARCH_SERVICES = searchServices(t);
  const SEARCH_SERVICE_OPTIONS = searchServiceOptions(t);
  const OFF_OPTION = offOption(t);
  const { profile, updateApiKey } = useUserProfile();
  const { firmName, personalBlocked } = useKeyScope();
  const scope = usePersonalKeysScope();
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  // Per setting, only the newest choice may settle the UI; an older save
  // that resolves late must not overwrite it.
  const latestRequestRef = useRef<Record<Field, number>>({
    enabled: 0,
    claude: 0,
    openai: 0,
    other: 0,
  });
  const retryRef = useRef<
    ((field: Field, next: WebSearchSettings[Field]) => Promise<void>) | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    getWebSearchSettings(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setSettings(loaded);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [loadVersion]);

  const save = async <F extends Field>(field: F, next: WebSearchSettings[F]) => {
    if (!settings || settings[field] === next) return;
    const previous = settings[field];
    const request = ++latestRequestRef.current[field];
    const settle = (value: WebSearchSettings[F]) =>
      setSettings((current) =>
        current ? { ...current, [field]: value } : current,
      );
    settle(next);
    try {
      const saved = await updateWebSearchSettings({ [field]: next });
      if (request !== latestRequestRef.current[field]) return;
      settle(saved[field]);
    } catch (error) {
      if (request !== latestRequestRef.current[field]) return;
      settle(previous);
      notifyError(error, {
        action: saveAction(t, field, next),
        onRetry: () => void retryRef.current?.(field, next),
      });
    }
  };
  useAssignLatest(retryRef, save);

  const toggleWebSearch = async (enabled: boolean) => {
    setSaving(true);
    await save("enabled", enabled);
    setSaving(false);
  };

  const providerFamilies = providerFamilyTable(t).filter(
    ({ family }) => profile && isProviderAvailable(family, profile.apiKeys),
  ).map(({ family, label, provider }) => ({
    family,
    label,
    options: [
      { value: "provider", ...provider },
      ...SEARCH_SERVICE_OPTIONS,
      OFF_OPTION,
    ],
  }));
  const families: Array<{
    family: Family;
    label: string;
    options: SettingsSelectOption[];
  }> = [
    ...providerFamilies,
    {
      family: "other",
      label: providerFamilies.length > 0 ? t("settings.webSearchSection.otherModels") : t("settings.webSearchSection.allModels"),
      options: [...SEARCH_SERVICE_OPTIONS, OFF_OPTION],
    },
  ];
  const chosenServices =
    settings?.enabled && profile
      ? WEB_SEARCH_BACKENDS.filter((backend) =>
          families.some(({ family }) => settings[family] === backend),
        )
      : [];

  return (
    <section className="space-y-3" aria-labelledby="web-search-heading">
      <SettingsHeading id="web-search-heading">{t("settings.webSearchSection.webSearch")}</SettingsHeading>
      <GlassCardUI>
        {loadError ? (
          <SettingsRow>
            <p className="text-sm text-red-600" role="alert">
              {t("settings.webSearchSection.couldNotLoadYourWebSearch")}
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
          <>
            <SettingsRow>
              <div className="min-w-0 space-y-1">
                <SettingsLabel>{t("settings.webSearchSection.enableWebSearch")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.webSearchSection.letLittSearchTheWebAnd")}
                </SettingsDescription>
              </div>
              {settings ? (
                <ToggleSwitchUI
                  checked={settings.enabled}
                  disabled={saving}
                  aria-busy={saving}
                  aria-label={t("settings.webSearchSection.enableWebSearch")}
                  onCheckedChange={(enabled) => void toggleWebSearch(enabled)}
                />
              ) : (
                <div
                  className="h-5 w-9 shrink-0 animate-pulse rounded-full bg-app-surface"
                  aria-hidden="true"
                />
              )}
            </SettingsRow>
            {settings?.enabled &&
              profile &&
              families.map(({ family, label, options }) => (
                <SettingsSelectRow
                  key={family}
                  id={`web-search-${family}`}
                  label={label}
                  options={options}
                  value={settings[family]}
                  onChange={(next) =>
                    void save(family, next as WebSearchSettings[Family])
                  }
                />
              ))}
            {personalBlocked && chosenServices.length > 0 ? (
              <SettingsRow>
                <SettingsDescription>
                  {t("settings.keyScope.blocked", { name: firmName ?? "" })}
                </SettingsDescription>
              </SettingsRow>
            ) : null}
            {personalBlocked ? null : chosenServices.map((service) => (
              <ApiKeyField
                key={service}
                label={SEARCH_SERVICES[service].keyLabel}
                description={scope}
                hasSavedKey={profile?.apiKeys[service].source === "user"}
                onSave={(value) => updateApiKey(service, value.trim() || null)}
                onRemove={() => updateApiKey(service, null)}
              />
            ))}
          </>
        )}
      </GlassCardUI>
    </section>
  );
}
