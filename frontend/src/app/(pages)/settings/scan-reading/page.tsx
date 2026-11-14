"use client";

import { SettingsManagedByFirm } from "@/app/components/settings/SettingsCrossLink";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { GlassCardUI } from "@mike/ui";
import { ScanReadingSection } from "@/app/components/settings/ScanReadingSection";
import { SplitClassesCard } from "@/app/components/settings/SplitClassesCard";
import { useKeyScope } from "@/app/components/settings/KeyScope";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { getUserSplitClasses, saveUserSplitClasses } from "@/app/lib/mikeApi";
import { isOrgAdmin } from "@/app/lib/permissions";
import { firmSettingsHref } from "@/app/lib/settingsMap";
import { useTranslations } from "next-intl";

export default function ScanReadingPage() {
  const t = useTranslations();
  const { activeOrganization } = useWorkspace();
  // The personal list of document types governs the personal workspace only
  // (a firm's workspace uses the firm's, in Ajustes del despacho), and a
  // firm-managed account has no personal workspace. Where it does not apply
  // the page points to the firm's list instead of repeating it.
  const { firmName, managed } = useKeyScope();
  const showPersonalSplitClasses = firmName === null && !managed;
  return (
    <div className="space-y-8">
      <ScanReadingSection />
      {showPersonalSplitClasses ? (
        <SplitClassesCard
          title={t("settings.splitClasses.title")}
          intro={t("settings.splitClasses.personalIntro")}
          load={getUserSplitClasses}
          save={saveUserSplitClasses}
        />
      ) : activeOrganization ? (
        // The firm's list governs here: said in a card of its own, with the
        // same title as the list, not as a loose line.
        <div className="space-y-3">
          <SettingsHeading>{t("settings.splitClasses.title")}</SettingsHeading>
          <GlassCardUI>
            {isOrgAdmin(activeOrganization.role) ? (
              <SettingsManagedByFirm
                messageKey="settings.map.managedByFirmAdmin"
                href={firmSettingsHref(activeOrganization.id, "scan-reading")}
                values={{ name: activeOrganization.name }}
              />
            ) : (
              <SettingsManagedByFirm
                messageKey="settings.map.managedByFirmMember"
                values={{ name: activeOrganization.name }}
              />
            )}
          </GlassCardUI>
        </div>
      ) : null}
    </div>
  );
}
