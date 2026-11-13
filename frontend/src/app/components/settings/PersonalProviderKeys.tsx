"use client";

import { useState, type ReactNode } from "react";

import { ByokProviderModal } from "@/app/components/settings/ByokProviderModal";
import { ConnectorCard } from "@/app/components/settings/ConnectorCard";
import {
    MODEL_API_KEY_FIELDS,
    ModelProviderIcon,
    type ModelApiKeyField,
    byokProvider,
} from "@/app/components/settings/modelProviders";
import { PillButtonUI } from "@mike/ui";
import { ToggleSwitchUI } from "@mike/ui";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { useKeyScope, usePersonalKeysScope } from "@/app/components/settings/KeyScope";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { isMfaRequiredError, type ApiKeyProvider } from "@/app/lib/mikeApi";
import { reportFault } from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

/**
 * A provider is listed as saved once the user has saved their own key for it. It
 * stays there while switched off, so the switch does not move under the
 * pointer and the provider can be switched back on.
 */
const PROVIDER_SECTIONS = [
    {
        id: "active",
        active: true,
        title: "settings.personalProviderKeys.savedProviders",
        empty: "settings.personalProviderKeys.noSavedProvidersYet",
    },
    {
        id: "available",
        active: false,
        title: "settings.personalProviderKeys.availableProviders",
        empty: "settings.personalProviderKeys.everyProviderHasAKeySaved",
    },
] as const;

/**
 * The caller's own model provider keys: the Saved and Available provider
 * grids, the provider dialog and its on/off switches. Rendered by Settings →
 * Bring Your Own Keys and by the last onboarding step, so a key saved in
 * either place goes through the same checks.
 */
export function PersonalProviderKeys(props: { intro?: ReactNode }) {
    // A firm-managed account runs on the firm's keys: it has no personal ones
    // to add, and the server refuses them.
    const { managed } = useKeyScope();
    if (managed) return null;
    return <PersonalProviderKeysList {...props} />;
}

function PersonalProviderKeysList({
    intro,
}: {
    /** The sentence above the grids; `null` when the page says it already. */
    intro?: ReactNode;
}) {
    const t = useTranslations();
    const { profile, loading, updateApiKeyEnabled } = useUserProfile();
    const scope = usePersonalKeysScope();
    const [busyProvider, setBusyProvider] = useState<ApiKeyProvider | null>(null);
    const [toggleError, setToggleError] = useState<string | null>(null);
    const [pendingToggle, setPendingToggle] = useState<{ provider: ApiKeyProvider; enabled: boolean } | null>(null);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(
        null,
    );
    const selected = MODEL_API_KEY_FIELDS.find(
        (field) => field.provider === selectedProvider,
    );

    async function toggleProvider(provider: ApiKeyProvider, enabled: boolean) {
        setBusyProvider(provider);
        setToggleError(null);
        try {
            const saved = await updateApiKeyEnabled(provider, enabled);
            if (!saved) setToggleError(t("settings.personalProviderKeys.theProviderCouldNotBeUpdated"));
        } catch (error) {
            if (isMfaRequiredError(error)) setPendingToggle({ provider, enabled });
            else {
                // The message is fixed; the report keeps the fault's identity.
                reportFault(error, { operation: "settings.keys" });
                setToggleError(t("settings.personalProviderKeys.theProviderCouldNotBeUpdated"));
            }
        } finally {
            setBusyProvider(null);
        }
    }

    const renderToggle = (field: ModelApiKeyField, label: string) => (
        <ToggleSwitchUI
            checked={profile?.apiKeys[field.provider]?.enabled !== false}
            disabled={busyProvider !== null || pendingToggle !== null}
            aria-busy={busyProvider === field.provider}
            aria-label={label}
            onCheckedChange={(enabled) =>
                void toggleProvider(field.provider, enabled)
            }
        />
    );

    const renderCard = (field: ModelApiKeyField) => {
        const hasSavedKey =
            profile?.apiKeys[field.provider]?.source === "user";
        const blocked = loading || busyProvider === field.provider;
        const open = () => {
            if (!blocked) setSelectedProvider(field.provider);
        };
        return (
            <ConnectorCard
                key={field.provider}
                kind="provider"
                name={field.name}
                icon={<ModelProviderIcon field={field} loading={loading} />}
                // Like connectors: a saved provider opens from anywhere on
                // its card, an available one only from its Add button.
                onOpen={hasSavedKey ? open : undefined}
                action={
                    hasSavedKey ? (
                        renderToggle(field, t("settings.personalProviderKeys.nameProvider", { name: field.name }))
                    ) : (
                        <PillButtonUI
                            tone="blue"
                            size="sm"
                            disabled={blocked}
                            aria-label={t("settings.personalProviderKeys.addName", { name: field.name })}
                            aria-haspopup="dialog"
                            onClick={open}
                        >
                            {t("settings.personalProviderKeys.add")}
                        </PillButtonUI>
                    )
                }
            />
        );
    };

    return (
        <div className="@container space-y-8">
            {intro === undefined ? (
                <SettingsDescription>{scope}</SettingsDescription>
            ) : intro}
            {PROVIDER_SECTIONS.map((section) => {
                // While the profile loads, which providers are active is not
                // known yet: every card waits in the second section.
                const fields = MODEL_API_KEY_FIELDS.filter(
                    (field) =>
                        (!loading &&
                            profile?.apiKeys[field.provider]?.source ===
                                "user") === section.active,
                );
                const headingId = `byok-${section.id}-providers`;
                return (
                    <section
                        key={section.id}
                        aria-labelledby={headingId}
                        className="space-y-3"
                    >
                        <SettingsHeading id={headingId}>
                            {t(section.title)}
                        </SettingsHeading>
                        {loading && section.active ? (
                            <span className="block h-5 w-56 max-w-full animate-pulse rounded bg-gray-200" />
                        ) : fields.length === 0 ? (
                            <SettingsDescription>
                                {t(section.empty)}
                            </SettingsDescription>
                        ) : (
                            <div
                                className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2"
                                aria-busy={loading}
                            >
                                {fields.map(renderCard)}
                            </div>
                        )}
                    </section>
                );
            })}
            <ByokProviderModal
                provider={selected ? byokProvider(t, selected) : null}
                enabledToggle={
                    selected &&
                    profile?.apiKeys[selected.provider]?.source === "user"
                        ? renderToggle(selected, t("settings.personalProviderKeys.useName", { name: selected.name }))
                        : undefined
                }
                onClose={() => setSelectedProvider(null)}
            />
            <MfaVerificationPopup
                open={pendingToggle !== null}
                onCancel={() => setPendingToggle(null)}
                onVerified={() => {
                    if (!pendingToggle) return;
                    const action = pendingToggle;
                    setPendingToggle(null);
                    void toggleProvider(action.provider, action.enabled);
                }}
            />
            <WarningPopup
                open={toggleError !== null}
                title={t("settings.personalProviderKeys.providerUpdateFailed")}
                message={toggleError}
                onClose={() => setToggleError(null)}
            />
        </div>
    );
}
