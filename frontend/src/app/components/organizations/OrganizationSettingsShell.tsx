"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { TableEmptyState } from "@/app/components/shared/TablePrimitive";
import { SettingsShell } from "@/app/components/settings/SettingsShell";
import { SettingsCrossLink } from "@/app/components/settings/SettingsCrossLink";
import { firmSettingsHref } from "@/app/lib/settingsMap";
import { settingsShellModel } from "@/app/lib/settingsShellModel";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { useItemWorkspace } from "@/app/hooks/useItemWorkspace";
import { getOrg, type Org } from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { PillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

// A firm's settings area, «Ajustes del despacho · <name>»: the same frame as a
// person's settings, with its sections down the side. Which sections there
// are, how they are grouped and who is offered each one is declared in the
// settings map (lib/settingsMap.ts, docs/settings-map.md); this file only
// draws them.
//
// An organization's settings are part of its workspace: they open only while
// that organization is the caller's active workspace, never from another
// organization's or from personal work. Opening them from elsewhere — a
// link, the browser's history — switches to that workspace, with a notice
// (useItemWorkspace); nothing about the organization is read until it has.
// Switching workspace with them open leaves for the new workspace's home.
//
// OrganizationSettingsProvider loads the organization once and hands it to
// every page under settings, so they agree about the name and about what the
// caller may do. OrganizationSettingsFrame is the sectioned frame around the
// pages that sit inside it. The server still decides every change; a section
// a member cannot use is not offered.

interface OrganizationSettingsContextValue {
  orgId: string;
  /** `null` until the organization has loaded. */
  org: Org | null;
  /** Put a changed organization (a new name) in place without a re-read. */
  setOrg: (org: Org) => void;
  /** Re-read the organization, after the caller's role may have changed. */
  reload: () => Promise<void>;
}

const OrganizationSettingsContext =
  createContext<OrganizationSettingsContextValue | null>(null);

export function useOrganizationSettings(): OrganizationSettingsContextValue {
  const value = useContext(OrganizationSettingsContext);
  if (!value)
    throw new Error(
      "useOrganizationSettings must be used inside OrganizationSettingsShell",
    );
  return value;
}

export function organizationSettingsHref(
  orgId: string,
  section: OrganizationSettingsSection = "general",
): string {
  return firmSettingsHref(orgId, section);
}

type OrganizationSettingsSection =
  | "general"
  | "members"
  | "audit"
  | "providers"
  | "scan-reading"
  | "privacy-data"
  | "training";

export function OrganizationSettingsProvider({
  orgId,
  children,
}: {
  orgId: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { workspaceId, organizations } = useWorkspace();
  const [org, setOrg] = useState<Org | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `null` is "no workspace to compare with" (outside a WorkspaceProvider),
  // where nothing is narrowed.
  const inWorkspace = workspaceId === null || workspaceId === orgId;
  // Opening an organization's settings opens its workspace.
  useItemWorkspace(orgId, orgId);

  const reload = useCallback(async () => {
    // Another workspace's settings are not read at all.
    if (!inWorkspace) return;
    try {
      setOrg(await getOrg(orgId));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        userFacingApiError(error, t("organizations.organizationSettingsShell.couldNotLoadThisOrganization")),
      );
    }
  }, [inWorkspace, orgId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the organization request once its id is known
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({ orgId, org, setOrg, reload }),
    [orgId, org, reload],
  );

  if (!inWorkspace) {
    // Whether it is one of theirs can only be said once the caller's own
    // organizations are known.
    if (organizations === null) return null;
    // Theirs: its workspace is on the way in, or they have just switched
    // out of it and are on the way to the other one's home.
    if (organizations.some((candidate) => candidate.id === orgId)) return null;
    // Not one of theirs: say nothing about it, as a 404 would.
    return (
      <TableEmptyState>
        <EmptyState
          icon={<OrganizationSkeuoIcon />}
          title={t("organizations.organizationSettingsShell.organization")}
          description={t("organizations.organizationSettingsShell.theseSettingsAreNotAvailable")}
          action={
            <PillButtonUI
              tone="white"
              size="sm"
              onClick={() => router.push("/settings/organizations")}
            >
              {t("organizations.organizationSettingsShell.yourOrganizations")}
            </PillButtonUI>
          }
        />
      </TableEmptyState>
    );
  }

  // Somebody who is not in the organization is told nothing about it, and a
  // failed read has no pages to show: either way there is no area to frame,
  // only the message and a retry.
  if (loadError && !org)
    return (
      <TableEmptyState>
        <EmptyState
          icon={<OrganizationSkeuoIcon />}
          title={t("organizations.organizationSettingsShell.organization")}
          description={loadError}
          tone="error"
          action={
            <PillButtonUI
              tone="black"
              size="sm"
              onClick={() => {
                setLoadError(null);
                void reload();
              }}
            >
              {t("organizations.organizationSettingsShell.tryAgain")}
            </PillButtonUI>
          }
        />
      </TableEmptyState>
    );

  return (
    <OrganizationSettingsContext.Provider value={value}>
      {children}
    </OrganizationSettingsContext.Provider>
  );
}

/** The sectioned frame around the settings pages that sit inside it. */
export function OrganizationSettingsFrame({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations();
  const { orgId, org } = useOrganizationSettings();
  // The owners' sections are not offered to a member, nor before the caller's
  // role is known: until then the frame holds what every member is offered, so
  // it does not jump.
  const firmRole = org === null ? "member" : org.role;
  const { tabs, groups } = useMemo(
    () =>
      settingsShellModel(t, "firm", { platformAdmin: false, memberDataActions: false, firmRole }, orgId),
    [firmRole, orgId, t],
  );

  return (
    <SettingsShell
      // Always says which firm these settings are about.
      title={
        org
          ? t("settings.map.firmHeading", { name: org.name })
          : t("settings.map.firmHeadingLoading")
      }
      navLabel={t("settings.map.firmHeadingLoading")}
      tabs={tabs}
      groups={groups}
      banner={
        org ? (
          <SettingsCrossLink
            messageKey="settings.map.firmBanner"
            href="/settings"
            values={{ name: org.name }}
          />
        ) : null
      }
      rootHref={organizationSettingsHref(orgId)}
    >
      {children}
    </SettingsShell>
  );
}
