"use client";

import { useTranslations } from "next-intl";
import {
    PersonalKeysBlockedNotice,
    useKeyScope,
} from "@/app/components/settings/KeyScope";
import { PersonalProviderKeys } from "@/app/components/settings/PersonalProviderKeys";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";

export default function ByokPage() {
    const t = useTranslations();
    const { personalBlocked, managed } = useKeyScope();
    // A firm-managed account runs on the firm's keys: nothing to set here.
    if (managed) return null;
    // In a firm that does not allow members' own keys there is nothing to
    // set here for that workspace; the notice says why instead.
    return (
        <div className="space-y-4">
            <SettingsHeading>{t("settings.keyScope.personalHeading")}</SettingsHeading>
            {personalBlocked ? <PersonalKeysBlockedNotice /> : <PersonalProviderKeys />}
        </div>
    );
}
