"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import type { FirmProfile, FirmProfileSettings } from "@mike/contracts";
import { ModalTextInput } from "@/app/components/modals/ModalTextInput";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { OptionPill } from "@/app/components/ui/option-pill";
import { showToast } from "@/app/components/ui/toast";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import {
  FIRM_BRIEF_LANGUAGES,
  FIRM_CITY_MAX,
  FIRM_CLIENT_TYPES,
  FIRM_DESCRIPTION_MAX,
  FIRM_INDUSTRIES_MAX,
  FIRM_SIZES,
  MX_STATE_CODES,
  parseIndustries,
} from "@/app/lib/firmProfileOptions";
import { getOrgFirmProfile, isMfaRequiredError, saveOrgFirmProfile } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { cn } from "@/app/lib/utils";
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel } from "@/app/onboarding/options";

type StateCode = (typeof MX_STATE_CODES)[number];
const AREAS = PRACTICE_AREA_OPTIONS.filter((area) => area !== "Other");
// 44 px to touch on a phone; compact with a mouse.
const SELECT_CLASS = `h-11 pointer-fine:h-9 ${FORM_CONTROL_GLASS_CLASS}`;
const CHIP_CLASS = "pointer-coarse:min-h-11 pointer-coarse:px-3";

type Draft = {
  hq_state: string;
  hq_city: string;
  other_states: string[];
  size: string;
  practice_areas: string[];
  client_type: string;
  industries: string;
  brief_language: string;
  description: string;
};

const draftFrom = (profile: FirmProfile | null): Draft => ({
  hq_state: profile?.hq_state ?? "",
  hq_city: profile?.hq_city ?? "",
  other_states: profile?.other_states ?? [],
  size: profile?.size ?? "",
  practice_areas: profile?.practice_areas ?? [],
  client_type: profile?.client_type ?? "",
  industries: (profile?.industries ?? []).join(", "),
  brief_language: profile?.brief_language ?? "",
  description: profile?.description ?? "",
});

/** The form as the server wants it: only what is filled; the server drops the rest. */
function profileFrom(draft: Draft): FirmProfile {
  const industries = parseIndustries(draft.industries);
  return {
    ...(draft.hq_state ? { hq_state: draft.hq_state } : {}),
    ...(draft.hq_city.trim() ? { hq_city: draft.hq_city.trim() } : {}),
    ...(draft.other_states.length ? { other_states: draft.other_states.filter((s) => s !== draft.hq_state) } : {}),
    ...(draft.size ? { size: draft.size as FirmProfile["size"] } : {}),
    ...(draft.practice_areas.length ? { practice_areas: draft.practice_areas } : {}),
    ...(draft.client_type ? { client_type: draft.client_type as FirmProfile["client_type"] } : {}),
    ...(industries.length ? { industries } : {}),
    ...(draft.brief_language ? { brief_language: draft.brief_language as FirmProfile["brief_language"] } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
  };
}

/**
 * "Firm profile" (docs/firm-profile.md), in the firm's settings: what the
 * assistant is told about the firm in every chat of its workspace. Owners and
 * admins edit it; every other member sees it read only. The two notes are
 * always visible (never a tooltip): the help under the title, and the warning
 * right at the free-text field, because that text goes to the AI provider.
 */
export function OrganizationFirmProfile({ orgId }: { orgId: string }) {
  const t = useTranslations();
  const headingId = useId();
  const id = useId();
  const warningId = useId();
  const [settings, setSettings] = useState<FirmProfileSettings | null>(null);
  const [draft, setDraft] = useState<Draft>(draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [pendingMfa, setPendingMfa] = useState<FirmProfile | null | undefined>(undefined);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => getOrgFirmProfile(orgId))
      .then(
        (next) => {
          if (!current) return;
          setSettings(next);
          setDraft(draftFrom(next.profile));
        },
        (error) => {
          if (current) notifyError(error, { action: tRef.current("orgSettings.profile.couldNotLoad") });
        },
      );
    return () => {
      current = false;
    };
  }, [orgId]);

  const canManage = settings?.can_manage === true;
  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = (field: "other_states" | "practice_areas", value: string) =>
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(value) ? current[field].filter((v) => v !== value) : [...current[field], value],
    }));
  const industriesTooMany = parseIndustries(draft.industries).length > FIRM_INDUSTRIES_MAX;

  async function save(profile: FirmProfile | null) {
    if (saving) return;
    setSaving(true);
    try {
      const next = await saveOrgFirmProfile(orgId, profile);
      setSettings(next);
      setDraft(draftFrom(next.profile));
      showToast({ tone: "success", message: t("orgSettings.profile.saved") });
    } catch (error) {
      if (isMfaRequiredError(error)) setPendingMfa(profile);
      else notifyError(error, { action: t("orgSettings.profile.couldNotSave"), onRetry: () => void save(profile) });
    } finally {
      setSaving(false);
    }
  }

  const label = (key: "hqState" | "hqCity" | "size" | "clientType" | "industries" | "briefLanguage" | "description", field: string) => (
    <label htmlFor={`${id}-${field}`} className="text-xs font-medium text-gray-900">
      {t(`orgSettings.profile.${key}`)}
    </label>
  );
  const chips = (
    field: "other_states" | "practice_areas",
    options: readonly string[],
    text: (value: string) => string,
    group: "otherStates" | "practiceAreas",
  ) => (
    <div role="group" aria-label={t(`orgSettings.profile.${group}`)} className="flex flex-wrap gap-2">
      {options.map((value) => {
        const on = draft[field].includes(value);
        return (
          <OptionPill
            key={value}
            className={cn(CHIP_CLASS, on && "font-medium text-gray-950 ring-2 ring-focus")}
            aria-pressed={on}
            disabled={!canManage || saving || (field === "other_states" && value === draft.hq_state)}
            onClick={() => toggle(field, value)}
          >
            {on ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
            {text(value)}
          </OptionPill>
        );
      })}
    </div>
  );
  const select = (field: keyof Draft, options: readonly { value: string; label: string }[]) => (
    <select
      id={`${id}-${field}`}
      className={SELECT_CLASS}
      value={draft[field] as string}
      disabled={!canManage || saving}
      onChange={(event) => edit({ [field]: event.target.value } as Partial<Draft>)}
    >
      <option value="">{t("orgSettings.profile.notSet")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SettingsHeading id={headingId}>{t("orgSettings.profile.title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="min-w-0 space-y-1">
            <SettingsDescription>{t("orgSettings.profile.help")}</SettingsDescription>
            {settings && !canManage ? <SettingsDescription>{t("orgSettings.profile.readOnly")}</SettingsDescription> : null}
          </div>
        </SettingsRow>
        {!settings ? (
          <SettingsRow layout="stacked">
            <div className="h-24 animate-pulse rounded-xl bg-app-surface" aria-hidden="true" />
          </SettingsRow>
        ) : (
          <SettingsRow layout="stacked">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                {label("hqState", "hq_state")}
                {select("hq_state", MX_STATE_CODES.map((code) => ({ value: code, label: t(`orgSettings.profile.states.${code}`) })))}
              </div>
              <div className="space-y-1">
                {label("hqCity", "hq_city")}
                <ModalTextInput
                  id={`${id}-hq_city`}
                  className="h-11 pointer-fine:h-9"
                  value={draft.hq_city}
                  maxLength={FIRM_CITY_MAX}
                  readOnly={!canManage}
                  disabled={saving}
                  onChange={(event) => edit({ hq_city: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                {label("size", "size")}
                {select("size", FIRM_SIZES.map((size) => ({ value: size, label: t(`orgSettings.profile.sizes.${size}`) })))}
              </div>
              <div className="space-y-1">
                {label("clientType", "client_type")}
                {select("client_type", FIRM_CLIENT_TYPES.map((type) => ({ value: type, label: t(`orgSettings.profile.clientTypes.${type}`) })))}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-900">{t("orgSettings.profile.otherStates")}</p>
              {chips("other_states", MX_STATE_CODES, (code) => t(`orgSettings.profile.states.${code as StateCode}`), "otherStates")}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-900">{t("orgSettings.profile.practiceAreas")}</p>
              {chips("practice_areas", AREAS, (area) => practiceAreaLabel(area, t), "practiceAreas")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                {label("industries", "industries")}
                <ModalTextInput
                  id={`${id}-industries`}
                  className="h-11 pointer-fine:h-9"
                  value={draft.industries}
                  maxLength={500}
                  readOnly={!canManage}
                  disabled={saving}
                  aria-describedby={`${id}-industries-hint`}
                  onChange={(event) => edit({ industries: event.target.value })}
                />
                <p id={`${id}-industries-hint`} className="text-xs text-gray-500">
                  {t("orgSettings.profile.industriesHint", { max: FIRM_INDUSTRIES_MAX })}
                </p>
              </div>
              <div className="space-y-1">
                {label("briefLanguage", "brief_language")}
                <select
                  id={`${id}-brief_language`}
                  className={SELECT_CLASS}
                  value={draft.brief_language}
                  disabled={!canManage || saving}
                  onChange={(event) => edit({ brief_language: event.target.value })}
                >
                  <option value="">{t("orgSettings.profile.language.default")}</option>
                  {FIRM_BRIEF_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {t(`orgSettings.profile.language.${language}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              {label("description", "description")}
              <ModalTextarea
                id={`${id}-description`}
                className="min-h-24 text-sm"
                rows={4}
                value={draft.description}
                maxLength={FIRM_DESCRIPTION_MAX}
                readOnly={!canManage}
                disabled={saving}
                aria-describedby={warningId}
                onChange={(event) => edit({ description: event.target.value })}
              />
              {/* Always visible: this text goes to the AI provider in every chat. */}
              <p id={warningId} className="text-xs text-gray-600">
                {t("orgSettings.profile.freeTextWarning")}
              </p>
              <p className="text-xs text-gray-500">
                {t("orgSettings.profile.descriptionCount", { count: draft.description.length, max: FIRM_DESCRIPTION_MAX })}
              </p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <TextButtonUI
                  size="sm"
                  type="button"
                  className="pointer-coarse:min-h-11"
                  disabled={saving || !settings.profile}
                  onClick={() => void save(null)}
                >
                  {t("orgSettings.profile.clear")}
                </TextButtonUI>
                <PillButtonUI
                  type="button"
                  tone="black"
                  size="normal"
                  className="ml-auto pointer-coarse:min-h-11"
                  disabled={saving || industriesTooMany}
                  aria-busy={saving}
                  onClick={() => void save(profileFrom(draft))}
                >
                  {saving ? t("orgSettings.profile.saving") : t("orgSettings.profile.save")}
                </PillButtonUI>
              </div>
            ) : null}
          </SettingsRow>
        )}
      </GlassCardUI>
      <MfaVerificationPopup
        open={pendingMfa !== undefined}
        onCancel={() => setPendingMfa(undefined)}
        onVerified={() => {
          const next = pendingMfa;
          setPendingMfa(undefined);
          if (next !== undefined) void save(next);
        }}
        title={t("organizations.organizationPrivacyData.twoFactorVerificationRequired")}
        message={t("organizations.organizationPrivacyData.thisSettingIsSensitiveEnterA")}
      />
    </section>
  );
}
