"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrganizationInvitationCount } from "@/app/hooks/useOrganizationInvitationCount";
import { usePlatformMe } from "@/app/hooks/usePlatformMe";
import { useMemberDataActions } from "@/app/hooks/useMemberDataActions";
import { useKeyScope } from "@/app/components/settings/KeyScope";
import {
    SettingsShell,
    SettingsShellSkeleton,
    type SettingsShellTab,
} from "@/app/components/settings/SettingsShell";
import { SETTINGS_PHONE_HOME } from "@/app/lib/settingsRoutes";
import { SettingsSearch } from "@/app/components/settings/SettingsSearch";
import { SETTINGS_SEARCH_ENTRIES } from "@/app/lib/settingsSearch";

/** The phone list's groups, by tab id. A tab named in none is listed last. */
function phoneGroups(t: Translate) {
    return [
        { id: "account", label: t("settings.layout.group.account"), tabIds: ["account", "security"] },
        {
            id: "preferences",
            label: t("settings.layout.group.preferences"),
            tabIds: ["personalisation", "memory", "appearance", "features", "models"],
        },
        { id: "keys", label: t("settings.layout.group.keys"), tabIds: ["byok", "connectors"] },
        {
            id: "firm",
            label: t("settings.layout.group.firm"),
            tabIds: ["organizations", "training", "firm-criteria", "beta-invitations", "beta-stats"],
        },
        { id: "privacy", label: t("settings.layout.group.privacy"), tabIds: ["privacy-data", "my-activity"] },
    ];
}

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
    // Beta invitations are for platform administrators only. The answer is
    // read with the profile when the session starts and shared with the
    // Organizations page; the frame waits for it (below) so these tabs
    // appear together with the others.
    const platform = usePlatformMe(isAuthenticated ? user?.id : undefined);
    const isPlatformAdmin = platform.me?.admin === true;
    // Where the person's own keys do not apply, this tab shows the firm's.
    const { personalBlocked, firmName } = useKeyScope();
    const firmKeysTab = personalBlocked && firmName !== null;
    const visibleTabs = useMemo(
        () =>
            settingsTabs(t).filter(
                (tab) => !(hidePrivacyData && tab.id === "privacy-data"),
            ).map((tab) =>
                tab.id === "byok" && firmKeysTab
                    ? { ...tab, label: t("settings.layout.tab.firmKeys") }
                    : tab,
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
                            {
                                id: "beta-stats",
                                label: t("access.stats.tab"),
                                href: "/settings/beta-stats",
                            },
                        ]
                      : [tab],
            ),
        [hidePrivacyData, firmKeysTab, isPlatformAdmin, t],
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

    if (authLoading || (isAuthenticated && platform.status === "loading")) {
        return <SettingsShellSkeleton />;
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
            mobileHome={{
                href: SETTINGS_PHONE_HOME,
                backLabel: t("settings.layout.settings"),
                groups: phoneGroups(t),
            }}
        >
            {children}
        </SettingsShell>
    );
}
