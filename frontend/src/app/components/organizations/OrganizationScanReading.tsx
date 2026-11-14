"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { SplitClassesCard } from "@/app/components/settings/SplitClassesCard";
import { EmptyState } from "@/app/components/ui/empty-state";
import { getOrgSplitClasses, saveOrgSplitClasses } from "@/app/lib/mikeApi";
import { isOrgAdmin } from "@/app/lib/permissions";
import { PillButtonUI } from "@mike/ui";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "./OrganizationSettingsShell";

/**
 * «Lectura de escaneados» in a firm's settings: the document types that
 * «Separar expediente» sorts pages into, for the firm's workspace. The firm's
 * LandingAI key is with the other keys, in «Llaves del despacho». Owners and
 * admins only; a member who follows a link is told why.
 */
export function OrganizationScanReading() {
  const t = useTranslations();
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();

  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title={t("settings.map.firmTab.scanReading.title")}
        description={t("organizations.organizationProvidersSettings.onlyThisOrganizationsOwnersAndAdmins")}
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

  return (
    <SplitClassesCard
      title={t("settings.splitClasses.title")}
      intro={t("settings.splitClasses.orgIntro")}
      load={() => getOrgSplitClasses(orgId)}
      save={(classes) => saveOrgSplitClasses(orgId, classes)}
    />
  );
}
