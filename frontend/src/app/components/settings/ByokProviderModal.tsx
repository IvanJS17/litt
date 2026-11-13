"use client";

import type { ReactNode } from "react";
import { Modal } from "@/app/components/modals/Modal";
import { ApiKeyField, type ApiKeyFieldSetting } from "./ApiKeyField";
import {
  RouterSettingsSection,
  type RouterModelsStore,
} from "./RouterSettingsSection";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
  isVertexServiceAccountKey,
  normalizeAwsRegion,
  normalizeAzureEndpoint,
  normalizeAzureFoundryEndpoint,
  normalizeCustomBaseUrl,
  normalizeVertexLocation,
} from "@/app/lib/cloudProviderSettings";
import type { ApiKeyProvider, ApiKeySettings } from "@/app/lib/mikeApi";
import { isRouterSlug } from "@mike/client";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";

export type ByokProvider = {
  provider: ApiKeyProvider;
  name: string;
  label: string;
  /** What the modal calls the secret; defaults to "API key". */
  keyLabel?: string;
};

type SettingsProvider = keyof ApiKeySettings;

const SETTINGS_PROVIDERS: readonly SettingsProvider[] = [
  "bedrock",
  "azure",
  "azure-foundry",
  "vertex",
  "custom",
];

/** The setting each of these keys is saved with. */
function keySetting(
  t: Translate,
  provider: SettingsProvider,
  settings: ApiKeySettings | undefined,
): ApiKeyFieldSetting {
  if (provider === "bedrock") {
    return {
      label: t("settings.byokProviderModal.awsRegion"),
      placeholder: "us-east-1",
      savedValue: settings?.bedrock?.region ?? null,
      normalize: normalizeAwsRegion,
      invalidMessage:
        t("settings.byokProviderModal.enterTheAwsRegion"),
    };
  }
  if (provider === "azure-foundry") {
    return {
      label: t("settings.byokProviderModal.azureFoundryResource"),
      placeholder:
        t("settings.byokProviderModal.azureFoundryResourcePlaceholder"),
      savedValue: settings?.["azure-foundry"]?.endpoint ?? null,
      normalize: normalizeAzureFoundryEndpoint,
      invalidMessage:
        t("settings.byokProviderModal.enterAFoundryResource"),
    };
  }
  if (provider === "vertex") {
    return {
      label: t("settings.byokProviderModal.vertexLocation"),
      placeholder: t("settings.byokProviderModal.vertexLocationPlaceholder"),
      savedValue: settings?.vertex?.location ?? null,
      normalize: normalizeVertexLocation,
      invalidMessage:
        t("settings.byokProviderModal.enterTheVertexLocation"),
    };
  }
  if (provider === "custom") {
    return {
      label: t("settings.byokProviderModal.baseUrl"),
      placeholder: "https://llm.example.com/v1",
      savedValue: settings?.custom?.baseUrl ?? null,
      normalize: normalizeCustomBaseUrl,
      invalidMessage:
        t("settings.byokProviderModal.enterTheBaseUrl"),
    };
  }
  return {
    label: t("settings.byokProviderModal.azureOpenaiResource"),
    placeholder: t("settings.byokProviderModal.azureOpenaiResourcePlaceholder"),
    savedValue: settings?.azure?.endpoint ?? null,
    normalize: normalizeAzureEndpoint,
    invalidMessage:
      t("settings.byokProviderModal.enterAnAzureResource"),
  };
}

function settingsFor(
  provider: SettingsProvider,
  value: string,
): NonNullable<ApiKeySettings[SettingsProvider]> {
  if (provider === "bedrock") return { region: value };
  if (provider === "vertex") return { location: value };
  if (provider === "custom") return { baseUrl: value };
  return { endpoint: value };
}

function validateVertexKey(t: Translate, value: string): string | null {
  return isVertexServiceAccountKey(value)
    ? null
    : t("settings.byokProviderModal.pasteTheFullServiceAccountKey");
}

/**
 * Where the modal reads and saves a key when that is not the caller's own
 * profile — an organization's keys. Same fields, same checks; only the
 * owner differs.
 */
export type ProviderKeyStore = {
  hasSavedKey: boolean;
  settings: ApiKeySettings | undefined;
  /** Resolves false when the save failed; may throw the API error. */
  save: (
    provider: ApiKeyProvider,
    value: string | null,
    settings?: ApiKeySettings[keyof ApiKeySettings],
  ) => Promise<boolean>;
  /** The first breadcrumb, naming whose providers these are. */
  breadcrumb: string;
  /** The owner's Model Selections, for providers that keep a model list. */
  routerModels?: RouterModelsStore;
};

export function ByokProviderModal({ provider, enabledToggle, store, onClose }: {
  provider: ByokProvider | null;
  /** The provider's on/off switch, shown once a key is saved. */
  enabledToggle?: ReactNode;
  /** Omitted for the caller's own keys. */
  store?: ProviderKeyStore;
  onClose: () => void;
}) {
  const t = useTranslations();
  const { profile, updateApiKey } = useUserProfile();
  const hasSavedKey = store
    ? store.hasSavedKey
    : !!provider && profile?.apiKeys[provider.provider]?.source === "user";
  const hasEnvKey =
    !store && !!provider && profile?.apiKeys[provider.provider]?.source === "env";
  const savedSettings = store ? store.settings : profile?.apiKeySettings;
  const saveKey = store ? store.save : updateApiKey;
  const settingsProvider =
    SETTINGS_PROVIDERS.find((slug) => slug === provider?.provider) ?? null;
  // Routers (and the cloud providers) also keep Model Selections, once the
  // owner has a key for them.
  const routerSlug =
    provider && isRouterSlug(provider.provider) ? provider.provider : null;
  const router =
    routerSlug &&
    (store
      ? !!store.routerModels && store.hasSavedKey
      : profile?.apiKeys[routerSlug]?.configured === true)
      ? routerSlug
      : null;

  if (!provider) return null;

  return (
    <ApiKeyField
      key={provider.provider}
      variant="modal"
      label={provider.label}
      hasSavedKey={hasSavedKey}
      hasEnvKey={hasEnvKey}
      keyLabel={provider.keyLabel}
      validateKey={provider.provider === "vertex" ? (value) => validateVertexKey(t, value) : undefined}
      setting={settingsProvider ? keySetting(t, settingsProvider, savedSettings) : undefined}
      onSave={(value, settingValue) => saveKey(
        provider.provider, value.trim() || null,
        settingsProvider && settingValue ? settingsFor(settingsProvider, settingValue) : undefined,
      )}
      onRemove={async () => {
        const removed = await saveKey(provider.provider, null);
        // Nothing is left to manage once the key is gone.
        if (removed) onClose();
        return removed;
      }}
      render={(fields, saveAction, removeAction) => (
        <Modal
          open
          onClose={onClose}
          breadcrumbs={[store?.breadcrumb ?? t("settings.byokProviderModal.modelProviders"), provider.name]}
          // Sized for the model list from the start, so the dialog does not
          // grow the moment a key is saved.
          size={routerSlug && (!store || store.routerModels) ? "md" : "sm"}
          className="h-auto max-h-[calc(100dvh-2rem)]"
          // With no key waiting to be saved (models save as they are picked),
          // the primary button closes the dialog instead of sitting disabled.
          primaryAction={
            saveAction.settled
              ? { label: t("settings.byokProviderModal.done"), onClick: onClose, disabled: false, variant: "blue" }
              : {
                  label: saveAction.label,
                  onClick: saveAction.onClick,
                  disabled: saveAction.disabled,
                  variant: "blue",
                }
          }
          secondaryAction={removeAction ? { ...removeAction, label: t("settings.byokProviderModal.clear"), variant: "danger" } : undefined}
        >
          <div data-modal-scroll="vertical" className="min-h-0 min-w-0 space-y-6 overflow-y-auto pb-4">
            {enabledToggle && (
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-gray-700">{t("settings.byokProviderModal.enabled")}</p>
                <div className="shrink-0">{enabledToggle}</div>
              </div>
            )}
            {fields}
            {router && (
              <RouterSettingsSection
                provider={router}
                store={store?.routerModels}
              />
            )}
          </div>
        </Modal>
      )}
    />
  );
}
