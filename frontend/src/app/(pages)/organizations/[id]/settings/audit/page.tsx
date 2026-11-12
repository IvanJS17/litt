"use client";

import { useRouter } from "next/navigation";
import { AuditHistory } from "@/app/components/history/AuditHistory";
import {
  useOrganizationSettings,
  organizationSettingsHref,
} from "@/app/components/organizations/OrganizationSettingsShell";
import { EmptyState } from "@/app/components/ui/empty-state";
import { isOrgAdmin } from "@/app/lib/permissions";
import { useTranslations } from "next-intl";

export default function OrganizationAuditPage() {
  const t = useTranslations();
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  if (!org) return null;
  if (!isOrgAdmin(org.role))
    return (
      <EmptyState
        title={t("organizations.auditLog")}
        description={t("organizations.onlyOrganizationOwnersAndAdminsCan")}
      />
    );
  return (
    <AuditHistory
      key={orgId}
      orgId={orgId}
      onBack={() => router.push(organizationSettingsHref(orgId))}
    />
  );
}
