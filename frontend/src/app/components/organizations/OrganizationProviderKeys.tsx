"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { ByokProviderModal } from "@/app/components/settings/ByokProviderModal";
import { ConnectorCard } from "@/app/components/settings/ConnectorCard";
import { ScanReadingCard } from "@/app/components/settings/ScanReadingCard";
import { SplitClassesCard } from "@/app/components/settings/SplitClassesCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import {
  MODEL_API_KEY_FIELDS,
  ModelProviderIcon,
  byokProvider,
  providerName,
  type ModelApiKeyField,
} from "@/app/components/settings/modelProviders";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { routerSelectionsFromLists } from "@/app/hooks/useModelRouterSelections";
import {
  MikeApiError,
  getOrgApiKeys,
  getOrgSplitClasses,
  saveOrgSplitClasses,
  isMfaRequiredError,
  saveOrgApiKey,
  saveOrgRouterModels,
  setOrgApiKeyEnabled,
  setOrgPersonalApiKeysAllowed,
  type ApiKeyProvider,
  type ApiKeySettings,
  type OrgApiKeySettings,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import type { RouterSlug } from "@mike/client";
import { GlassCardUI, PillButtonUI, ToggleSwitchUI } from "@mike/ui";
import { useTranslations } from "next-intl";

// An organization's model providers: the keys its work runs on, the models
// each may run, and whether a member's own key may stand in where it has
// none. These are the sections of the Organization page, which is
// its owners' and admins' alone; they manage it with the same cards and the
// same key dialog as a person's Bring Your Own Keys page.
//
// `can_manage` is the server's word on the caller. Somebody demoted while
// the page was open is shown what is set up and offered nothing to change.

type PendingMfa =
  | { kind: "toggle"; provider: ApiKeyProvider; enabled: boolean }
  | { kind: "policy"; allowed: boolean }
  | { kind: "models"; provider: RouterSlug; models: string[] };


export function OrganizationProviderKeys({
  orgId,
  orgName,
  notice,
}: {
  orgId: string;
  orgName: string;
  /** Said under the title in place of the scope line, e.g. why a member cannot add their own. */
  notice?: ReactNode;
}) {
  const t = useTranslations();
  const { refreshOrgApiKeys } = useWorkspace();
  const [settings, setSettings] = useState<OrgApiKeySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ApiKeyProvider | "policy" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<ApiKeyProvider | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSettings(await getOrgApiKeys(orgId));
    } catch (error) {
      setLoadError(userFacingApiError(error, t("organizations.organizationProviderKeys.loadError")));
    }
  }, [orgId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // What was saved here is what the model pickers offer when this is the
  // active workspace, so they are told as soon as it changes.
  const applied = useCallback(
    (next: OrgApiKeySettings) => {
      setSettings(next);
      void refreshOrgApiKeys();
    },
    [refreshOrgApiKeys],
  );

  const loading = settings === null && loadError === null;
  const canManage = settings?.can_manage === true;
  const hasOrgKey = (provider: ApiKeyProvider) =>
    settings?.keys.sources?.[provider] === "org";
  const isEnabled = (provider: ApiKeyProvider) =>
    settings?.keys.enabled?.[provider] !== false;
  const selected =
    MODEL_API_KEY_FIELDS.find((field) => field.provider === selectedProvider) ??
    null;

  async function toggleProvider(provider: ApiKeyProvider, enabled: boolean) {
    setBusy(provider);
    try {
      applied(await setOrgApiKeyEnabled(orgId, provider, enabled));
    } catch (error) {
      if (isMfaRequiredError(error))
        setPendingMfa({ kind: "toggle", provider, enabled });
      else setActionError(userFacingApiError(error, t("organizations.organizationProviderKeys.updateError")));
    } finally {
      setBusy(null);
    }
  }

  async function setPersonalKeysAllowed(allowed: boolean) {
    setBusy("policy");
    try {
      applied(await setOrgPersonalApiKeysAllowed(orgId, allowed));
    } catch (error) {
      if (isMfaRequiredError(error)) setPendingMfa({ kind: "policy", allowed });
      else setActionError(userFacingApiError(error, t("organizations.organizationProviderKeys.policyError")));
    } finally {
      setBusy(null);
    }
  }

  // The key dialog shows a rejected value's own reason and runs the MFA
  // prompt itself, so those two are passed up to it rather than swallowed.
  async function saveKey(
    provider: ApiKeyProvider,
    value: string | null,
    keySettings?: ApiKeySettings[keyof ApiKeySettings],
  ): Promise<boolean> {
    try {
      applied(
        await saveOrgApiKey(orgId, provider, value?.trim() || null, keySettings),
      );
      return true;
    } catch (error) {
      if (isMfaRequiredError(error)) throw error;
      if (error instanceof MikeApiError && error.status === 400) throw error;
      return false;
    }
  }

  // The model list field reports a save as done or not done. When the server
  // asks for MFA first, its answer waits here for the retry (or the cancel).
  const modelsAfterMfa = useRef<((saved: boolean) => void) | null>(null);
  async function saveModels(
    provider: RouterSlug,
    models: string[],
  ): Promise<boolean> {
    try {
      applied(await saveOrgRouterModels(orgId, provider, models));
      return true;
    } catch (error) {
      if (!isMfaRequiredError(error)) return false;
      return new Promise<boolean>((resolve) => {
        modelsAfterMfa.current = resolve;
        setPendingMfa({ kind: "models", provider, models });
      });
    }
  }

  const renderToggle = (field: ModelApiKeyField, label: string) => (
    <ToggleSwitchUI
      checked={isEnabled(field.provider)}
      disabled={busy !== null || pendingMfa !== null}
      aria-busy={busy === field.provider}
      aria-label={label}
      onCheckedChange={(enabled) => void toggleProvider(field.provider, enabled)}
    />
  );

  const renderCard = (field: ModelApiKeyField) => {
    const saved = hasOrgKey(field.provider);
    const blocked = loading || busy === field.provider;
    const open = () => {
      if (!blocked) setSelectedProvider(field.provider);
    };
    return (
      <ConnectorCard
        key={field.provider}
        kind="provider"
        name={providerName(t, field)}
        icon={<ModelProviderIcon field={field} loading={loading} />}
        onOpen={canManage && saved ? open : undefined}
        action={
          loading ? (
            // Whether this is a switch, an Add button or plain text depends
            // on the caller's role, which is not known yet.
            <span className="block h-5 w-9 animate-pulse rounded-full bg-gray-200" />
          ) : !canManage ? (
            // Read-only: say what the switch would say, as plain text.
            <span className="text-sm text-gray-500">
              {isEnabled(field.provider) ? t("organizations.organizationProviderKeys.on") : t("organizations.organizationProviderKeys.off")}
            </span>
          ) : saved ? (
            renderToggle(field, t("organizations.organizationProviderKeys.nameProvider", { name: providerName(t, field) }))
          ) : (
            <PillButtonUI
              tone="blue"
              size="sm"
              disabled={blocked}
              aria-label={t("organizations.organizationProviderKeys.addName", { name: providerName(t, field) })}
              aria-haspopup="dialog"
              onClick={open}
            >
              {t("organizations.organizationProviderKeys.add")}
            </PillButtonUI>
          )
        }
      />
    );
  };

  if (loadError)
    return (
      <div className="space-y-3" role="alert">
        <SettingsDescription>{loadError}</SettingsDescription>
        <PillButtonUI tone="white" size="sm" onClick={() => void load()}>
          {t("organizations.organizationProviderKeys.tryAgain")}
        </PillButtonUI>
      </div>
    );

  const savedFields = MODEL_API_KEY_FIELDS.filter(
    (field) => !loading && hasOrgKey(field.provider),
  );
  const availableFields = MODEL_API_KEY_FIELDS.filter(
    (field) => loading || !hasOrgKey(field.provider),
  );
  const allowPersonal = settings?.allow_personal_api_keys !== false;

  return (
    <>
      <div className="@container space-y-8">
        <section
          aria-labelledby="org-providers-saved"
          className="space-y-3"
        >
          <SettingsHeading id="org-providers-saved">
            {t("organizations.organizationProviderKeys.organizationProviders", { name: orgName })}
          </SettingsHeading>
          {notice ?? (
            <SettingsDescription>
              {t("organizations.organizationProviderKeys.firmScope", { name: orgName })}
            </SettingsDescription>
          )}
          {loading ? (
            <span className="block h-5 w-56 max-w-full animate-pulse rounded bg-gray-200" />
          ) : savedFields.length === 0 ? (
            <SettingsDescription>
              {canManage
                ? t("organizations.organizationProviderKeys.noProvidersYetAddAnApi")
                : t("organizations.organizationProviderKeys.thisOrganizationHasNotSetUp")}
            </SettingsDescription>
          ) : (
            // A member only reads these, one full-width row each; a
            // manager's two columns match the list of providers to add.
            <div
              className={
                canManage
                  ? "grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2"
                  : "grid grid-cols-1 gap-3"
              }
            >
              {savedFields.map(renderCard)}
            </div>
          )}
        </section>

        {/* Members cannot add a provider, so the list of ones to add is the
            managers' alone. It stays up while loading so the page does not
            jump once the role is known. */}
        {loading || canManage ? (
          <section
            aria-labelledby="org-providers-available"
            className="space-y-3"
          >
            <SettingsHeading id="org-providers-available">
              {t("organizations.organizationProviderKeys.availableProviders")}
            </SettingsHeading>
            {availableFields.length === 0 ? (
              <SettingsDescription>
                {t("organizations.organizationProviderKeys.everyProviderHasAKeySaved")}
              </SettingsDescription>
            ) : (
              <div
                className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2"
                aria-busy={loading}
              >
                {availableFields.map(renderCard)}
              </div>
            )}
          </section>
        ) : null}

        {/* The policy is the managers' to change; a member already reads
            it in the notice above. */}
        {loading || canManage ? (
          <section aria-labelledby="org-providers-personal" className="space-y-3">
            <SettingsHeading id="org-providers-personal">
              {t("organizations.organizationProviderKeys.membersOwnKeys")}
            </SettingsHeading>
            <GlassCardUI>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
                <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                  <SettingsLabel>{t("organizations.organizationProviderKeys.allowMembersOwnKeys")}</SettingsLabel>
                  <SettingsDescription>
                    {allowPersonal
                      ? t("organizations.organizationProviderKeys.aMembersOwnKeyIsUsed")
                      : t("organizations.organizationProviderKeys.aMembersOwnKeysAreNever")}
                  </SettingsDescription>
                </div>
                <div className="ml-auto flex shrink-0 items-center">
                  {loading ? (
                    <span className="block h-5 w-9 animate-pulse rounded-full bg-gray-200" />
                  ) : canManage ? (
                    <ToggleSwitchUI
                      checked={allowPersonal}
                      disabled={busy !== null || pendingMfa !== null}
                      aria-busy={busy === "policy"}
                      aria-label={t("organizations.organizationProviderKeys.allowMembersOwnKeys2")}
                      onCheckedChange={(allowed) =>
                        void setPersonalKeysAllowed(allowed)
                      }
                    />
                  ) : (
                    <span className="text-sm text-gray-500">
                      {allowPersonal ? t("organizations.organizationProviderKeys.on") : t("organizations.organizationProviderKeys.off")}
                    </span>
                  )}
                </div>
              </div>
            </GlassCardUI>
          </section>
        ) : null}

        {/* The scan-reading explanation is on Features for everyone; here it
            is only the firm key's field, for those who manage it. */}
        {loading || canManage ? (
        <ScanReadingCard
          loading={loading}
          keyScope={t("organizations.organizationProviderKeys.firmScope", { name: orgName })}
          canManage={canManage}
          hasSavedKey={hasOrgKey("landingai")}
          enabled={hasOrgKey("landingai") && isEnabled("landingai")}
          busy={busy !== null || pendingMfa !== null}
          onToggle={(enabled) => void toggleProvider("landingai", enabled)}
          onSaveKey={(value) => saveKey("landingai", value)}
          onRemoveKey={() => saveKey("landingai", null)}
        />
        ) : null}

        <SplitClassesCard
          title={t("settings.splitClasses.title")}
          intro={t("settings.splitClasses.orgIntro")}
          load={() => getOrgSplitClasses(orgId)}
          save={(classes) => saveOrgSplitClasses(orgId, classes)}
        />
      </div>

      {canManage ? (
        <ByokProviderModal
          provider={selected ? byokProvider(t, selected) : null}
          store={{
            hasSavedKey: selected ? hasOrgKey(selected.provider) : false,
            settings: settings?.keys.settings,
            save: saveKey,
            breadcrumb: orgName,
            routerModels: {
              configured: hasOrgKey,
              selections: routerSelectionsFromLists(settings?.router_models),
              settings: settings?.keys.settings,
              save: saveModels,
              workspace: orgId,
              description:
                t("organizations.organizationProviderKeys.addTheModelsThisOrganizationsKey"),
            },
          }}
          enabledToggle={
            selected && hasOrgKey(selected.provider)
              ? renderToggle(selected, t("organizations.organizationProviderKeys.useName", { name: providerName(t, selected) }))
              : undefined
          }
          onClose={() => setSelectedProvider(null)}
        />
      ) : null}
      <MfaVerificationPopup
        open={pendingMfa !== null}
        onCancel={() => {
          setPendingMfa(null);
          modelsAfterMfa.current?.(false);
          modelsAfterMfa.current = null;
        }}
        onVerified={() => {
          if (!pendingMfa) return;
          const action = pendingMfa;
          setPendingMfa(null);
          if (action.kind === "toggle")
            void toggleProvider(action.provider, action.enabled);
          else if (action.kind === "policy")
            void setPersonalKeysAllowed(action.allowed);
          else {
            const answer = modelsAfterMfa.current;
            modelsAfterMfa.current = null;
            void saveModels(action.provider, action.models).then((saved) =>
              answer?.(saved),
            );
          }
        }}
      />
      <WarningPopup
        open={actionError !== null}
        title={t("organizations.organizationProviderKeys.providerUpdateFailed")}
        message={actionError}
        onClose={() => setActionError(null)}
      />
    </>
  );
}
