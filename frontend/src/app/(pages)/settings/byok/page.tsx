"use client";

import { useTranslations } from "next-intl";
import {
    FirmKeysLink,
    PersonalKeysBlockedNotice,
    useKeyScope,
} from "@/app/components/settings/KeyScope";
import { PersonalProviderKeys } from "@/app/components/settings/PersonalProviderKeys";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";

export default function ByokPage() {
    const t = useTranslations();
    const { personalBlocked } = useKeyScope();
    // Where the person's own keys do not apply (a firm-managed account, or a
    // firm that turns them off), the keys that matter are the firm's, which
    // live in Ajustes del despacho: this page says why and points there. It
    // never repeats the firm's form, and is never an empty page.
    if (personalBlocked)
        return (
            <div className="space-y-3">
                <SettingsHeading>{t("settings.keyScope.personalHeading")}</SettingsHeading>
                <PersonalKeysBlockedNotice />
                <FirmKeysLink />
            </div>
        );
    return (
        <div className="space-y-4">
            <SettingsHeading>{t("settings.keyScope.personalHeading")}</SettingsHeading>
            <PersonalProviderKeys />
        </div>
    );
}
