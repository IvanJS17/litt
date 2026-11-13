"use client";

import { useState } from "react";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { ScanReadingSection } from "@/app/components/settings/ScanReadingSection";
import { SplitClassesCard } from "@/app/components/settings/SplitClassesCard";
import { getUserSplitClasses, saveUserSplitClasses } from "@/app/lib/mikeApi";
import { WebSearchSection } from "@/app/components/settings/WebSearchSection";
import { useKeyScope } from "@/app/components/settings/KeyScope";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useTranslations } from "next-intl";

export default function FeaturesPage() {
  const t = useTranslations();
  const {
    profile,
    updateQuickActionsVisible,
    updateResponseDetailsVisible,
  } = useUserProfile();
  // The personal list of document types governs the personal workspace only
  // (a firm's workspace uses the firm's), and a firm-managed account has no
  // personal workspace: the card is not offered in either case.
  const { firmName, managed } = useKeyScope();
  const showPersonalSplitClasses = firmName === null && !managed;
  const [savingQuickActions, setSavingQuickActions] = useState(false);
  const [savingResponseDetails, setSavingResponseDetails] = useState(false);
  const quickActionsVisible = profile?.quickActionsVisible ?? true;
  const responseDetailsVisible = profile?.responseDetailsVisible ?? false;

  const setQuickActionsVisible = async (visible: boolean) => {
    setSavingQuickActions(true);
    // A failure is reported by the profile context's notice (with Retry);
    // the toggle reads the profile, so it is already back where it was.
    await updateQuickActionsVisible(visible);
    setSavingQuickActions(false);
  };

  const setResponseDetailsVisible = async (visible: boolean) => {
    setSavingResponseDetails(true);
    // As with quick actions, the profile context reports a failure and the
    // toggle, which reads the profile, stays where it was.
    await updateResponseDetailsVisible(visible);
    setSavingResponseDetails(false);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SettingsHeading id="assistant-features">{t("settings.features.assistant")}</SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>{t("settings.features.quickActions")}</SettingsLabel>
              <SettingsDescription>
                {t("settings.features.showTheQuickActionsRowOn")}
              </SettingsDescription>
            </div>
            <ToggleSwitchUI
              checked={quickActionsVisible}
              disabled={savingQuickActions}
              aria-busy={savingQuickActions}
              aria-label={t("settings.features.quickActions")}
              onCheckedChange={(checked) => {
                void setQuickActionsVisible(checked);
              }}
            />
          </SettingsRow>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>{t("settings.features.responseDetails")}</SettingsLabel>
              <SettingsDescription>
                {t("settings.features.showTheModelReasoningEffortAnd")}
              </SettingsDescription>
            </div>
            <ToggleSwitchUI
              checked={responseDetailsVisible}
              disabled={savingResponseDetails}
              aria-busy={savingResponseDetails}
              aria-label={t("settings.features.responseDetails")}
              onCheckedChange={(checked) => {
                void setResponseDetailsVisible(checked);
              }}
            />
          </SettingsRow>
        </GlassCardUI>
      </section>

      <WebSearchSection />
      <ScanReadingSection />
      {showPersonalSplitClasses ? (
        <SplitClassesCard
          title={t("settings.splitClasses.title")}
          intro={t("settings.splitClasses.personalIntro")}
          load={getUserSplitClasses}
          save={saveUserSplitClasses}
        />
      ) : null}
    </div>
  );
}
