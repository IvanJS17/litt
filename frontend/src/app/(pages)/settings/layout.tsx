"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrganizationInvitationCount } from "@/app/hooks/useOrganizationInvitationCount";
import { usePlatformMe } from "@/app/hooks/usePlatformMe";
import { useMemberDataActions } from "@/app/hooks/useMemberDataActions";
import {
    SettingsShell,
    type SettingsShellTab,
} from "@/app/components/settings/SettingsShell";
import { SettingsSearch } from "@/app/components/settings/SettingsSearch";
import { SETTINGS_SEARCH_ENTRIES } from "@/app/lib/settingsSearch";

function settingsTabs(t: Translate): SettingsShellTab[] {
    return [
    { id: "account", label: t("settings.layout.tab.account"), href: "/settings" },
    {
        id: "personalisation",
        label: t("settings.layout.tab.personalisation"),
        href: "/settings/personalisation",
    },
    { id: "memory", label: t("settings.layout.tab.memory"), href: "/settings/memory" },
    { id: "appearance", label: t("settings.layout.tab.appearance"), href: "/settings/appearance" },
    { id: "features", label: t("settings.layout.tab.features"), href: "/settings/features" },
    {
        id: "privacy-data",
        label: t("settings.layout.tab.privacyData"),
        href: "/settings/privacy-data",
    },
    {
        id: "my-activity",
        label: t("settings.layout.tab.myActivity"),
        href: "/settings/my-activity",
    },
    { id: "security", label: t("settings.layout.tab.security"), href: "/settings/security" },
    { id: "models", label: t("settings.layout.tab.models"), href: "/settings/models" },
    {
        id: "byok",
        label: t("settings.layout.tab.byok"),
        href: "/settings/byok",
    },
    { id: "connectors", label: t("settings.layout.tab.connectors"), href: "/settings/connectors" },
    // LiTT training: a pupil's mentor and stages, and a mentor's pupils.
    { id: "training", label: t("settings.layout.tab.training"), href: "/settings/training" },
    // The organizations the person belongs to, and their invitations. Each
    // organization's own settings are a separate area, opened from here or
    // from the account menu.
    {
        id: "organizations",
        label: t("settings.layout.tab.organizations"),
        href: "/settings/organizations",
    },
    ];
}

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const t = useTranslations();
    const { user, isAuthenticated, authLoading } = useAuth();
    const invitationCount = useOrganizationInvitationCount(
        isAuthenticated && !authLoading ? user?.id : undefined,
    );
    // Privacy & Data has nothing to offer a member of an organization whose
    // owners allow neither exports nor bulk deletes, so it is not listed.
    const { canExport, canDelete } = useMemberDataActions();
    const hidePrivacyData = !canExport && !canDelete;
    // Beta invitations are for platform administrators only.
    const isPlatformAdmin = usePlatformMe(user?.id)?.admin === true;
    const visibleTabs = useMemo(
        () =>
            settingsTabs(t).filter(
                (tab) => !(hidePrivacyData && tab.id === "privacy-data"),
            ).flatMap((tab) =>
                // LiTT training: the firm's written criteria sit beside Formación.
                tab.id === "training"
                    ? [
                          tab,
                          {
                              id: "firm-criteria",
                              label: t("training.firmCriteria.settings.tab"),
                              href: "/settings/firm-criteria",
                          },
                      ]
                    : tab.id === "organizations" && isPlatformAdmin
                      ? [
                            tab,
                            {
                                id: "beta-invitations",
                                label: t("access.beta.tab"),
                                href: "/settings/beta-invitations",
                            },
                        ]
                      : [tab],
            ),
        [hidePrivacyData, isPlatformAdmin, t],
    );
    // Search only what is listed: an entry on a hidden tab would open a page
    // the person is not offered.
    const searchEntries = useMemo(() => {
        const visibleTabIds = new Set(visibleTabs.map((tab) => tab.id));
        return SETTINGS_SEARCH_ENTRIES.filter((entry) =>
            visibleTabIds.has(entry.tabId),
        );
    }, [visibleTabs]);

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push("/");
        }
    }, [isAuthenticated, authLoading, router]);

    if (authLoading) {
        return (
            <div className="h-dvh flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-interactive" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return null;
    }

    // My Activity is linked from Settings but uses the full table-page layout.
    if (pathname === "/settings/my-activity") {
        return children;
    }

    return (
        <SettingsShell
            title={t("settings.layout.settings")}
            navLabel={t("settings.layout.settings")}
            search={<SettingsSearch entries={searchEntries} />}
            tabs={visibleTabs.map((tab) =>
                tab.id === "organizations" && invitationCount > 0
                    ? {
                          ...tab,
                          badge: (
                              <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-interactive px-1.5 text-xs font-semibold tabular-nums text-interactive-foreground">
                                  {invitationCount}{" "}
                                  <span className="sr-only">
                                      {t("settings.layout.pendingInvitations", { invitationCount })}
                                  </span>
                              </span>
                          ),
                      }
                    : tab,
            )}
            rootHref="/settings"
        >
            {children}
        </SettingsShell>
    );
}
