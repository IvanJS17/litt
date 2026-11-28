"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "@/app/components/organizations/OrganizationSettingsShell";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { StorageUsageCard } from "@/app/components/settings/StorageUsageCard";
import { EmptyState } from "@/app/components/ui/empty-state";
import { isOrgAdmin } from "@/app/lib/permissions";

/**
 * «Almacenamiento» in a firm's settings: how much of the firm's shared space is
 * in use. Owners and administrators only; a member who follows a link is told
 * the settings are not available, and the server is not asked.
 */
export default function OrganizationStorageSettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();

  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title={t("settings.map.firmTab.storage.title")}
        description={t("organizations.organizationSettingsShell.theseSettingsAreNotAvailable")}
        action={
          <PillButtonUI
            tone="white"
            size="sm"
            onClick={() => router.push(organizationSettingsHref(orgId))}
          >
            {t("organizations.organizationProvidersSettings.backToGeneral")}
          </PillButtonUI>
        }
      />
    );

  // The role is not known until the firm has loaded: nothing is asked of the
  // server before then, so a member never triggers a refused read.
  if (!org) return null;
  return <StorageUsageCard orgId={orgId} />;
}
