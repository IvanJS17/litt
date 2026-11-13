import { clientTranslator } from "@mike/client";
import React from "react";
import { useTranslations } from "use-intl";
import type { Locale } from "@litt/i18n";
import { Trash2 } from "lucide-react";
import {
  ToggleSwitchUI,
  PillButtonUI as PillButton,
  GlassCardUI,
  SourceCodeLinkUI,
} from "@mike/ui";
import { PageTitle } from "../primitives/PageTitle";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";
import { Modal } from "../primitives/Modal";
import { reportFault } from "../../lib/notify";
import { LocaleSelect } from "../primitives/LocaleSelect";
import { useLocaleControls } from "../../i18n/LocaleProvider";
import { updateUiLocale } from "../../api/mikeApi";

interface SettingsPageProps {
  storageMode: WordChatStorageMode;
  onStorageModeChange: (mode: WordChatStorageMode) => Promise<void>;
  onClearLocalChats: () => Promise<void>;
}

export function SettingsPage({
  storageMode,
  onStorageModeChange,
  onClearLocalChats,
}: SettingsPageProps): React.ReactElement {
  const t = useTranslations();
  const { locale, setLocale } = useLocaleControls();
  const [languageSaving, setLanguageSaving] = React.useState(false);
  const [languageError, setLanguageError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);

  const updateMode = async (cloud: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onStorageModeChange(cloud ? "cloud" : "local");
    } catch (reason) {
      setError(
        reportFault(reason, {
          fallback: clientTranslator()("word.saveSettingFailed"),
          operation: "settings.keys",
        }).message,
      );
    } finally {
      setSaving(false);
    }
  };

  // Saved in the profile first, so the web app and Word agree; the pane
  // switches only once that worked and does not reload.
  const updateLanguage = async (next: Locale): Promise<void> => {
    setLanguageSaving(true);
    setLanguageError(null);
    try {
      await updateUiLocale(next);
      await setLocale(next);
    } catch (reason) {
      setLanguageError(
        reportFault(reason, {
          fallback: t("word.language.saveFailed"),
          operation: "settings.profile",
        }).message,
      );
    } finally {
      setLanguageSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <PageTitle className="mb-5 px-1">{t("word.settings.title")}</PageTitle>
      <section>
        <GlassCardUI>
          <div className="p-4">
            <label
              htmlFor="settings-language"
              className="block text-sm font-medium text-gray-900"
            >
              {t("word.language.title")}
            </label>
            <p className="mt-1 mb-3 text-xs leading-5 text-gray-500">
              {t("word.language.description")}
            </p>
            <LocaleSelect
              id="settings-language"
              value={locale}
              disabled={languageSaving}
              onChange={(next) => void updateLanguage(next)}
            />
            {languageError && (
              <p role="alert" className="mt-3 text-xs text-red-600">
                {languageError}
              </p>
            )}
          </div>
        </GlassCardUI>
      </section>

      <section className="mt-3">
        <GlassCardUI>
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-gray-900">
                  {t("word.saveChatsInTheCloud")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  {t("word.cloudChatsAreLinkedToThis")}
                </p>
              </div>
              <ToggleSwitchUI
                aria-label={t("word.saveChatsInTheCloud")}
                checked={storageMode === "cloud"}
                disabled={saving}
                onCheckedChange={(checked) => void updateMode(checked)}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 text-xs text-red-600">
                {error}
              </p>
            )}
          </div>
        </GlassCardUI>
      </section>

      <section className="mt-3">
        <GlassCardUI>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-gray-900">
                {t("word.deviceOnlyChats")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {t("word.localChatsRemainReadableInThis")}
              </p>
            </div>
            <PillButton
              tone="whiteDanger"
              onClick={() => setClearConfirmOpen(true)}
              className="shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("word.delete")}
            </PillButton>
          </div>
        </GlassCardUI>
      </section>

      <section className="mt-3">
        <GlassCardUI>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-gray-900">{t("word.acercaDe")}</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {t("word.littEsSoftwareLibreBajoLa")}
              </p>
            </div>
            <SourceCodeLinkUI
              commit={process.env.REACT_APP_GIT_SHA}
              label={t("common.sourceCode.label")}
              description={t("common.sourceCode.description")}
            />
          </div>
        </GlassCardUI>
      </section>

      <Modal
        open={clearConfirmOpen}
        onClose={() => !clearing && setClearConfirmOpen(false)}
        title={t("word.deleteDeviceOnlyChats")}
        primaryAction={{
          label: clearing ? t("word.deleting") : t("word.deleteChats"),
          tone: "danger",
          disabled: clearing,
          onClick: () => {
            setClearing(true);
            setError(null);
            void onClearLocalChats()
              .then(() => setClearConfirmOpen(false))
              .catch((reason: unknown) =>
                setError(
                  reportFault(reason, {
                    fallback:
                      clientTranslator()("word.deleteDeviceChatsFailed"),
                    operation: "settings.keys",
                  }).message,
                ),
              )
              .finally(() => setClearing(false));
          },
        }}
        secondaryAction={{
          label: t("word.cancel"),
          disabled: clearing,
          onClick: () => setClearConfirmOpen(false),
        }}
        className="h-auto max-h-[calc(100vh-2rem)]"
      >
        <p className="pb-5 text-sm leading-6 text-gray-600">
          {t("word.thisPermanentlyDeletesEveryDeviceOnly")}
        </p>
      </Modal>
    </div>
  );
}
