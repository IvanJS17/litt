"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrganizationInvitationCount } from "@/app/hooks/useOrganizationInvitationCount";
import { usePlatformMe } from "@/app/hooks/usePlatformMe";
import { useMemberDataActions } from "@/app/hooks/useMemberDataActions";
import {
    SettingsShell,
    SettingsShellSkeleton,
} from "@/app/components/settings/SettingsShell";
import { SETTINGS_PHONE_HOME } from "@/app/lib/settingsRoutes";
import { SettingsCrossLink } from "@/app/components/settings/SettingsCrossLink";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { settingsShellModel } from "@/app/lib/settingsShellModel";
import { firmSettingsHref } from "@/app/lib/settingsMap";
import { SettingsSearch } from "@/app/components/settings/SettingsSearch";
import { SETTINGS_SEARCH_ENTRIES } from "@/app/lib/settingsSearch";

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
    // The tabs, their names and their groups come from the settings map.
    const { tabs: visibleTabs, groups } = useMemo(
        () =>
            settingsShellModel(t, "personal", {
                platformAdmin: isPlatformAdmin,
                memberDataActions: !hidePrivacyData,
                firmRole: null,
            }),
        [hidePrivacyData, isPlatformAdmin, t],
    );
    // Where the firm's own settings are, for the line above these.
    const { activeOrganization, organizations } = useWorkspace();
    const firm = activeOrganization ?? organizations?.[0] ?? null;
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
            groups={groups}
            banner={
                firm ? (
                    <SettingsCrossLink
                        messageKey="settings.map.personalBanner"
                        href={firmSettingsHref(firm.id)}
                    />
                ) : null
            }
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
            }}
        >
            {children}
        </SettingsShell>
    );
}
