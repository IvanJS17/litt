"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import { ConnectedAppActivity } from "@/app/components/settings/ConnectedAppActivity";
import { ConnectedAppIcon } from "@/app/components/settings/ConnectedAppIcon";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SETTINGS_SIGNAL_ICONS } from "@/app/components/settings/SettingsText";
import type { McpGrant } from "@/app/lib/mikeApi";
import type { UserFacingError } from "@/app/lib/userFacingError";

const KNOWN_SCOPES = ["read", "run", "write", "chat"] as const;
type KnownScope = (typeof KNOWN_SCOPES)[number];
const knownScope = (scope: string): KnownScope | null => {
  const name = scope.startsWith("litt.") ? scope.slice("litt.".length) : scope;
  return (KNOWN_SCOPES as readonly string[]).includes(name) ? (name as KnownScope) : null;
};

/**
 * One connected app: what it may do (the phrases the person accepted on the
 * authorization screen) and what it may not, where it may work with the
 * default marked, its dates, its recent activity and «Quitar acceso».
 */
export function ConnectedAppCard({
  grant,
  workspaceName,
  confirming,
  showing,
  busy,
  onAskRevoke,
  onCancelRevoke,
  onRevoke,
  onToggleActivity,
  onActivityError,
}: {
  grant: McpGrant;
  workspaceName: (id: string) => string;
  confirming: boolean;
  showing: boolean;
  busy: boolean;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
  onToggleActivity: () => void;
  onActivityError: (error: UserFacingError) => void;
}) {
  const t = useTranslations("settings.connectedApps");
  const tc = useTranslations("connect");
  const format = useFormatter();
  const actions = useRef<HTMLDivElement>(null);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const titleId = `connected-app-${grant.id}`;

  // The confirmation takes focus so the keyboard lands on the safe choice.
  useEffect(() => {
    if (confirming) actions.current?.querySelector("button")?.focus();
  }, [confirming]);

  const granted = new Set(grant.scopes.map(knownScope));
  const cannot = KNOWN_SCOPES.filter((scope) => !granted.has(scope));
  const Chevron = showing ? ChevronUp : ChevronDown;

  return (
    <article aria-labelledby={titleId}>
      <GlassCardUI>
        <SettingsRow>
          <div className="flex min-w-0 items-center gap-3">
            <ConnectedAppIcon app={grant.app} />
            <div className="min-w-0">
              <h3 id={titleId} className="text-base font-medium text-gray-900 [overflow-wrap:anywhere]">
                {grant.client_name}
              </h3>
              <p className="text-sm text-gray-600">
                {grant.last_used_at ? t("lastUsed", { date: date(grant.last_used_at) }) : t("neverUsed")}
              </p>
            </div>
          </div>
          {!confirming && (
            <PillButtonUI tone="whiteDanger" type="button" className="self-start sm:self-center" onClick={onAskRevoke}>
              {t("revoke")}
            </PillButtonUI>
          )}
        </SettingsRow>
        <SettingsRow layout="stacked">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">{tc("scopes.title")}</p>
              <ul className="space-y-2">
                {grant.scopes.map((scope) => {
                  const known = knownScope(scope);
                  return (
                    <li key={scope} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gray-900" />
                      <div className="min-w-0 [overflow-wrap:anywhere]">
                        <p className="text-sm font-medium text-gray-900">{known ? t(`scope.${known}`) : scope}</p>
                        {known && <p className="text-sm text-gray-600">{tc(`scopes.${known}`)}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {cannot.length > 0 && (
                <p className="text-sm text-gray-600">
                  {t("cannot", { list: cannot.map((scope) => t(`scope.${scope}`)).join(", ") })}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">{tc("workspaces.title")}</p>
              <ul className="space-y-2">
                {grant.workspaces.map((id) => {
                  const Icon = SETTINGS_SIGNAL_ICONS[id === "personal" ? "user" : "firm"];
                  return (
                    <li key={id} className="flex gap-2 text-sm text-gray-900">
                      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gray-500" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {workspaceName(id)}
                        {grant.workspaces.length > 1 && id === grant.default_workspace && (
                          <span className="text-gray-600"> · {t("defaultWorkspace")}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </SettingsRow>
        {confirming && (
          <SettingsRow>
            <p className="text-sm text-gray-900">{t("confirmRevoke", { client: grant.client_name })}</p>
            <div ref={actions} className="flex shrink-0 gap-2">
              <PillButtonUI tone="white" type="button" disabled={busy} onClick={onCancelRevoke}>
                {t("cancel")}
              </PillButtonUI>
              <PillButtonUI tone="danger" type="button" disabled={busy} onClick={onRevoke}>
                {t("confirmYes")}
              </PillButtonUI>
            </div>
          </SettingsRow>
        )}
        <SettingsRow>
          <p className="text-xs text-gray-600">
            {t("connected", { date: date(grant.created_at) })} · {t("expires", { date: date(grant.expires_at) })}
          </p>
          <TextButtonUI aria-expanded={showing} className="self-start sm:self-center" onClick={onToggleActivity}>
            {showing ? t("activityHide") : t("activityShow")}
            <Chevron aria-hidden="true" className="size-4" />
          </TextButtonUI>
        </SettingsRow>
        {showing && (
          <SettingsRow layout="stacked">
            <ConnectedAppActivity
              grantId={grant.id}
              client={grant.client_name}
              workspaceName={workspaceName}
              onError={onActivityError}
            />
          </SettingsRow>
        )}
      </GlassCardUI>
    </article>
  );
}
