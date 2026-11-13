"use client";

import { useTranslations } from "next-intl";
import {
    PersonalKeysBlockedNotice,
    useKeyScope,
} from "@/app/components/settings/KeyScope";
import { PersonalProviderKeys } from "@/app/components/settings/PersonalProviderKeys";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { OrganizationProviderKeys } from "@/app/components/organizations/OrganizationProviderKeys";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";

export default function ByokPage() {
    const t = useTranslations();
    const { personalBlocked } = useKeyScope();
    const { activeOrganization } = useWorkspace();
    // Where the person's own keys do not apply (a firm-managed account, or a
    // firm that turns them off), the keys that matter are the firm's: shown
    // read-only unless the person manages the firm, with the reason above.
    // Never an empty page.
    if (personalBlocked) {
        if (!activeOrganization)
            return (
                <div className="space-y-4" aria-busy="true">
                    <span className="block h-5 w-56 max-w-full animate-pulse rounded bg-gray-200" />
                </div>
            );
        return (
            <div className="space-y-6">
                <PersonalKeysBlockedNotice />
                <OrganizationProviderKeys
                    orgId={activeOrganization.id}
                    orgName={activeOrganization.name}
                />
            </div>
        );
    }
    return (
        <div className="space-y-4">
            <SettingsHeading>{t("settings.keyScope.personalHeading")}</SettingsHeading>
            <PersonalProviderKeys />
        </div>
    );
}
