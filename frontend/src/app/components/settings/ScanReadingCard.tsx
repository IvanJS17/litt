"use client";

import { useId } from "react";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { useTranslations } from "next-intl";
import { ApiKeyField } from "@/app/components/settings/ApiKeyField";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
  SettingsMoreInfo,
  SettingsNotice,
  SettingsTag,
  SettingsTagRow,
} from "@/app/components/settings/SettingsText";

const LINK_CLASS =
  "font-medium underline transition-colors hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2";

const LANDINGAI_SITE = "https://www.landing.ai/";
const LANDINGAI_KEY_DOCS = "https://docs.landing.ai/dpt3/agentic-api-key";
const LANDINGAI_PRICING = "https://www.landing.ai/pricing-agentic-apis";

/**
 * Scan reading with LandingAI, for a person (their own key) or an
 * organization (its key). The disclaimer sits beside the switch and is shown
 * before anything is turned on; there is no checkbox: turning the switch on
 * after reading it, or saving a key, is the instruction to send documents.
 * The wording of the disclaimer comes from the legal text and is replaced in
 * the same catalog keys (settings.scanReading.*).
 */
export function ScanReadingCard({
  hasSavedKey,
  enabled,
  canManage = true,
  showKeyHelp = true,
  busy = false,
  loading = false,
  onToggle,
  onSaveKey,
  onRemoveKey,
  keyScope,
  keyNotice,
}: {
  /** The owner (this person, or this organization) has a key saved. */
  hasSavedKey: boolean;
  /** The saved key is on. */
  enabled: boolean;
  /** Read-only for somebody who may not change it. */
  canManage?: boolean;
  /** Show how to get a LandingAI key; off where this person cannot add one. */
  showKeyHelp?: boolean;
  busy?: boolean;
  loading?: boolean;
  onToggle: (enabled: boolean) => void;
  onSaveKey: (value: string) => Promise<boolean>;
  onRemoveKey: () => Promise<boolean>;
  /** Says which workspace the key applies to; folded under «Más información». */
  keyScope?: string;
  /** Replaces the key field: why there is no key to set here. */
  keyNotice?: string;
}) {
  const t = useTranslations();
  const headingId = useId();
  const disclaimerId = useId();
  const label = t("settings.scanReading.enable");
  // Scan reading can be turned on from this card only by someone who manages
  // the key and has no notice standing in for the key field.
  const canActivate = canManage && !keyNotice;
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <SettingsTagRow>
        <SettingsHeading id={headingId}>{t("settings.scanReading.title")}</SettingsHeading>
        <SettingsTag kind="optional" />
      </SettingsTagRow>
      <GlassCardUI>
        <SettingsRow>
          <div className="min-w-0 space-y-2">
            <SettingsLabel>{label}</SettingsLabel>
            {/* The disclaimer is the legal text that must be read before
                anything is turned on, so it stays whole and visible, in a
                notice, wherever this card can turn scan reading on (a key
                saved or a switch). Where the person cannot (a member, or a
                firm-managed account) there is nothing to accept here: one
                line says what it is and the disclaimer opens under «Más
                información». The rest of the explanation is always folded. */}
            {canActivate ? (
              <SettingsNotice
                bodyId={disclaimerId}
                entries={[
                  { icon: "send", label: t("settings.signals.thirdParty") },
                  { icon: "receipt", label: t("settings.signals.cost") },
                ]}
              >
                {t("settings.scanReading.disclaimer")}
              </SettingsNotice>
            ) : (
              <SettingsDescription>{t("settings.scanReading.summary")}</SettingsDescription>
            )}
            <SettingsMoreInfo>
              {canActivate ? null : (
                <SettingsDescription>{t("settings.scanReading.disclaimer")}</SettingsDescription>
              )}
              <SettingsDescription>{t("settings.scanReading.turnedOff")}</SettingsDescription>
              <SettingsDescription>
                {t("settings.scanReading.legalLink")}{" "}
                <a href="/terminos#6-12" target="_blank" rel="noreferrer" className={LINK_CLASS}>
                  {t("settings.scanReading.termsLink")}
                </a>
                {" · "}
                <a href="/privacidad#6" target="_blank" rel="noreferrer" className={LINK_CLASS}>
                  {t("settings.scanReading.privacyLink")}
                </a>
              </SettingsDescription>
              <SettingsDescription>{t("settings.scanReading.why")}</SettingsDescription>
              {showKeyHelp ? (
                <SettingsDescription>
                  {t("settings.scanReading.getKey")}{" "}
                  <a href={LANDINGAI_SITE} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                    {t("settings.scanReading.siteLink")}
                  </a>
                  {" · "}
                  <a href={LANDINGAI_KEY_DOCS} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                    {t("settings.scanReading.keyDocsLink")}
                  </a>
                  {" · "}
                  <a href={LANDINGAI_PRICING} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                    {t("settings.scanReading.pricingLink")}
                  </a>
                </SettingsDescription>
              ) : null}
            </SettingsMoreInfo>
          </div>
          {loading ? (
            <div className="h-5 w-9 shrink-0 animate-pulse rounded-full bg-app-surface" aria-hidden="true" />
          ) : hasSavedKey && canManage ? (
            <ToggleSwitchUI
              checked={enabled}
              disabled={busy}
              aria-busy={busy}
              aria-label={label}
              aria-describedby={canActivate ? disclaimerId : undefined}
              onCheckedChange={onToggle}
            />
          ) : hasSavedKey ? (
            <span className="shrink-0 text-sm text-gray-500">
              {enabled ? t("organizations.organizationProviderKeys.on") : t("organizations.organizationProviderKeys.off")}
            </span>
          ) : null}
        </SettingsRow>
        {keyNotice ? (
          <SettingsRow>
            <SettingsDescription>{keyNotice}</SettingsDescription>
          </SettingsRow>
        ) : canManage && !loading ? (
          <ApiKeyField
            label={t("settings.scanReading.keyLabel")}
            description={t("settings.scanReading.saveToTurnOn")}
            moreInfo={keyScope ? <SettingsDescription>{keyScope}</SettingsDescription> : undefined}
            hasSavedKey={hasSavedKey}
            onSave={onSaveKey}
            onRemove={onRemoveKey}
          />
        ) : null}
      </GlassCardUI>
    </section>
  );
}
