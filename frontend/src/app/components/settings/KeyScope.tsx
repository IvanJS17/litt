"use client";

import { useTranslations } from "next-intl";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { SettingsDescription } from "@/app/components/settings/SettingsText";

/**
 * Which workspace a person's own keys apply to, as the server decides it:
 * in a firm's workspace they only count when the firm lets members bring
 * their own (`allow_personal_api_keys`, on unless turned off); in Personal
 * they always do. Unknown (still loading, or the read failed) is not
 * "blocked": the screen shows the keys and the server still decides.
 */
export function useKeyScope(): {
    firmName: string | null;
    personalBlocked: boolean;
} {
    const { activeOrganization, orgApiKeys } = useWorkspace();
    const firmName = activeOrganization?.name ?? null;
    return {
        firmName,
        personalBlocked:
            firmName !== null && orgApiKeys?.allow_personal_api_keys === false,
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
            {t("settings.keyScope.blocked", { name: firmName ?? "" })}
        </SettingsDescription>
    );
}
