"use client";

import { useTranslations } from "next-intl";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { SettingsCrossLink } from "@/app/components/settings/SettingsCrossLink";
import { firmSettingsHref } from "@/app/lib/settingsMap";
import { isOrgAdmin } from "@/app/lib/permissions";
import type { KeyCapability, OrgApiKeySettings } from "@/app/lib/mikeApi";

/**
 * Which workspace a person's own keys apply to, as the server decides it:
 * in a firm's workspace they only count when the firm lets members bring
 * their own for that kind of key (AI models, web search or scan reading:
 * `allow_personal_keys[capability]`, each on unless turned off); in Personal
 * they always do. A firm-managed account never has personal keys, wherever
 * it is. Unknown (still loading, or the read failed) is not
 * "blocked": the screen shows the keys and the server still decides.
 *
 * Where own keys are blocked the person works on the firm's, so `orgApiKeys`
 * is what to show instead of their own controls (null until it is read).
 * This is the one place that decides it: settings screens that would offer a
 * personal key (provider keys, LandingAI, Brave) ask here and show the firm's
 * state when `personalBlocked`.
 */
export function useKeyScope(capability: KeyCapability = "ai"): {
    firmName: string | null;
    personalBlocked: boolean;
    /** A firm-managed account: no personal keys in any workspace. */
    managed: boolean;
    /** The active firm's keys as the person may see them, once read. */
    orgApiKeys: OrgApiKeySettings | null;
} {
    const { activeOrganization, orgApiKeys } = useWorkspace();
    // Read from the profile (not the workspace) so it also holds on screens
    // rendered outside the app shell, like the onboarding key step.
    const managed =
        useUserProfile().profile?.personalWorkspaceDisabled === true;
    const firmName = activeOrganization?.name ?? null;
    return {
        firmName,
        managed,
        orgApiKeys: firmName === null ? null : orgApiKeys,
        personalBlocked:
            managed ||
            (firmName !== null && orgApiKeys?.allow_personal_keys?.[capability] === false),
    };
}

/** One sentence saying where the person's own keys apply. */
export function usePersonalKeysScope(): string {
    const t = useTranslations();
    const { firmName } = useKeyScope();
    return firmName
        ? t("settings.keyScope.inFirm", { name: firmName })
        : t("settings.keyScope.personal");
}

/** Shown in place of own-key controls in a firm that does not allow them. */
export function PersonalKeysBlockedNotice() {
    const t = useTranslations();
    const { firmName } = useKeyScope();
    return (
        <SettingsDescription>
            {/* Before the name loads there is no subject to start with: the
                sentence without one, never " te da los modelos…". */}
            {firmName ? t("settings.keyScope.blocked", { name: firmName }) : t("settings.keyScope.blockedNoName")}
        </SettingsDescription>
    );
}

/**
 * Where the keys are decided when the firm's apply instead of the person's: a
 * link to «Ajustes del despacho → Llaves del despacho» for those who manage
 * it, and who to ask for everyone else. Never a copy of the firm's form.
 */
export function FirmKeysLink() {
    const t = useTranslations();
    const { activeOrganization } = useWorkspace();
    if (!activeOrganization) return null;
    if (!isOrgAdmin(activeOrganization.role))
        return (
            <SettingsDescription>
                {t("settings.map.keysManagedByFirmMember", { name: activeOrganization.name })}
            </SettingsDescription>
        );
    return (
        <SettingsCrossLink
            messageKey="settings.map.keysManagedByFirmAdmin"
            href={firmSettingsHref(activeOrganization.id, "providers")}
            values={{ name: activeOrganization.name }}
        />
    );
}
